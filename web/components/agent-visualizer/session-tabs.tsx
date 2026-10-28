import { useEffect, useRef, useCallback } from 'react'
import { COLORS } from '@/lib/colors'
import type { SessionInfo } from '@/lib/bridge-types'

interface SessionTabsProps {
  sessions: SessionInfo[]
  selectedSessionId: string | null
  sessionsWithActivity: Set<string>
  onSelectSession: (id: string) => void
  onCloseSession: (id: string) => void
}

export function SessionTabs({
  sessions,
  selectedSessionId,
  sessionsWithActivity,
  onSelectSession,
  onCloseSession,
}: SessionTabsProps) {
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  const setButtonRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) buttonRefs.current.set(id, el)
    else buttonRefs.current.delete(id)
  }, [])

  // Scroll selected tab into view whenever it changes
  useEffect(() => {
    if (!selectedSessionId) return
    const el = buttonRefs.current.get(selectedSessionId)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [selectedSessionId])

  return (
    <div className="flex gap-1.5">
      {sessions.map(session => {
        const isSelected = session.id === selectedSessionId
        const isActive = session.status === 'active'
        const hasActivity = sessionsWithActivity.has(session.id)
        return (
          <button
            key={session.id}
            ref={(el) => setButtonRef(session.id, el)}
            onClick={() => onSelectSession(session.id)}
            title={session.label}
            className="group h-9 pl-3 pr-2 rounded-xl transition-colors flex items-center gap-2 text-[12px] font-medium"
            style={{
              flexShrink: 0,
              whiteSpace: 'nowrap',
              background: isSelected ? COLORS.cardBgSelected : COLORS.glassBg,
              border: `1px solid ${isSelected ? COLORS.tabSelectedBorder : COLORS.glassBorder}`,
              color: isSelected ? COLORS.textPrimary : COLORS.textDim,
            }}
          >
            <span
              className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${hasActivity && !isSelected ? 'animate-pulse' : ''}`}
              style={{ background: hasActivity && !isSelected ? COLORS.unreadDot : isActive ? COLORS.complete : COLORS.paused }}
            />
            <span className="max-w-[240px] overflow-hidden text-ellipsis">{session.label}</span>
            <span
              role="button"
              aria-label="Close session tab"
              className="w-5 h-5 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: COLORS.textMuted }}
              onClick={(e) => {
                e.stopPropagation()
                onCloseSession(session.id)
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </span>
          </button>
        )
      })}
    </div>
  )
}
