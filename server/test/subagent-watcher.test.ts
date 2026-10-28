/**
 * Unit tests for subagent transcript discovery and completion.
 *
 * Invariants: a subagent that is running when Agent Flow attaches is shown;
 * finished history is not; and a background subagent completes as soon as
 * its .meta.json says `finished: true`, even if no <task-notification> is parsed.
 */

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TranscriptParser } from '../src/core/transcript-parser'
import { scanSubagentsDir, pollSubagent, SubagentWatcherDelegate } from '../src/core/subagent-watcher'
import { AgentEvent, WatchedSession } from '../src/core/protocol'

const SESSION_ID = 'session-1'
const dirs: string[] = []
const sessions: WatchedSession[] = []

afterEach(() => {
  for (const s of sessions.splice(0)) {
    s.subagentsDirWatcher?.close()
    for (const sub of s.subagentWatchers.values()) sub.watcher?.close()
  }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-subagents-'))
  dirs.push(root)
  const subagentsDir = path.join(root, SESSION_ID, 'subagents')
  fs.mkdirSync(subagentsDir, { recursive: true })

  const session: WatchedSession = {
    sessionId: SESSION_ID, filePath: path.join(root, `${SESSION_ID}.jsonl`),
    fileWatcher: null, pollTimer: null, fileSize: 0, sessionStartTime: Date.now(),
    pendingToolCalls: new Map(), seenToolUseIds: new Set(), seenMessageHashes: new Set(),
    sessionDetected: true, sessionCompleted: false, lastActivityTime: Date.now(), inactivityTimer: null,
    subagentWatchers: new Map(), spawnedSubagents: new Set(), inlineProgressAgents: new Set(),
    subagentsDirWatcher: null, subagentsDir, subagentsScanned: false,
    label: 'Session', labelSet: true, model: null, modelDetectedAgents: new Map(),
    contextBreakdown: { systemPrompt: 0, userMessages: 0, toolResults: 0, reasoning: 0, subagentResults: 0 },
  }
  sessions.push(session)

  const events: AgentEvent[] = []
  const delegate: SubagentWatcherDelegate = {
    emit: (event) => { events.push(event) },
    elapsed: () => 0,
    getSession: (id) => (id === SESSION_ID ? session : undefined),
    resetInactivityTimer: () => {},
  }
  const parser = new TranscriptParser({ ...delegate, fireSessionLifecycle: () => {}, emitContextUpdate: () => {} })

  const writeSubagent = (id: string, meta: Record<string, unknown>, lines: unknown[]) => {
    const file = path.join(subagentsDir, `agent-${id}.jsonl`)
    fs.writeFileSync(path.join(subagentsDir, `agent-${id}.meta.json`), JSON.stringify(meta))
    fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
    return file
  }
  return { session, events, delegate, parser, writeSubagent }
}

const pendingBash = (id: string) => ({
  type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'sleep 8' } }] },
})
const spawns = (events: AgentEvent[]) => events.filter(e => e.type === 'agent_spawn').map(e => e.payload.name)

describe('subagent watcher', () => {
  it('spawns a subagent that is running when we attach, named from its meta file', () => {
    const { events, delegate, parser, writeSubagent } = setup()
    writeSubagent('a1', { description: 'Review the diff', toolUseId: 'toolu_1' }, [pendingBash('t1')])
    scanSubagentsDir(delegate, parser, SESSION_ID)
    assert.deepEqual(spawns(events), ['Review the diff'])
  })

  it('does not spawn finished subagents from history', () => {
    const { events, delegate, parser, writeSubagent } = setup()
    writeSubagent('a1', { description: 'Old work', toolUseId: 'toolu_1', finished: true }, [pendingBash('t1')])
    scanSubagentsDir(delegate, parser, SESSION_ID)
    assert.deepEqual(spawns(events), [])
  })

  it('does not spawn twice when the parent transcript already spawned it', () => {
    const { session, events, delegate, parser, writeSubagent } = setup()
    session.spawnedSubagents.add('Review the diff')
    writeSubagent('a1', { description: 'Review the diff', toolUseId: 'toolu_1' }, [pendingBash('t1')])
    scanSubagentsDir(delegate, parser, SESSION_ID)
    assert.deepEqual(spawns(events), [])
  })

  it('completes a background subagent when its meta file reports finished', () => {
    const { session, events, delegate, parser, writeSubagent } = setup()
    // Parent transcript: background launch of toolu_1
    const feed = (entry: unknown) => parser.processTranscriptLine(
      JSON.stringify(entry), 'orchestrator', session.pendingToolCalls, session.seenToolUseIds, SESSION_ID, session.seenMessageHashes)
    feed({ type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { description: 'Review the diff' } },
    ] } })
    feed({
      type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'launched' }] },
      toolUseResult: { isAsync: true, status: 'async_launched' },
    })

    const file = writeSubagent('a1', { description: 'Review the diff', toolUseId: 'toolu_1' }, [pendingBash('t1')])
    scanSubagentsDir(delegate, parser, SESSION_ID)
    pollSubagent(delegate, parser, file, SESSION_ID)
    assert.equal(events.filter(e => e.type === 'agent_complete').length, 0)

    fs.writeFileSync(file.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ description: 'Review the diff', toolUseId: 'toolu_1', finished: true }))
    pollSubagent(delegate, parser, file, SESSION_ID)
    pollSubagent(delegate, parser, file, SESSION_ID)
    assert.deepEqual(events.filter(e => e.type === 'agent_complete').map(e => e.payload), [{ name: 'Review the diff' }])
  })

  it('replays a subagent created while watching from its first line', () => {
    const { events, delegate, parser, writeSubagent } = setup()
    scanSubagentsDir(delegate, parser, SESSION_ID) // attach: nothing there yet
    writeSubagent('a1', { description: 'Review the diff', toolUseId: 'toolu_1' }, [pendingBash('t1')])
    scanSubagentsDir(delegate, parser, SESSION_ID)

    assert.deepEqual(spawns(events), ['Review the diff'])
    const starts = events.filter(e => e.type === 'tool_call_start')
    assert.deepEqual(starts.map(e => [e.payload.agent, e.payload.tool]), [['Review the diff', 'Bash']])
  })

  it('waits for the meta file before naming a brand-new subagent', () => {
    const { session, events, delegate, parser } = setup()
    const file = path.join(session.subagentsDir!, 'agent-a1.jsonl')
    fs.writeFileSync(file, JSON.stringify(pendingBash('t1')) + '\n')
    scanSubagentsDir(delegate, parser, SESSION_ID)
    assert.equal(session.subagentWatchers.size, 0)

    fs.writeFileSync(file.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ description: 'Review the diff' }))
    scanSubagentsDir(delegate, parser, SESSION_ID)
    assert.deepEqual(spawns(events), ['Review the diff'])
  })
})
