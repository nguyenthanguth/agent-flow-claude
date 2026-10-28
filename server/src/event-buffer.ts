/**
 * Bounded per-session event history, replayed to every client that connects.
 *
 * Replay is the only way a reloaded page rebuilds its graph, so trimming must
 * never drop the events that define the graph's shape: without the original
 * agent_spawn, a long session's orchestrator (and early subagents) would be
 * missing after a reload. Those are kept; tool calls, messages and context
 * updates from the trimmed range are the ones let go.
 */
import type { AgentEvent, AgentEventType } from './core/protocol'

/** Events that create, connect, finish or label agents */
const STRUCTURAL: ReadonlySet<AgentEventType> = new Set<AgentEventType>([
  'agent_spawn', 'subagent_dispatch', 'subagent_return', 'agent_complete', 'model_detected',
])

/** Append an event, trimming the oldest non-structural events beyond `max`.
 *  Trims in batches (a quarter of `max`) so steady-state appends stay O(1). */
export function appendCapped(buf: AgentEvent[], event: AgentEvent, max: number): AgentEvent[] {
  buf.push(event)
  if (buf.length <= max) return buf

  const cut = buf.length - Math.floor(max * 0.75)
  const kept = buf.slice(0, cut).filter(e => STRUCTURAL.has(e.type))
  return kept.concat(buf.slice(cut))
}
