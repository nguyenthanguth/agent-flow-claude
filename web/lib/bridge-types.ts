/**
 * Shared types for the server → web protocol (SSE).
 *
 * These types mirror server/src/core/protocol.ts and are kept separate
 * to avoid cross-project imports. When updating these, also update
 * the canonical definitions in server/src/core/protocol.ts.
 */

export interface AgentEvent {
  time: number
  type: string
  payload: Record<string, unknown>
  sessionId?: string
}

export interface SessionInfo {
  id: string
  label: string
  status: 'active' | 'completed'
  startTime: number
  lastActivityTime: number
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'watching'

// ─── Plan usage (5-hour / weekly limits) — mirrors PlanUsageReport ──────────

export interface PlanLimit {
  id: string
  /** "session" (5-hour window) or "weekly" */
  group: string
  label: string
  percent: number
  severity: string
  /** ms epoch */
  resetsAt?: number
  active: boolean
}

export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

export interface PlanUsageReport {
  status: 'ok' | 'signed-out' | 'expired' | 'unavailable' | 'disabled'
  plan?: string
  limits: PlanLimit[]
  fetchedAt: number
  error?: string
  windows: Array<{ group: string; since: number; byModel: Record<string, UsageTotals> }>
}
