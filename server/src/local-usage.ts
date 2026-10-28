/**
 * Token usage across every Claude Code project on this machine, for the plan
 * usage bar: what was spent in the current 5-hour session window and week.
 *
 * Reads assistant entries' `usage` from all transcripts (main sessions and
 * subagents) touched in the last week. That is gigabytes, so:
 * - files are read in chunks with a yield between them (the server stays responsive)
 * - only lines of assistant entries are looked at, and their few numbers are
 *   pulled out with targeted regexes instead of parsing whole (often huge) lines
 * - after the first scan only appended bytes are read, and unchanged files are skipped
 */
import * as fs from 'fs'
import * as path from 'path'
import { CLAUDE_PROJECTS_DIR } from './core/constants'
import type { UsageCounts } from './core/usage'

/** Keep a little more than the weekly window */
const RETENTION_MS = 8 * 24 * 60 * 60 * 1000
const CHUNK_BYTES = 4 * 1024 * 1024

interface UsageRecord extends UsageCounts {
  time: number
  model: string
}

const ASSISTANT_MARK = '"type":"assistant"'
const ASSISTANT_MARK_BYTES = Buffer.from(ASSISTANT_MARK)
/** message.usage always starts with input_tokens */
const USAGE_MARK = '"usage":{"input_tokens":'
const TIMESTAMP_MARK = '"timestamp":"'

const FIELD_RE = {
  input: /"input_tokens":(\d+)/,
  output: /"output_tokens":(\d+)/,
  cacheRead: /"cache_read_input_tokens":(\d+)/,
  cacheCreation: /"cache_creation_input_tokens":(\d+)/,
  cacheWrite1h: /"ephemeral_1h_input_tokens":(\d+)/,
}
const MODEL_RE = /"model":"([^"]+)"/
const MESSAGE_ID_RE = /"id":"(msg_[^"]+)"/

const field = (s: string, re: RegExp): number => {
  const m = s.match(re)
  return m ? Number(m[1]) : 0
}

/**
 * Pull timestamp, model, message id and usage out of one transcript line.
 *
 * Positions matter: an assistant line is `{…,"message":{"model",…,"id",…,
 * "content":[…],…,"usage":{…}},…,"timestamp":"…"}`. Tool inputs inside
 * `content` are plain JSON objects (not escaped strings), so they can contain
 * their own "timestamp" or "usage" keys. Model and id come before content
 * (first match), message.usage and the entry timestamp come after it (last match).
 */
export function readUsageLine(line: string): { id?: string; record: UsageRecord } | null {
  if (!line.includes(ASSISTANT_MARK)) return null
  const u = line.lastIndexOf(USAGE_MARK)
  const t = line.lastIndexOf(TIMESTAMP_MARK)
  if (u === -1 || t === -1) return null
  const tEnd = line.indexOf('"', t + TIMESTAMP_MARK.length)
  const time = Date.parse(line.slice(t + TIMESTAMP_MARK.length, tEnd))
  if (!Number.isFinite(time)) return null
  const model = line.match(MODEL_RE)?.[1] ?? ''
  if (model.startsWith('<')) return null // <synthetic> placeholder entries
  // The usage object's own keys come first; a later `iterations` array repeats them
  const usage = line.slice(u, u + 700)
  const write1h = field(usage, FIELD_RE.cacheWrite1h)
  return {
    id: line.match(MESSAGE_ID_RE)?.[1],
    record: {
      time,
      model,
      input: field(usage, FIELD_RE.input),
      output: field(usage, FIELD_RE.output),
      cacheRead: field(usage, FIELD_RE.cacheRead),
      cacheWrite1h: write1h,
      cacheWrite5m: Math.max(0, field(usage, FIELD_RE.cacheCreation) - write1h),
    },
  }
}

const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve))

/**
 * Call `onLine` for each complete assistant line in [from, size). Returns the
 * offset after the last complete line (a partial last line is read next time).
 * `buffer` is reused across files; bytes kept past one read are copied.
 * A line spanning many chunks is collected as a list and joined once, and
 * newlines are only searched in newly read bytes, so cost stays linear.
 */
async function readAssistantLines(
  file: string, from: number, size: number, buffer: Buffer, onLine: (line: string) => void,
): Promise<number> {
  const handle = await fs.promises.open(file, 'r')
  try {
    let pending: Buffer[] = []
    let offset = from
    let consumed = from
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - offset), offset)
      if (bytesRead <= 0) break
      offset += bytesRead
      const data = buffer.subarray(0, bytesRead)

      let start = 0
      let nl = data.indexOf(0x0a)
      // Finish a line carried over from earlier chunks
      if (pending.length && nl !== -1) {
        const line = Buffer.concat([...pending, data.subarray(0, nl)])
        if (line.indexOf(ASSISTANT_MARK_BYTES) !== -1) onLine(line.toString('utf-8'))
        consumed += line.length + 1
        pending = []
        start = nl + 1
        nl = data.indexOf(0x0a, start)
      }
      // Only assistant entries carry usage: find the marker in raw bytes and
      // decode just those lines — most bytes are tool output.
      let mark = data.indexOf(ASSISTANT_MARK_BYTES, start)
      while (nl !== -1) {
        if (mark !== -1 && mark < start) mark = data.indexOf(ASSISTANT_MARK_BYTES, start)
        if (mark !== -1 && mark < nl) onLine(data.toString('utf-8', start, nl))
        consumed += nl + 1 - start
        start = nl + 1
        nl = data.indexOf(0x0a, start)
      }
      if (start < data.length) pending.push(Buffer.from(data.subarray(start)))
      await yieldToEventLoop()
    }
    return consumed
  } finally {
    await handle.close()
  }
}

async function listTranscripts(dir: string, since: number, out: Array<{ file: string; size: number }> = []) {
  let entries: fs.Dirent[]
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await listTranscripts(p, since, out)
    else if (e.name.endsWith('.jsonl')) {
      try {
        const st = await fs.promises.stat(p)
        if (st.mtimeMs >= since) out.push({ file: p, size: st.size })
      } catch {}
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

  constructor(private root = CLAUDE_PROJECTS_DIR) {}

  /** Read new transcript content. Concurrent calls share one pass. */
  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => { this.refreshing = null })
    return this.refreshing
  }

  private async doRefresh(): Promise<void> {
    const cutoff = Date.now() - RETENTION_MS
    let buffer: Buffer | null = null
    for (const { file, size } of await listTranscripts(this.root, cutoff)) {
      let from = this.offsets.get(file) ?? 0
      if (size === from) continue // nothing appended
      if (size < from) from = 0   // truncated or replaced
      buffer ??= Buffer.allocUnsafe(CHUNK_BYTES)
      try {
        this.offsets.set(file, await readAssistantLines(file, from, size, buffer, (line) => this.add(line, cutoff)))
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
    for (const r of this.byMessage.values()) {
      if (r.time < since) continue
      const t = (out[r.model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })
      t.input += r.input
      t.output += r.output
      t.cacheRead += r.cacheRead
      t.cacheWrite5m += r.cacheWrite5m
      t.cacheWrite1h += r.cacheWrite1h
    }
    return out
  }
}
