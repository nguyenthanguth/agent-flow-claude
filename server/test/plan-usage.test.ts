/**
 * Plan usage bar data: limits parsed from the usage endpoint's response, and
 * local usage read from transcripts (fast path, no full JSON parse).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parsePlanUsage } from '../src/plan-usage'
import { readUsageLine, LocalUsageIndex } from '../src/local-usage'

describe('parsePlanUsage', () => {
  it('reads the generic limits list (shape from a real team-plan response)', () => {
    const limits = parsePlanUsage({
      five_hour: { utilization: 95, resets_at: '2026-10-28T17:20:00.076380+00:00' },
      seven_day: null,
      limits: [
        { kind: 'session', group: 'session', percent: 95, severity: 'critical', resets_at: '2026-10-28T17:19:59.876542+00:00', scope: null, is_active: true },
        { kind: 'weekly_scoped', group: 'weekly', percent: 0, severity: 'normal', resets_at: '2026-10-30T23:00:00+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false },
      ],
    })
    assert.deepEqual(limits.map(l => [l.group, l.label, l.percent, l.active]), [
      ['session', '5-hour session', 95, true],
      ['weekly', 'Week · Fable', 0, false],
    ])
    assert.equal(limits[0].resetsAt, Date.parse('2026-10-28T17:19:59.876542+00:00'))
  })

  it('falls back to five_hour / seven_day', () => {
    const limits = parsePlanUsage({ five_hour: { utilization: 40, resets_at: '2026-10-28T17:00:00Z' }, seven_day: { utilization: 12, resets_at: null } })
    assert.deepEqual(limits.map(l => [l.group, l.percent]), [['session', 40], ['weekly', 12]])
  })

  it('tolerates junk', () => {
    assert.deepEqual(parsePlanUsage(null), [])
    assert.deepEqual(parsePlanUsage({ limits: [{ kind: 'x' }] }), [])
  })
})

const line = (id: string, ts: string, read: number, out: number) => JSON.stringify({
  parentUuid: null, isSidechain: false, type: 'assistant', uuid: `u-${id}-${out}`,
  message: {
    model: 'claude-opus-5-5', id, type: 'message', role: 'assistant',
    content: [{ type: 'text', text: 'he said "usage":{"input_tokens":999} in a string' }],
    usage: {
      input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: read, output_tokens: out,
      cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 0 },
      iterations: [{ input_tokens: 2, output_tokens: out }],
    },
  },
  timestamp: ts,
})

describe('local usage', () => {
  it('pulls usage out of an assistant line, ignoring look-alikes inside content', () => {
    const r = readUsageLine(line('msg_1', '2026-10-28T14:44:17.968Z', 5000, 30))
    assert.equal(r?.id, 'msg_1')
    assert.deepEqual(r?.record, {
      time: Date.parse('2026-10-28T14:44:17.968Z'), model: 'claude-opus-5-5',
      input: 2, output: 30, cacheRead: 5000, cacheWrite1h: 100, cacheWrite5m: 0,
    })
    assert.equal(readUsageLine('{"type":"user","message":{}}'), null)
  })

  it('sums usage per model since a time, counting each response once', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-local-usage-'))
    const dir = path.join(root, 'C--proj', 'sess', 'subagents')
    fs.mkdirSync(dir, { recursive: true })
    const now = Date.now()
    const iso = (msAgo: number) => new Date(now - msAgo).toISOString()
    fs.writeFileSync(path.join(root, 'C--proj', 'sess.jsonl'), [
      line('msg_old', iso(6 * 3_600_000), 1000, 10),   // outside the 5-hour window
      line('msg_a', iso(60_000), 1000, 10),
      line('msg_a', iso(59_000), 1000, 25),            // same response, later entry
    ].join('\n') + '\n')
    fs.writeFileSync(path.join(dir, 'agent-x.jsonl'), line('msg_sub', iso(30_000), 50, 5) + '\n')

    const index = new LocalUsageIndex(root)
    await index.refresh()
    const recent = index.totalsSince(now - 5 * 3_600_000)['claude-opus-5-5']
    assert.equal(recent.output, 25 + 5)
    assert.equal(recent.cacheRead, 1000 + 50)
    assert.equal(index.totalsSince(now - 7 * 86_400_000)['claude-opus-5-5'].output, 10 + 25 + 5)

    // Only appended lines are read on the next refresh
    fs.appendFileSync(path.join(dir, 'agent-x.jsonl'), line('msg_sub2', iso(1000), 0, 7) + '\n')
    await index.refresh()
    assert.equal(index.totalsSince(now - 5 * 3_600_000)['claude-opus-5-5'].output, 25 + 5 + 7)
    fs.rmSync(root, { recursive: true, force: true })
  })
})
