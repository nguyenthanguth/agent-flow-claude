import { memo } from "react"
import { Z } from "@/lib/agent-types"
import { COLORS } from "@/lib/colors"
import { formatTokens } from "@/lib/utils"
import { agentCost } from "./canvas/draw-cost"
import { SessionTabs } from "./session-tabs"
import type { SessionInfo, ConnectionStatus } from "@/lib/bridge-types"

// ─── Icons ──────────────────────────────────────────────────────────────────

function MutedIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  )
}

function UnmutedIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

function BrandMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill={COLORS.holoBase} />
      <circle cx="16" cy="16" r="5" fill={COLORS.void} />
    </svg>
  )
}

// ─── Buttons ────────────────────────────────────────────────────────────────

const surface: React.CSSProperties = {
  background: COLORS.glassBg,
  border: `1px solid ${COLORS.glassBorder}`,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
}

function SegmentButton({ active, onClick, children, title }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors flex items-center"
      style={{
        background: active ? COLORS.toggleActive : 'transparent',
        color: active ? COLORS.holoBright : COLORS.textDim,
      }}
    >
      {children}
    </button>
  )
}

// ─── Connection Status ──────────────────────────────────────────────────────

function ConnectionIndicator({ status, isDemo }: { status: ConnectionStatus; isDemo: boolean }) {
  const { color, label } = isDemo
    ? { color: COLORS.waiting_permission, label: 'Demo' }
    : status === 'disconnected'
      ? { color: COLORS.error, label: 'Reconnecting…' }
      : { color: COLORS.complete, label: 'Live' }

  return (
    <span className="flex items-center gap-2 text-[12px] font-medium" style={{ color: COLORS.textDim }}>
      <span className="relative flex w-2 h-2">
        {!isDemo && status !== 'disconnected' && (
          <span className="absolute inset-0 rounded-full animate-ping" style={{ background: color, opacity: 0.45 }} />
        )}
        <span className="relative w-2 h-2 rounded-full" style={{ background: color }} />
      </span>
      {label}
    </span>
  )
}

// ─── Top Bar ────────────────────────────────────────────────────────────────

export interface TopBarProps {
  // Session tabs
  sessions: SessionInfo[]
  selectedSessionId: string | null
  sessionsWithActivity: Set<string>
  onSelectSession: (id: string) => void
  onCloseSession: (id: string) => void
  // Connection
  connectionStatus: ConnectionStatus
  isDemo: boolean
  // Stats
  agentCount: number
  totalTokens: number
  // Panel toggles
  showFileAttention: boolean
  showTranscript: boolean
  showCostOverlay: boolean
  showTimeline: boolean
  isMuted: boolean
  onTogglePanel: (panel: 'files' | 'transcript' | 'cost') => void
  onToggleTimeline: () => void
  onToggleMute: () => void
}

export const TopBar = memo(function TopBar({
  sessions, selectedSessionId, sessionsWithActivity,
  onSelectSession, onCloseSession,
  connectionStatus, isDemo,
  agentCount, totalTokens,
  showFileAttention, showTranscript, showCostOverlay, showTimeline, isMuted,
  onTogglePanel, onToggleTimeline, onToggleMute,
}: TopBarProps) {
  return (
    <div className="absolute top-3 left-3 right-3 flex items-center gap-3" style={{ zIndex: Z.info }}>
      {/* Brand */}
      <div className="flex items-center gap-2 h-9 px-3 rounded-xl flex-shrink-0" style={surface}>
        <BrandMark />
        <span className="text-[13px] font-semibold tracking-tight" style={{ color: COLORS.textPrimary }}>agent-flow-claude</span>
      </div>

      {/* Session tabs — scrollable, takes available space */}
      {sessions.length > 0 && (
        <div className="min-w-0 flex-shrink overflow-x-auto scrollbar-hide">
          <SessionTabs
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            sessionsWithActivity={sessionsWithActivity}
            onSelectSession={onSelectSession}
            onCloseSession={onCloseSession}
          />
        </div>
      )}

      <div className="flex-1" />

      {/* Status + stats */}
      <div className="flex items-center gap-4 h-9 px-3.5 rounded-xl flex-shrink-0" style={surface}>
        <ConnectionIndicator status={connectionStatus} isDemo={isDemo} />
        <span className="w-px h-4" style={{ background: COLORS.glassBorder }} />
        <span className="text-[12px] tabular-nums" style={{ color: COLORS.textDim }}>
          <span style={{ color: COLORS.textPrimary }}>{agentCount}</span> agents
        </span>
        <span className="text-[12px] tabular-nums" style={{ color: COLORS.textDim }}>
          <span style={{ color: COLORS.textPrimary }}>{formatTokens(totalTokens)}</span> tokens
          <span className="ml-1.5" style={{ color: COLORS.costText }}>~${agentCost(totalTokens).toFixed(2)}</span>
        </span>
      </div>

      {/* Panels */}
      <div className="flex items-center gap-0.5 h-9 px-1 rounded-xl flex-shrink-0" style={surface}>
        <SegmentButton active={showTranscript} onClick={() => onTogglePanel('transcript')} title="Session transcript">Chat</SegmentButton>
        <SegmentButton active={showFileAttention} onClick={() => onTogglePanel('files')} title="Files touched">Files</SegmentButton>
        <SegmentButton active={showCostOverlay} onClick={() => onTogglePanel('cost')} title="Cost breakdown">Cost</SegmentButton>
        <span className="w-px h-4 mx-1" style={{ background: COLORS.glassBorder }} />
        <SegmentButton active={showTimeline} onClick={onToggleTimeline} title="Timeline">Timeline</SegmentButton>
        <SegmentButton active={!isMuted} onClick={onToggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
          {isMuted ? <MutedIcon /> : <UnmutedIcon />}
        </SegmentButton>
      </div>
    </div>
  )
})
