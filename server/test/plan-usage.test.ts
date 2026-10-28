/**
 * Plan usage bar data: limits parsed from the usage endpoint's response, and
 * local usage read from transcripts (fast path, no full JSON parse).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parsePlanUsage, PlanUsage } from '../src/plan-usage'
import { readUsageLine, LocalUsageIndex } from '../src/local-usage'
import { UsageMonitor } from '../src/usage-monitor'
import type { PlanUsageReport } from '../src/core/protocol'

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

  it('names limits by every scope part and keeps ids unique', () => {
    const limits = parsePlanUsage({ limits: [
      { kind: 'weekly_scoped', group: 'weekly', percent: 10, scope: { model: null, surface: 'cli' } },
      { kind: 'weekly_scoped', group: 'weekly', percent: 20, scope: { model: null, surface: { display_name: 'Cowork' } } },
      { kind: 'weekly_scoped', group: 'weekly', percent: 30, scope: { other: 1 } },
      { kind: 'weekly_scoped', group: 'weekly', percent: 40, scope: { other: 2 } },
    ] })
    assert.deepEqual(limits.map(l => l.label), ['Week · cli', 'Week · Cowork', 'Week', 'Week'])
    assert.equal(new Set(limits.map(l => l.id)).size, 4)
  })
})

describe('UsageMonitor', () => {
  const HOUR = 3_600_000
  function monitor(fetcher: () => Promise<PlanUsage>, cached?: unknown) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-monitor-'))
    const cachePath = path.join(dir, 'plan-usage.json')
    if (cached) fs.writeFileSync(cachePath, JSON.stringify(cached))
    const reports: PlanUsageReport[] = []
    const m = new UsageMonitor({ fetchPlan: true, fetcher, cachePath, index: new LocalUsageIndex(dir), onUpdate: r => reports.push(r) })
    return { m, reports, dir }
  }
  const session = (percent: number, resetsAt: number, active = true) =>
    ({ id: `s${percent}`, group: 'session', label: '5-hour session', percent, severity: 'normal', resetsAt, active })

  it('publishes cached limits before the fetch settles', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const now = Date.now()
    const { m, reports, dir } = monitor(async () => { await gate; return { status: 'ok', limits: [], fetchedAt: Date.now() } },
      { status: 'ok', limits: [session(40, now + HOUR)], fetchedAt: now - 60_000 })
    const done = m.tick()
    await new Promise(r => setImmediate(r))
    assert.equal(reports[0]?.limits[0]?.percent, 40)
    release(); await done; m.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('keeps the last limits through a transient error, but not past 6 hours', async () => {
    const now = Date.now()
    const { m, reports, dir } = monitor(async () => ({ status: 'unavailable', limits: [], fetchedAt: Date.now(), error: 'HTTP 429' }),
      { status: 'ok', limits: [session(40, now + HOUR)], fetchedAt: now - 60_000 })
    await m.tick(); m.dispose()
    const last = reports[reports.length - 1]
    assert.equal(last.limits[0].percent, 40)
    assert.equal(last.error, 'HTTP 429')

    const old = monitor(async () => ({ status: 'unavailable', limits: [], fetchedAt: Date.now(), error: 'HTTP 429' }))
    // Simulate limits fetched 7 hours ago that later refreshes failed to replace
    ;(old.m as unknown as { plan: PlanUsage }).plan = { status: 'ok', limits: [session(40, now + HOUR)], fetchedAt: now - 7 * HOUR }
    await old.m.tick(); old.m.dispose()
    assert.deepEqual(old.reports[old.reports.length - 1].limits, [])
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(old.dir, { recursive: true, force: true })
  })

  it('aligns local windows only with limits that are in effect', async () => {
    const now = Date.now()
    const weekly = { id: 'w', group: 'weekly', label: 'Week · Fable', percent: 0, severity: 'normal', resetsAt: now + 48 * HOUR, active: false }
    const { m, reports, dir } = monitor(async () => ({ status: 'ok', limits: [session(5, now + 2 * HOUR), weekly], fetchedAt: Date.now() }))
    await m.tick(); m.dispose()
    const w = reports[reports.length - 1].windows
    assert.equal(w.find(x => x.group === 'session')?.since, now + 2 * HOUR - 5 * HOUR)
    // Inactive weekly limit → rolling 7 days, matching the "Last 7 days" label
    assert.ok(Math.abs(w.find(x => x.group === 'weekly')!.since - (now - 7 * 24 * HOUR)) < 5000)
    fs.rmSync(dir, { recursive: true, force: true })
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

  it('takes message.usage and the entry timestamp, not look-alike keys in a tool input', () => {
    const entry = {
      parentUuid: null, type: 'assistant', uuid: 'u1',
      message: {
        model: 'claude-opus-5-5', id: 'msg_t', type: 'message', role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'mcp__log', input: {
          timestamp: '2020-01-01T00:00:00Z', usage: { input_tokens: 999999, output_tokens: 999999 },
        } }],
        usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 10, output_tokens: 7 },
      },
      timestamp: '2026-10-28T14:00:00.000Z',
    }
    const r = readUsageLine(JSON.stringify(entry))
    assert.equal(r?.record.time, Date.parse('2026-10-28T14:00:00.000Z'))
    assert.equal(r?.record.input, 3)
    assert.equal(r?.record.output, 7)
  })

  it('reads an assistant line longer than one read chunk', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-local-usage-'))
    fs.mkdirSync(path.join(root, 'p'))
    const now = Date.now()
    const big = JSON.parse(line('msg_big', new Date(now - 1000).toISOString(), 10, 42))
    big.message.content = [{ type: 'text', text: 'x'.repeat(9 * 1024 * 1024) }] // > 2 chunks of 4 MB
    fs.writeFileSync(path.join(root, 'p', 's.jsonl'), JSON.stringify(big) + '\n' + line('msg_small', new Date(now - 500).toISOString(), 1, 1) + '\n')
    const index = new LocalUsageIndex(root)
    await index.refresh()
    assert.equal(index.totalsSince(now - 60_000)['claude-opus-5-5'].output, 43)
    fs.rmSync(root, { recursive: true, force: true })
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
