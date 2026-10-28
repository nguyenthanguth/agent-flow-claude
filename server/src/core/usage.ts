/**
 * Per-agent token accounting from Claude Code transcripts.
 *
 * Every assistant entry carries the API's `usage` for the request that
 * produced it. `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
 * is the size of the context window at that request — the real number, so it
 * replaces the old character-count estimate and drops after a compaction.
 *
 * One API response is written as several entries (one per content block)
 * sharing `message.id` and the same usage, so totals are counted per message
 * id, by delta, to never bill a response twice.
 */

import type { WatchedSession } from './protocol'
import { ORCHESTRATOR_NAME } from './constants'

export interface ContextBreakdown {
  systemPrompt: number
  userMessages: number
  toolResults: number
  reasoning: number
  subagentResults: number
}

export interface UsageCounts {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

export interface AgentTracking {
  /** Estimated split of the context by kind (scaled to the real total when shown) */
  breakdown: ContextBreakdown
  /** Real context size at the agent's latest request, once known */
  contextTokens?: number
  /** Cumulative usage across all of the agent's requests */
  totals: UsageCounts
  /** Usage already counted, by API message id */
  counted: Map<string, UsageCounts>
  /** Why the agent's last turn ended, while it waits for the next one */
  turnEnd?: 'waiting' | 'interrupted'
}

const emptyBreakdown = (): ContextBreakdown => ({ systemPrompt: 0, userMessages: 0, toolResults: 0, reasoning: 0, subagentResults: 0 })
const emptyUsage = (): UsageCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })

/** Tracking state for one agent of a session. The orchestrator shares the
 *  session's breakdown, which prescan accumulates while attaching. */
export function trackingFor(session: WatchedSession, agentName: string): AgentTracking {
  session.agentTracking ??= new Map()
  let t = session.agentTracking.get(agentName)
  if (!t) {
    t = {
      breakdown: agentName === ORCHESTRATOR_NAME ? session.contextBreakdown : emptyBreakdown(),
      totals: emptyUsage(),
      counted: new Map(),
    }
    session.agentTracking.set(agentName, t)
  }
  return t
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/** Parse a transcript `message.usage` object, or null if there is none. */
export function parseUsage(usage: unknown): UsageCounts | null {
  if (!usage || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>
  const creation = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation as Record<string, unknown> : null
  const write1h = creation ? num(creation.ephemeral_1h_input_tokens) : 0
  const writeTotal = num(u.cache_creation_input_tokens)
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite1h: write1h,
    // Anything not reported as 1-hour cache writes is billed as 5-minute writes
    cacheWrite5m: Math.max(0, writeTotal - write1h),
  }
}

/** Context window size the request used */
export function contextSize(u: UsageCounts): number {
  return u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h
}

/** Record one entry's usage. Returns the not-yet-counted part (null if none),
 *  so repeated entries of the same response add nothing. */
export function recordUsage(t: AgentTracking, messageId: string | undefined, u: UsageCounts): UsageCounts | null {
  t.contextTokens = contextSize(u)
  const key = messageId ?? `anon-${t.counted.size}`
  const prev = t.counted.get(key) ?? emptyUsage()
  const delta: UsageCounts = {
    input: Math.max(0, u.input - prev.input),
    output: Math.max(0, u.output - prev.output),
    cacheRead: Math.max(0, u.cacheRead - prev.cacheRead),
    cacheWrite5m: Math.max(0, u.cacheWrite5m - prev.cacheWrite5m),
    cacheWrite1h: Math.max(0, u.cacheWrite1h - prev.cacheWrite1h),
  }
  t.counted.set(key, {
    input: Math.max(prev.input, u.input),
    output: Math.max(prev.output, u.output),
    cacheRead: Math.max(prev.cacheRead, u.cacheRead),
    cacheWrite5m: Math.max(prev.cacheWrite5m, u.cacheWrite5m),
    cacheWrite1h: Math.max(prev.cacheWrite1h, u.cacheWrite1h),
  })
  if (!delta.input && !delta.output && !delta.cacheRead && !delta.cacheWrite5m && !delta.cacheWrite1h) return null
  for (const k of Object.keys(delta) as (keyof UsageCounts)[]) t.totals[k] += delta[k]
  return delta
}

/** Breakdown scaled so its parts add up to the real context size, when known */
export function scaledBreakdown(t: AgentTracking): { tokens: number; breakdown: ContextBreakdown } {
  const bd = t.breakdown
  const estimate = bd.systemPrompt + bd.userMessages + bd.toolResults + bd.reasoning + bd.subagentResults
  const tokens = t.contextTokens ?? estimate
  if (t.contextTokens === undefined || estimate <= 0) return { tokens, breakdown: { ...bd } }
  const s = t.contextTokens / estimate
  return {
    tokens,
    breakdown: {
      systemPrompt: Math.round(bd.systemPrompt * s),
      userMessages: Math.round(bd.userMessages * s),
      toolResults: Math.round(bd.toolResults * s),
      reasoning: Math.round(bd.reasoning * s),
      subagentResults: Math.round(bd.subagentResults * s),
    },
  }
}
