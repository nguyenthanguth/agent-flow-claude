import { useEffect, useState, useCallback, useRef } from 'react'
import type { ConnectionStatus, AgentEvent, SessionInfo } from '@/lib/bridge-types'
import { SimulationEvent } from '@/lib/agent-types'

/** Demo mode plays the built-in mock scenario instead of connecting: open the UI with `?demo`. */
const DEMO = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')

type ServerMessage =
  | { type: 'agent-event'; event: AgentEvent }
  | { type: 'agent-event-batch'; events: AgentEvent[] }
  | { type: 'reset'; reason: string }
  | { type: 'session-list'; sessions: SessionInfo[] }
  | { type: 'session-started'; session: SessionInfo }
  | { type: 'session-ended'; sessionId: string }
  | { type: 'session-updated'; sessionId: string; label: string }

interface EventStreamResult {
  connectionStatus: ConnectionStatus
  /** Events for the selected session, waiting to be processed by the simulation */
  pendingEvents: readonly SimulationEvent[]
  /** Call after consuming events to clear the queue */
  consumeEvents: () => void
  /** Whether to play the mock scenario (demo mode) */
  useMockData: boolean
  /** Known sessions from the server */
  sessions: SessionInfo[]
  /** Currently selected session ID */
  selectedSessionId: string | null
  /** Select a session to view (does not flush events — call flushSessionEvents after state swap). */
  selectSession: (sessionId: string | null) => void
  /** Flush buffered events for a session into pending. Call from useLayoutEffect after state swap. */
  flushSessionEvents: (sessionId: string, fromIndex?: number) => void
  /** Get the current event count for a session (for save/restore) */
  getSessionEventCount: (sessionId: string) => number
  /** Ref to the currently selected session ID — updated synchronously, not via React state */
  selectedSessionIdRef: React.RefObject<string | null>
  /** Session IDs that have received events while not selected */
  sessionsWithActivity: Set<string>
  /** Remove a session from the list */
  removeSession: (sessionId: string) => void
  /** Increments on every server reset (each (re)connect). Consumers must drop
   *  per-session caches and restart the simulation when it changes. */
  epoch: number
}

/**
 * Connects to the agent-flow-claude server's SSE stream at /events.
 *
 * Supports multi-session: events are buffered per-session so switching
 * sessions replays the correct event history. The server replays every
 * session's history after a `reset` on each connection, so a reconnect
 * rebuilds state from scratch instead of appending duplicates.
 */
export function useEventStream(): EventStreamResult {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const pendingEventsRef = useRef<SimulationEvent[]>([])
  const [, setEventVersion] = useState(0) // trigger re-render on new events
  const [epoch, setEpoch] = useState(0)

  // Session state
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const selectedSessionIdRef = useRef<string | null>(null)
  const sessionEventsRef = useRef<Map<string, SimulationEvent[]>>(new Map())
  /** True while a session switch is pending (between auto-select and useLayoutEffect).
   *  Prevents the animation frame from processing events in the wrong simulation context. */
  const sessionSwitchPendingRef = useRef(false)
  const [sessionsWithActivity, setSessionsWithActivity] = useState<Set<string>>(new Set())
  const dismissedSessionsRef = useRef<Map<string, SessionInfo>>(new Map())

  /** Point the selection at a session and hold event delivery until the
   *  consumer's layout effect swaps simulation state and flushes. */
  const beginSwitch = useCallback((sessionId: string | null) => {
    sessionSwitchPendingRef.current = true
    pendingEventsRef.current.length = 0
    selectedSessionIdRef.current = sessionId
    setSelectedSessionId(sessionId)
  }, [])

  useEffect(() => {
    if (DEMO || typeof window === 'undefined') return

    const handleEvent = (event: AgentEvent) => {
      const simEvent: SimulationEvent = {
        time: event.time,
        type: event.type as SimulationEvent['type'],
        payload: event.payload,
        sessionId: event.sessionId,
      }
      const sessionId = event.sessionId
      if (!sessionId) return

      // Always buffer by session (for replay on session switch)
      const buf = sessionEventsRef.current.get(sessionId) || []
      buf.push(simEvent)
      sessionEventsRef.current.set(sessionId, buf)
      // Keep lastActivityTime roughly current (throttled: one state update per 5s per session)
      const now = Date.now()
      setSessions(prev => {
        const s = prev.find(x => x.id === sessionId)
        if (!s || now - s.lastActivityTime < 5000) return prev
        return prev.map(x => x.id === sessionId ? { ...x, lastActivityTime: now } : x)
      })

      // Deliver to pending if session matches (ref is always current).
      // Skip if a session switch is pending — the layout effect flushes
      // from the session buffer once the simulation state is swapped.
      const selected = selectedSessionIdRef.current
      if (sessionId === selected) {
        if (!sessionSwitchPendingRef.current) {
          pendingEventsRef.current.push(simEvent)
          setEventVersion(v => v + 1)
        }
      } else {
        // Track background activity for unselected sessions
        setSessionsWithActivity(prev => {
          if (prev.has(sessionId)) return prev
          const next = new Set(prev)
          next.add(sessionId)
          return next
        })
      }

      // Re-add dismissed sessions when new events arrive
      const saved = dismissedSessionsRef.current.get(sessionId)
      if (saved) {
        dismissedSessionsRef.current.delete(sessionId)
        setSessions(prev => prev.find(s => s.id === saved.id)
          ? prev
          : [...prev, { ...saved, status: 'active' as const, lastActivityTime: Date.now() }])
      }
    }

    const handleMessage = (msg: ServerMessage) => {
      switch (msg.type) {
        case 'agent-event':
          handleEvent(msg.event)
          break
        case 'agent-event-batch':
          for (const event of msg.events) handleEvent(event)
          break
        case 'reset':
          // New connection: the server replays everything that follows
          setSessions([])
          selectedSessionIdRef.current = null
          setSelectedSessionId(null)
          sessionSwitchPendingRef.current = false
          pendingEventsRef.current.length = 0
          sessionEventsRef.current.clear()
          dismissedSessionsRef.current.clear()
          setSessionsWithActivity(new Set())
          setEpoch(e => e + 1)
          break
        case 'session-list': {
          setSessions(msg.sessions)
          // Auto-select: prefer active sessions, then most recently active.
          if (!selectedSessionIdRef.current && msg.sessions.length > 0) {
            const sorted = [...msg.sessions].sort((a, b) => {
              const aActive = a.status === 'active' ? 1 : 0
              const bActive = b.status === 'active' ? 1 : 0
              if (aActive !== bActive) return bActive - aActive
              return b.lastActivityTime - a.lastActivityTime
            })
            beginSwitch(sorted[0].id)
          }
          break
        }
        case 'session-started': {
          const session = msg.session
          setSessions(prev => prev.find(s => s.id === session.id)
            // Session resumed after inactivity — mark active again
            ? prev.map(s => s.id === session.id ? { ...s, status: 'active' as const, lastActivityTime: Date.now() } : s)
            : [...prev, session])
          // Resuming the session already on screen must not re-arm the switch:
          // the layout effect only runs on a selection change, so nothing would
          // ever clear the pending flag and event delivery would freeze.
          if (session.id !== selectedSessionIdRef.current) beginSwitch(session.id)
          break
        }
        case 'session-updated':
          setSessions(prev => prev.map(s => s.id === msg.sessionId ? { ...s, label: msg.label } : s))
          break
        case 'session-ended':
          setSessions(prev => prev.map(s => s.id === msg.sessionId ? { ...s, status: 'completed' as const } : s))
          break
      }
    }

    const es = new EventSource('/events')
    es.onopen = () => setConnectionStatus('connected')
    es.onerror = () => setConnectionStatus('disconnected') // EventSource retries on its own
    es.onmessage = (e) => {
      try { handleMessage(JSON.parse(e.data) as ServerMessage) } catch { /* malformed message */ }
    }
    return () => es.close()
  }, [beginSwitch])

  const consumeEvents = useCallback(() => {
    // Clear in-place so stale closures in animation callbacks
    // also see the cleared array (prevents multi-frame reprocessing)
    pendingEventsRef.current.length = 0
  }, [])

  /** Switch session selection. Does NOT flush events — call flushSessionEvents
   *  from useLayoutEffect after the simulation state has been saved/swapped. */
  const selectSession = useCallback((sessionId: string | null) => {
    // Re-selecting the session on screen must not arm a switch: the layout
    // effect only runs on a change, so nothing would clear the pending flag.
    if (sessionId === selectedSessionIdRef.current) return
    beginSwitch(sessionId)
    if (sessionId) {
      setSessionsWithActivity(prev => {
        if (!prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
    }
  }, [beginSwitch])

  /** Flush buffered events for the selected session into pending.
   *  Must be called from useLayoutEffect AFTER simulation state is saved/swapped. */
  const flushSessionEvents = useCallback((sessionId: string, fromIndex = 0) => {
    sessionSwitchPendingRef.current = false
    const buffered = sessionEventsRef.current.get(sessionId) || []
    pendingEventsRef.current.length = 0
    pendingEventsRef.current.push(...buffered.slice(fromIndex))
    setEventVersion(v => v + 1)
  }, [])

  const getSessionEventCount = useCallback((sessionId: string): number => {
    return sessionEventsRef.current.get(sessionId)?.length ?? 0
  }, [])

  const removeSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const session = prev.find(s => s.id === sessionId)
      if (session) { dismissedSessionsRef.current.set(sessionId, session) }
      return prev.filter(s => s.id !== sessionId)
    })
    setSessionsWithActivity(prev => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
  }, [])

  return {
    connectionStatus,
    pendingEvents: pendingEventsRef.current,
    consumeEvents,
    useMockData: DEMO,
    sessions,
    selectedSessionId,
    selectedSessionIdRef,
    selectSession,
    flushSessionEvents,
    getSessionEventCount,
    sessionsWithActivity,
    removeSession,
    epoch,
  }
}
