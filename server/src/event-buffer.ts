/**
 * Bounded per-session event history, replayed to every client that connects.
 *
 * Replay is the only way a reloaded page rebuilds its graph, so trimming must
 * never drop the events that define the graph's shape: without the original
 * agent_spawn, a long session's orchestrator (and early subagents) would be
 * missing after a reload. Those are kept, and trimmed `usage` events are
 * folded into one total per agent so cost survives too. Tool calls, messages
 * and context updates from the trimmed range are the ones let go.
 */
import type { AgentEvent, AgentEventType } from './core/protocol'

/** Events that create, connect, finish or label agents */
const STRUCTURAL: ReadonlySet<AgentEventType> = new Set<AgentEventType>([
  'agent_spawn', 'subagent_dispatch', 'subagent_return', 'agent_complete', 'model_detected',
])

const USAGE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'] as const

/** Sum usage events per agent, in first-seen order */
function foldUsage(events: AgentEvent[]): AgentEvent[] {
  const byAgent = new Map<string, AgentEvent>()
  for (const e of events) {
    const agent = String(e.payload.agent ?? '')
    const acc = byAgent.get(agent)
    if (!acc) {
      byAgent.set(agent, { ...e, payload: { ...e.payload } })
      continue
    }
    for (const f of USAGE_FIELDS) acc.payload[f] = (Number(acc.payload[f]) || 0) + (Number(e.payload[f]) || 0)
    if (e.payload.model) acc.payload.model = e.payload.model
  }
  return [...byAgent.values()]
}

/** Append an event, trimming the oldest non-structural events beyond `max`.
 *  Trims in batches (a quarter of `max`) so steady-state appends stay O(1). */
export function appendCapped(buf: AgentEvent[], event: AgentEvent, max: number): AgentEvent[] {
  buf.push(event)
  if (buf.length <= max) return buf

  const cut = buf.length - Math.floor(max * 0.75)
  const head = buf.slice(0, cut)
  const kept = head.filter(e => STRUCTURAL.has(e.type))
  const usage = foldUsage(head.filter(e => e.type === 'usage'))
  return kept.concat(usage, buf.slice(cut))
}
