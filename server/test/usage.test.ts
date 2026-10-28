/**
 * Real token usage and turn state from transcripts.
 *
 * Invariants: context size comes from the API's usage (not a character
 * estimate) and is tracked per agent; a response written as several entries
 * is counted once; the main agent is shown waiting when its turn ends.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TranscriptParser } from '../src/core/transcript-parser'
import { trackingFor, parseUsage, scaledBreakdown } from '../src/core/usage'
import { AgentEvent, WatchedSession } from '../src/core/protocol'

const SESSION_ID = 'session-1'

function setup() {
  const session = {
    sessionId: SESSION_ID, filePath: '', fileWatcher: null, pollTimer: null, fileSize: 0, sessionStartTime: Date.now(),
    pendingToolCalls: new Map(), seenToolUseIds: new Set(), seenMessageHashes: new Set(),
    sessionDetected: true, sessionCompleted: false, lastActivityTime: Date.now(), inactivityTimer: null,
    subagentWatchers: new Map(), spawnedSubagents: new Set(), inlineProgressAgents: new Set(),
    subagentsDirWatcher: null, subagentsDir: null, subagentsScanned: false,
    label: 'Session', labelSet: false, model: null, modelDetectedAgents: new Map(),
    contextBreakdown: { systemPrompt: 5000, userMessages: 0, toolResults: 0, reasoning: 0, subagentResults: 0 },
  } as WatchedSession
  const events: AgentEvent[] = []
  const labels: string[] = []
  const parser = new TranscriptParser({
    emit: (e) => { events.push(e) },
    elapsed: () => 0,
    getSession: (id) => (id === SESSION_ID ? session : undefined),
    fireSessionLifecycle: (e) => { labels.push(e.label) },
    emitContextUpdate: (agent) => { events.push({ time: 0, type: 'context_update', payload: { agent } }) },
  })
  const feed = (entry: unknown, agent = 'orchestrator') => parser.processTranscriptLine(
    JSON.stringify(entry), agent, agent === 'orchestrator' ? session.pendingToolCalls : new Map(),
    agent === 'orchestrator' ? session.seenToolUseIds : new Set(), SESSION_ID, agent === 'orchestrator' ? session.seenMessageHashes : new Set())
  return { session, events, labels, parser, feed }
}

/** Shape copied from a real Claude Code 2.1 transcript */
const usage = (read: number, out: number) => ({
  input_tokens: 4, cache_creation_input_tokens: 1441, cache_read_input_tokens: read, output_tokens: out,
  cache_creation: { ephemeral_1h_input_tokens: 1441, ephemeral_5m_input_tokens: 0 },
})
const assistant = (uuid: string, id: string, stop: string, content: unknown[], u = usage(678187, 2436)) => ({
  type: 'assistant', uuid,
  message: { role: 'assistant', id, model: 'claude-opus-5-5', stop_reason: stop, usage: u, content },
})
const ofType = (events: AgentEvent[], type: string) => events.filter(e => e.type === type)

describe('usage', () => {
  it('parses 1-hour cache writes separately', () => {
    assert.deepEqual(parseUsage(usage(10, 2)), { input: 4, output: 2, cacheRead: 10, cacheWrite1h: 1441, cacheWrite5m: 0 })
    assert.equal(parseUsage(undefined), null)
  })

  it('sets the real context size and counts a multi-entry response once', () => {
    const { session, events, feed } = setup()
    feed(assistant('a1', 'msg_1', 'tool_use', [{ type: 'thinking', thinking: '', signature: 'x' }]))
    feed(assistant('a2', 'msg_1', 'tool_use', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]))

    assert.equal(trackingFor(session, 'orchestrator').contextTokens, 4 + 1441 + 678187)
    const used = ofType(events, 'usage')
    assert.equal(used.length, 1)
    assert.equal(used[0].payload.cacheRead, 678187)
    assert.equal(used[0].payload.model, 'claude-opus-5-5')
  })

  it('counts only the growth when a later entry of the same response reports more output', () => {
    const { session, events, feed } = setup()
    feed(assistant('a1', 'msg_1', 'tool_use', [{ type: 'text', text: 'a' }], usage(100, 10)))
    feed(assistant('a2', 'msg_1', 'tool_use', [{ type: 'text', text: 'b' }], usage(100, 25)))
    assert.deepEqual(ofType(events, 'usage').map(e => e.payload.output), [10, 15])
    assert.equal(trackingFor(session, 'orchestrator').totals.output, 25)
  })

  it('keeps subagent context separate from the main agent', () => {
    const { session, feed } = setup()
    feed(assistant('a1', 'msg_1', 'tool_use', [{ type: 'text', text: 'main' }], usage(600000, 5)))
    feed(assistant('s1', 'msg_s', 'tool_use', [{ type: 'text', text: 'sub' }], usage(19000, 5)), 'Review the diff')
    assert.equal(trackingFor(session, 'orchestrator').contextTokens, 4 + 1441 + 600000)
    assert.equal(trackingFor(session, 'Review the diff').contextTokens, 4 + 1441 + 19000)
  })

  it('scales the estimated breakdown to the real total', () => {
    const { session, feed } = setup()
    feed(assistant('a1', 'msg_1', 'tool_use', [{ type: 'text', text: 'x'.repeat(4000) }], usage(20000, 5)))
    const { tokens, breakdown } = scaledBreakdown(trackingFor(session, 'orchestrator'))
    assert.equal(tokens, 4 + 1441 + 20000)
    const sum = Object.values(breakdown).reduce((a, b) => a + b, 0)
    assert.ok(Math.abs(sum - tokens) <= 5)
  })
})

describe('turn state', () => {
  it('marks the main agent waiting after end_turn, as the last event of the entry', () => {
    const { events, feed } = setup()
    feed(assistant('a1', 'msg_1', 'end_turn', [{ type: 'text', text: 'Done — anything else?' }]))
    const last = events[events.length - 1]
    assert.equal(last.type, 'agent_idle')
    assert.deepEqual(last.payload, { name: 'orchestrator', reason: 'waiting' })
  })

  it('does not mark it waiting mid-turn, or for subagents', () => {
    const { events, feed } = setup()
    feed(assistant('a1', 'msg_1', 'tool_use', [{ type: 'text', text: 'checking' }]))
    feed(assistant('s1', 'msg_s', 'end_turn', [{ type: 'text', text: 'sub done' }]), 'Review the diff')
    assert.equal(ofType(events, 'agent_idle').length, 0)
  })

  it('marks an interrupted turn', () => {
    const { events, feed } = setup()
    feed({ type: 'user', uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } })
    assert.deepEqual(ofType(events, 'agent_idle').map(e => e.payload.reason), ['interrupted'])
  })

  it('restores both from history at attach time', () => {
    const { session, parser } = setup()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-usage-'))
    const file = path.join(dir, 's.jsonl')
    const lines = [
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Fix the bug' } },
      assistant('a1', 'msg_1', 'tool_use', [{ type: 'text', text: 'on it' }], usage(1000, 100)),
      assistant('a2', 'msg_2', 'end_turn', [{ type: 'text', text: 'fixed' }], usage(2000, 50)),
      { type: 'ai-title', aiTitle: 'Fix the login bug', sessionId: SESSION_ID },
    ].map(l => JSON.stringify(l)).join('\n') + '\n'
    fs.writeFileSync(file, lines)
    parser.prescanExistingContent(file, Buffer.byteLength(lines), session)

    const t = trackingFor(session, 'orchestrator')
    assert.equal(t.turnEnd, 'waiting')
    assert.equal(t.totals.output, 150)
    assert.equal(t.contextTokens, 4 + 1441 + 2000)
    assert.equal(session.label, 'Fix the login bug')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('session title', () => {
  it('uses Claude Code ai-title entries as the label', () => {
    const { session, labels, feed } = setup()
    feed({ type: 'ai-title', aiTitle: 'CLAUDE.md và agents cho agent-flow', sessionId: SESSION_ID })
    assert.equal(session.label, 'CLAUDE.md và agents cho agent-flow')
    assert.deepEqual(labels, ['CLAUDE.md và agents cho agent-flow'])
  })
})
