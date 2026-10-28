/**
 * Relay — watches Claude Code session transcripts for a workspace and streams
 * the resulting agent events to SSE clients.
 *
 * Transcripts are the single source of truth: the main session JSONL at
 * ~/.claude/projects/<encoded>/<session>.jsonl plus one JSONL per subagent in
 * <session>/subagents/. Nothing is installed into Claude Code's settings.
 */
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

import { AgentEvent, SessionInfo, ServerMessage, WatchedSession } from './core/protocol'
import { TranscriptParser } from './core/transcript-parser'
import { readNewFileLines, completeLinesSize, foldPathCase } from './core/fs-utils'
import { scanSubagentsDir, pollSubagent } from './core/subagent-watcher'
import { appendCapped } from './event-buffer'
import {
  INACTIVITY_TIMEOUT_MS, SCAN_INTERVAL_MS, ACTIVE_SESSION_AGE_S, POLL_FALLBACK_MS,
  SESSION_ID_DISPLAY, SYSTEM_PROMPT_BASE_TOKENS, ORCHESTRATOR_NAME,
} from './core/constants'
import { setLogLevel } from './core/logger'

const MAX_EVENT_BUFFER = 5000
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects')

let verbose = false

function log(...args: unknown[]) {
  if (verbose) console.log(...args)
}

// ─── SSE client management ──────────────────────────────────────────────────

const sseClients = new Set<http.ServerResponse>()

function sendSSE(res: http.ServerResponse, message: ServerMessage) {
  try { res.write(`data: ${JSON.stringify(message)}\n\n`) } catch {
    sseClients.delete(res)
  }
}

function broadcast(message: ServerMessage) {
  for (const res of sseClients) sendSSE(res, message)
}

// ─── Event buffering ────────────────────────────────────────────────────────

/** Per-session event history, replayed to every client that connects */
const eventBuffer = new Map<string, AgentEvent[]>()

function broadcastEvent(event: AgentEvent) {
  log(`[event] ${event.type} (session ${event.sessionId?.slice(0, SESSION_ID_DISPLAY) || '?'})`)

  if (event.sessionId) {
    eventBuffer.set(event.sessionId, appendCapped(eventBuffer.get(event.sessionId) || [], event, MAX_EVENT_BUFFER))
  }

  broadcast({ type: 'agent-event', event })
}

function sessionInfo(session: WatchedSession): SessionInfo {
  return {
    id: session.sessionId,
    label: session.label,
    status: session.sessionCompleted ? 'completed' : 'active',
    startTime: session.sessionStartTime,
    lastActivityTime: session.lastActivityTime,
  }
}

function broadcastSessionLifecycle(type: 'started' | 'ended' | 'updated', sessionId: string, label: string) {
  if (type === 'started') {
    const session = sessions.get(sessionId)
    if (session) broadcast({ type: 'session-started', session: sessionInfo(session) })
  } else if (type === 'ended') {
    broadcast({ type: 'session-ended', sessionId })
  } else {
    broadcast({ type: 'session-updated', sessionId, label })
  }
}

// ─── Session watcher ────────────────────────────────────────────────────────

const sessions = new Map<string, WatchedSession>()

function elapsed(sessionId?: string): number {
  if (sessionId) {
    const session = sessions.get(sessionId)
    if (session) return (Date.now() - session.sessionStartTime) / 1000
  }
  return 0
}

function emitContextUpdate(agentName: string, session: WatchedSession, sessionId?: string) {
  const bd = session.contextBreakdown
  const total = bd.systemPrompt + bd.userMessages + bd.toolResults + bd.reasoning + bd.subagentResults
  broadcastEvent({
    time: elapsed(sessionId),
    type: 'context_update',
    payload: { agent: agentName, tokens: total, breakdown: { ...bd } },
    sessionId,
  })
}

function emitEvent(event: AgentEvent, sessionId?: string) {
  broadcastEvent(sessionId ? { ...event, sessionId } : event)
}

const parser = new TranscriptParser({
  emit: emitEvent,
  elapsed,
  getSession: (sessionId: string) => sessions.get(sessionId),
  fireSessionLifecycle: (event) => broadcastSessionLifecycle(event.type, event.sessionId, event.label),
  emitContextUpdate,
})

const watcherDelegate = {
  emit: emitEvent,
  elapsed,
  getSession: (sessionId: string) => sessions.get(sessionId),
  resetInactivityTimer: (sessionId: string) => resetInactivityTimer(sessionId),
}

function spawnOrchestrator(session: WatchedSession, time: number) {
  broadcastEvent({
    time, type: 'agent_spawn',
    payload: { name: ORCHESTRATOR_NAME, isMain: true, task: session.label, ...(session.model ? { model: session.model } : {}) },
    sessionId: session.sessionId,
  })
}

function resetInactivityTimer(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return

  const wasCompleted = session.sessionCompleted
  session.lastActivityTime = Date.now()
  session.sessionCompleted = false

  if (wasCompleted) {
    log(`[session] ${sessionId.slice(0, SESSION_ID_DISPLAY)} resumed`)
    broadcastSessionLifecycle('started', sessionId, session.label)
  }

  if (session.inactivityTimer) clearTimeout(session.inactivityTimer)
  session.inactivityTimer = setTimeout(() => {
    if (session.sessionCompleted || !session.sessionDetected) return
    log(`[session] ${sessionId.slice(0, SESSION_ID_DISPLAY)} inactive`)
    session.sessionCompleted = true
    // Idle, not complete: the session may resume at any time, and completing
    // the orchestrator would cascade to (and hide) every agent in the graph.
    broadcastEvent({
      time: elapsed(sessionId),
      type: 'agent_idle',
      payload: { name: ORCHESTRATOR_NAME },
      sessionId,
    })
    broadcastSessionLifecycle('ended', sessionId, session.label)
  }, INACTIVITY_TIMEOUT_MS)
}

function watchSession(sessionId: string, filePath: string) {
  const session: WatchedSession = {
    sessionId, filePath,
    fileWatcher: null, pollTimer: null, fileSize: 0,
    sessionStartTime: Date.now(),
    pendingToolCalls: new Map(),
    seenToolUseIds: new Set(),
    seenMessageHashes: new Set(),
    sessionDetected: false, sessionCompleted: false,
    lastActivityTime: Date.now(),
    inactivityTimer: null,
    subagentWatchers: new Map(),
    spawnedSubagents: new Set(),
    inlineProgressAgents: new Set(),
    subagentsDirWatcher: null, subagentsScanned: false,
    subagentsDir: path.join(path.dirname(filePath), sessionId, 'subagents'),
    label: `Session ${sessionId.slice(0, SESSION_ID_DISPLAY)}`, labelSet: false,
    model: null,
    modelDetectedAgents: new Map(),
    contextBreakdown: { systemPrompt: SYSTEM_PROMPT_BASE_TOKENS, userMessages: 0, toolResults: 0, reasoning: 0, subagentResults: 0 },
  }
  sessions.set(sessionId, session)

  // Prescan complete lines only — a line still being written is picked up by readNewLines
  const size = completeLinesSize(filePath, fs.statSync(filePath).size)
  const catchUpEntries = parser.prescanExistingContent(filePath, size, session)
  session.fileSize = size
  parser.extractSessionLabel(catchUpEntries, session)

  session.sessionDetected = true
  broadcastSessionLifecycle('started', sessionId, session.label)
  spawnOrchestrator(session, 0)
  emitContextUpdate(ORCHESTRATOR_NAME, session, sessionId)
  parser.emitCatchUpEntries(catchUpEntries, session, sessionId)

  try {
    session.fileWatcher = fs.watch(filePath, (eventType) => {
      if (eventType === 'change') readNewLines(sessionId)
    })
  } catch { /* the poll below still picks up new lines */ }

  session.pollTimer = setInterval(() => {
    readNewLines(sessionId)
    for (const [subPath] of session.subagentWatchers) {
      pollSubagent(watcherDelegate, parser, subPath, sessionId)
    }
    scanSubagentsDir(watcherDelegate, parser, sessionId)
  }, POLL_FALLBACK_MS)

  // Spawns subagents that were already running before we attached
  scanSubagentsDir(watcherDelegate, parser, sessionId)
  resetInactivityTimer(sessionId)

  log(`[session] Watching ${sessionId.slice(0, SESSION_ID_DISPLAY)} — "${session.label}"`)
}

function readNewLines(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return

  const result = readNewFileLines(session.filePath, session.fileSize)
  if (!result) return
  session.fileSize = result.newSize
  for (const line of result.lines) {
    parser.processTranscriptLine(line, ORCHESTRATOR_NAME, session.pendingToolCalls, session.seenToolUseIds, sessionId, session.seenMessageHashes)
  }

  scanSubagentsDir(watcherDelegate, parser, sessionId)
  resetInactivityTimer(sessionId)
}

// ─── Session scanner ────────────────────────────────────────────────────────

function encodeWorkspace(workspace: string): string {
  let resolved = workspace
  try { resolved = fs.realpathSync(resolved) } catch {}
  return resolved.replace(/[^a-zA-Z0-9]/g, '-')
}

/** Project dirs for the workspace and its subfolders. Case-folded on Windows —
 *  shells report `c:\...` while Claude Code encodes `C--...`. */
function projectDirsFor(workspace: string): string[] {
  if (!fs.existsSync(CLAUDE_DIR)) return []
  const encodedFolded = foldPathCase(encodeWorkspace(workspace))
  const dirs: string[] = []
  try {
    for (const dir of fs.readdirSync(CLAUDE_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      const nameFolded = foldPathCase(dir.name)
      if (nameFolded === encodedFolded || nameFolded.startsWith(encodedFolded + '-')) {
        dirs.push(path.join(CLAUDE_DIR, dir.name))
      }
    }
  } catch {}
  return dirs
}

function scanForActiveSessions(workspace: string) {
  for (const dirPath of projectDirsFor(workspace)) {
    try {
      for (const file of fs.readdirSync(dirPath)) {
        if (!file.endsWith('.jsonl')) continue
        const sessionId = path.basename(file, '.jsonl')
        if (sessions.has(sessionId)) continue
        const filePath = path.join(dirPath, file)

        // A session counts as active if its transcript or any subagent's was written recently
        let newestMtime = fs.statSync(filePath).mtimeMs
        const subagentsDir = path.join(dirPath, sessionId, 'subagents')
        try {
          for (const subFile of fs.readdirSync(subagentsDir)) {
            if (!subFile.endsWith('.jsonl')) continue
            newestMtime = Math.max(newestMtime, fs.statSync(path.join(subagentsDir, subFile)).mtimeMs)
          }
        } catch { /* no subagents dir */ }

        if ((Date.now() - newestMtime) / 1000 <= ACTIVE_SESSION_AGE_S) {
          watchSession(sessionId, filePath)
        }
      }
    } catch {}
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface Relay {
  /** Handle an incoming SSE connection */
  handleSSE: (req: http.IncomingMessage, res: http.ServerResponse) => void
  /** Clean up all resources */
  dispose: () => void
}

export interface RelayOptions {
  workspace: string
  verbose?: boolean
}

let relayCreated = false

export function createRelay(options: RelayOptions): Relay {
  if (relayCreated) {
    throw new Error('createRelay() can only be called once per process')
  }
  relayCreated = true

  const { workspace } = options
  verbose = options.verbose ?? false
  // Keep warnings visible without --verbose — actionable hints must reach the user.
  if (!verbose) setLogLevel('warn')

  scanForActiveSessions(workspace)
  const scanInterval = setInterval(() => scanForActiveSessions(workspace), SCAN_INTERVAL_MS)

  // React to new transcripts immediately instead of waiting for the next scan
  const dirWatchers: fs.FSWatcher[] = []
  for (const dir of projectDirsFor(workspace)) {
    try {
      dirWatchers.push(fs.watch(dir, (_eventType, filename) => {
        if (filename?.endsWith('.jsonl')) scanForActiveSessions(workspace)
      }))
    } catch {}
  }

  return {
    handleSSE(req: http.IncomingMessage, res: http.ServerResponse) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })

      sseClients.add(res)
      log(`[sse] Client connected (${sseClients.size} total)`)

      req.on('close', () => {
        sseClients.delete(res)
        log(`[sse] Client disconnected (${sseClients.size} total)`)
      })

      // Every connection starts from a clean slate: a reconnecting client must
      // drop what it has, or the replay below would duplicate its events.
      sendSSE(res, { type: 'reset', reason: 'connected' })

      const detected = [...sessions.values()].filter(s => s.sessionDetected)
      if (detected.length === 0) return
      sendSSE(res, { type: 'session-list', sessions: detected.map(sessionInfo) })
      for (const session of detected) {
        const buffered = eventBuffer.get(session.sessionId)
        if (buffered?.length) sendSSE(res, { type: 'agent-event-batch', events: buffered })
      }
    },

    dispose() {
      clearInterval(scanInterval)
      for (const w of dirWatchers) w.close()
      for (const session of sessions.values()) {
        session.fileWatcher?.close()
        session.subagentsDirWatcher?.close()
        for (const sub of session.subagentWatchers.values()) sub.watcher?.close()
        if (session.pollTimer) clearInterval(session.pollTimer)
        if (session.inactivityTimer) clearTimeout(session.inactivityTimer)
      }
      for (const res of sseClients) res.end()
      sseClients.clear()
    },
  }
}
