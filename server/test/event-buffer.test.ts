/**
 * Unit tests for the replay buffer cap: trimming must keep every event that
 * shapes the graph, so a reload of a long session still has its agents.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { appendCapped } from '../src/event-buffer'
import type { AgentEvent, AgentEventType } from '../src/core/protocol'

const ev = (type: AgentEventType, n: number): AgentEvent => ({ time: n, type, payload: { n }, sessionId: 's' })

describe('appendCapped', () => {
  it('keeps everything under the cap', () => {
    let buf: AgentEvent[] = []
    for (let i = 0; i < 10; i++) buf = appendCapped(buf, ev('message', i), 10)
    assert.equal(buf.length, 10)
  })

  it('trims old non-structural events but keeps spawns and completions, in order', () => {
    let buf: AgentEvent[] = []
    buf = appendCapped(buf, ev('agent_spawn', 0), 100)
    buf = appendCapped(buf, ev('subagent_dispatch', 1), 100)
    buf = appendCapped(buf, ev('agent_spawn', 2), 100)
    for (let i = 3; i < 400; i++) buf = appendCapped(buf, ev(i === 50 ? 'agent_complete' : 'tool_call_start', i), 100)

    assert.ok(buf.length <= 100 + 4)
    assert.deepEqual(buf.slice(0, 4).map(e => e.type), ['agent_spawn', 'subagent_dispatch', 'agent_spawn', 'agent_complete'])
    assert.equal(buf[buf.length - 1].time, 399)
    const times = buf.map(e => e.time)
    assert.deepEqual(times, [...times].sort((a, b) => a - b))
  })
})
