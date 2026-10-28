/**
 * Token usage across every Claude Code project on this machine, for the plan
 * usage bar: what was spent in the current 5-hour session window and week.
 *
 * Reads assistant entries' `usage` from all transcripts (main sessions and
 * subagents) touched in the last week. That is gigabytes, so:
 * - files are read in chunks with a yield between them (the server stays responsive)
 * - only lines of assistant entries are looked at, and their few numbers are
 *   pulled out with targeted regexes instead of parsing whole (often huge) lines
 * - after the first scan only appended bytes are read
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')
/** Keep a little more than the weekly window */
const RETENTION_MS = 8 * 24 * 60 * 60 * 1000
const CHUNK_BYTES = 4 * 1024 * 1024

export interface UsageCounts {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

interface UsageRecord extends UsageCounts {
  time: number
  model: string
}

const ASSISTANT_MARK = '"type":"assistant"'
const ASSISTANT_MARK_BYTES = Buffer.from(ASSISTANT_MARK)
const USAGE_MARK = '"usage":{'
const field = (s: string, name: string): number => {
  const m = s.match(new RegExp(`"${name}":(\\d+)`))
  return m ? Number(m[1]) : 0
}

/** Pull timestamp, model, message id and usage out of one transcript line */
export function readUsageLine(line: string): { id?: string; record: UsageRecord } | null {
  if (!line.includes(ASSISTANT_MARK)) return null
  const u = line.indexOf(USAGE_MARK)
  if (u === -1) return null
  const ts = line.match(/"timestamp":"([^"]+)"/)
  const time = ts ? Date.parse(ts[1]) : NaN
  if (!Number.isFinite(time)) return null
  // The usage object comes first; a later `iterations` array repeats its keys
  const usage = line.slice(u, u + 700)
  const write1h = field(usage, 'ephemeral_1h_input_tokens')
  const writeTotal = field(usage, 'cache_creation_input_tokens')
  const model = line.match(/"model":"([^"]+)"/)?.[1] ?? ''
  if (model.startsWith('<')) return null // <synthetic> placeholder entries
  return {
    id: line.match(/"id":"(msg_[^"]+)"/)?.[1],
    record: {
      time,
      model,
      input: field(usage, 'input_tokens'),
      output: field(usage, 'output_tokens'),
      cacheRead: field(usage, 'cache_read_input_tokens'),
      cacheWrite1h: write1h,
      cacheWrite5m: Math.max(0, writeTotal - write1h),
    },
  }
}

const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve))

async function readCompleteLines(file: string, from: number, onLine: (line: string) => void): Promise<number> {
  const handle = await fs.promises.open(file, 'r')
  try {
    const { size } = await handle.stat()
    if (size < from) from = 0 // truncated or replaced
    const buffer = Buffer.alloc(CHUNK_BYTES)
    let carry: Buffer = Buffer.alloc(0)
    let offset = from
    let consumed = from
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK_BYTES, size - offset), offset)
      if (bytesRead <= 0) break
      offset += bytesRead
      const data = carry.length ? Buffer.concat([carry, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead)
      // Only assistant entries carry usage. Search the raw bytes for the
      // marker and decode just those lines — most bytes are tool output.
      let start = 0
      let mark = data.indexOf(ASSISTANT_MARK_BYTES)
      let nl = data.indexOf(0x0a)
      while (nl !== -1) {
        if (mark !== -1 && mark < start) mark = data.indexOf(ASSISTANT_MARK_BYTES, start)
        if (mark !== -1 && mark < nl) onLine(data.toString('utf-8', start, nl))
        start = nl + 1
        nl = data.indexOf(0x0a, start)
      }
      consumed += start
      carry = Buffer.from(data.subarray(start))
      await yieldToEventLoop()
    }
    // A trailing partial line is left for the next refresh
    return consumed
  } finally {
    await handle.close()
  }
}

async function listTranscripts(dir: string, since: number, out: string[] = []): Promise<string[]> {
  let entries: fs.Dirent[]
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await listTranscripts(p, since, out)
    else if (e.name.endsWith('.jsonl')) {
      try { if ((await fs.promises.stat(p)).mtimeMs >= since) out.push(p) } catch {}
    }
  }
  return out
}

export class LocalUsageIndex {
  private offsets = new Map<string, number>()
  /** Usage by API message id (one response spans several entries) */
  private byMessage = new Map<string, UsageRecord>()
  private refreshing: Promise<void> | null = null
  ready = false

  constructor(private root = PROJECTS_DIR) {}

  /** Read new transcript content. Concurrent calls share one pass. */
  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => { this.refreshing = null })
    return this.refreshing
  }

  private async doRefresh(): Promise<void> {
    const cutoff = Date.now() - RETENTION_MS
    for (const file of await listTranscripts(this.root, cutoff)) {
      try {
        const next = await readCompleteLines(file, this.offsets.get(file) ?? 0, (line) => this.add(line, cutoff))
        this.offsets.set(file, next)
      } catch { /* file vanished mid-read */ }
    }
    for (const [id, r] of this.byMessage) if (r.time < cutoff) this.byMessage.delete(id)
    this.ready = true
  }

  private add(line: string, cutoff: number): void {
    const parsed = readUsageLine(line)
    if (!parsed || parsed.record.time < cutoff) return
    const { id, record } = parsed
    // Real assistant entries always have a msg_ id; skip anything else rather than risk double counting
    if (!id) return
    const prev = this.byMessage.get(id)
    if (!prev) { this.byMessage.set(id, record); return }
    // Same response written again (one entry per content block): keep the largest numbers
    prev.input = Math.max(prev.input, record.input)
    prev.output = Math.max(prev.output, record.output)
    prev.cacheRead = Math.max(prev.cacheRead, record.cacheRead)
    prev.cacheWrite5m = Math.max(prev.cacheWrite5m, record.cacheWrite5m)
    prev.cacheWrite1h = Math.max(prev.cacheWrite1h, record.cacheWrite1h)
  }

  /** Usage per model since `since` (ms epoch) */
  totalsSince(since: number): Record<string, UsageCounts> {
    const out: Record<string, UsageCounts> = {}
    const addTo = (r: UsageRecord) => {
      if (r.time < since) return
      const t = (out[r.model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })
      t.input += r.input
      t.output += r.output
      t.cacheRead += r.cacheRead
      t.cacheWrite5m += r.cacheWrite5m
      t.cacheWrite1h += r.cacheWrite1h
    }
    for (const r of this.byMessage.values()) addTo(r)
    return out
  }
}
