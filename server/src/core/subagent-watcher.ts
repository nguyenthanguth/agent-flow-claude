/**
 * Subagent file watching.
 *
 * Claude Code writes each subagent's transcript to
 * `<project>/<session>/subagents/agent-<id>.jsonl`, next to an
 * `agent-<id>.meta.json` sidecar ({ description, toolUseId, finished, ... }).
 * This module discovers those files, tails them, and emits their events.
 *
 * The meta file is also the most reliable completion signal for background
 * subagents: `finished: true` completes the subagent even when its
 * `<task-notification>` is missed or delivered in a shape we don't parse.
 *
 * When inline progress events are active for a subagent (tracked via
 * session.inlineProgressAgents), the file watcher still tracks file position
 * but skips event emission to avoid duplicates. This allows seamless fallback
 * to file-based watching on reconnection when inline progress is no longer flowing.
 */

import * as fs from 'fs'
import * as path from 'path'
import { AgentEvent, SubagentState, TranscriptEntry, WatchedSession, emitSubagentSpawn } from './protocol'
import { SESSION_ID_DISPLAY, ORCHESTRATOR_NAME, ARGS_MAX, generateSubagentFallbackName, resolveSubagentChildName } from './constants'
import { readNewFileLines, readFileChunk, completeLinesSize, forEachLine } from './fs-utils'
import { TranscriptParser, isInterruption } from './transcript-parser'
import { createLogger } from './logger'

const log = createLogger('SubagentWatcher')

/** A subagent file written within this window at discovery time counts as running */
const SUBAGENT_RECENT_WRITE_MS = 2 * 60 * 1000

/** How long a new subagent transcript waits for its .meta.json before falling back */
const META_WAIT_MS = 5000

/** Bytes read from the end of a finished subagent transcript to find its final answer */
const SUMMARY_TAIL_BYTES = 64 * 1024

export interface SubagentWatcherDelegate {
  emit(event: AgentEvent, sessionId?: string): void
  elapsed(sessionId?: string): number
  getSession(sessionId: string): WatchedSession | undefined
  resetInactivityTimer(sessionId: string): void
}

interface SubagentMeta {
  name: string | null
  toolUseId?: string
  /** undefined when the meta file is missing (older Claude Code versions) */
  finished?: boolean
}

function metaPathFor(jsonlPath: string): string {
  return jsonlPath.replace(/\.jsonl$/, '.meta.json')
}

/** When each not-yet-watched subagent file was first seen. Tracked in memory
 *  because file birth times are unreliable (0 on some Linux filesystems). */
const firstSeenAt = new Map<string, number>()

function msSinceFirstSeen(filePath: string): number {
  let seen = firstSeenAt.get(filePath)
  if (seen === undefined) {
    seen = Date.now()
    firstSeenAt.set(filePath, seen)
  }
  return Date.now() - seen
}

/** Read the .meta.json sidecar next to a subagent transcript. */
export function readSubagentMeta(jsonlPath: string): SubagentMeta | null {
  try {
    const meta = JSON.parse(fs.readFileSync(metaPathFor(jsonlPath), 'utf-8')) as Record<string, unknown>
    const name = resolveSubagentChildName(meta)
    return {
      name: name && name !== 'subagent' ? name : null,
      toolUseId: typeof meta.toolUseId === 'string' ? meta.toolUseId : undefined,
      finished: meta.finished === true,
    }
  } catch {
    return null // meta file may not exist (yet, or for older Claude Code versions)
  }
}

/** Scan the subagents directory for new JSONL files and start tailing them */
export function scanSubagentsDir(
  delegate: SubagentWatcherDelegate,
  parser: TranscriptParser,
  sessionId: string,
): void {
  const session = delegate.getSession(sessionId)
  if (!session || !session.subagentsDir) return

  // Start watching the directory itself once it exists
  if (!session.subagentsDirWatcher && fs.existsSync(session.subagentsDir)) {
    try {
      session.subagentsDirWatcher = fs.watch(session.subagentsDir, () => {
        scanSubagentsDir(delegate, parser, sessionId)
      })
    } catch (err) { log.debug('Subagent dir watch failed:', err) }
  }

  // Files present at the first scan are history we attached to mid-session;
  // anything that shows up later was created while we were watching.
  const live = session.subagentsScanned
  session.subagentsScanned = true

  const subDir = session.subagentsDir
  if (!fs.existsSync(subDir)) return

  try {
    for (const file of fs.readdirSync(subDir)) {
      if (!file.endsWith('.jsonl')) continue
      const filePath = path.join(subDir, file)
      if (session.subagentWatchers.has(filePath)) continue
      // The transcript can appear a moment before its meta file. Starting
      // without it would name the node "subagent-N" instead of its
      // description, so wait for it — the poll rescans every second.
      if (!fs.existsSync(metaPathFor(filePath)) && msSinceFirstSeen(filePath) < META_WAIT_MS) continue
      firstSeenAt.delete(filePath)
      if (live) startLiveSubagentFile(delegate, parser, filePath, sessionId)
      else startWatchingSubagentFile(delegate, parser, filePath, sessionId)
    }
  } catch (err) { log.debug('Subagent dir scan failed:', err) }
}

function newSubagentState(filePath: string, session: WatchedSession, meta: SubagentMeta | null): SubagentState {
  return {
    watcher: null,
    fileSize: 0,
    agentName: meta?.name ?? generateSubagentFallbackName('', session.subagentWatchers.size + 1),
    pendingToolCalls: new Map(),
    seenToolUseIds: new Set(),
    spawnEmitted: false,
    toolUseId: meta?.toolUseId,
    finished: false,
  }
}

function watchFile(delegate: SubagentWatcherDelegate, parser: TranscriptParser, filePath: string, sessionId: string, state: SubagentState): void {
  try {
    state.watcher = fs.watch(filePath, () => {
      readSubagentNewLines(delegate, parser, filePath, sessionId)
    })
  } catch (err) { log.debug('Subagent file watch failed:', err) }
}

/** A subagent created while we were watching: replay its file from the start,
 *  so tool calls it made before we noticed the file are not lost. */
function startLiveSubagentFile(
  delegate: SubagentWatcherDelegate,
  parser: TranscriptParser,
  filePath: string,
  sessionId: string,
): void {
  const session = delegate.getSession(sessionId)
  if (!session) return
  const state = newSubagentState(filePath, session, readSubagentMeta(filePath))
  session.subagentWatchers.set(filePath, state)
  log.info(`Tailing new subagent: ${path.basename(filePath)} as "${state.agentName}" (session ${sessionId.slice(0, SESSION_ID_DISPLAY)})`)
  readSubagentNewLines(delegate, parser, filePath, sessionId)
  watchFile(delegate, parser, filePath, sessionId, state)
}

/** A subagent file that already existed when we attached to the session */
function startWatchingSubagentFile(
  delegate: SubagentWatcherDelegate,
  parser: TranscriptParser,
  filePath: string,
  sessionId: string,
): void {
  const session = delegate.getSession(sessionId)
  if (!session) return

  const meta = readSubagentMeta(filePath)
  const state = newSubagentState(filePath, session, meta)
  state.finished = meta?.finished === true
  const agentName = state.agentName
  session.subagentWatchers.set(filePath, state)

  // Pre-scan existing content for dedup IDs and determine if the subagent
  // is still active (has unmatched tool_use blocks = pending work).
  const pendingToolUseIds = new Set<string>()
  let recentlyWritten = false
  // A killed subagent (Esc, TaskStop) ends with an interruption entry and keeps
  // its unanswered tool_use, and its meta file never gets `finished`
  let interrupted = false
  if (state.finished) {
    // Already done when we found it — history only, nothing to show or tail,
    // so don't read it (old subagent transcripts can be hundreds of MB).
    state.spawnEmitted = true
    return
  }

  try {
    const stat = fs.statSync(filePath)
    recentlyWritten = Date.now() - stat.mtimeMs < SUBAGENT_RECENT_WRITE_MS
    // Only complete lines: a line still being written is read by the tail later
    const size = completeLinesSize(filePath, stat.size)
    if (size > 0) {
      // Streamed: large transcripts don't fit in a single string
      forEachLine(filePath, size, (line) => {
        if (!line.trim()) return
        try {
          const raw: unknown = JSON.parse(line.trim())
          const entry = raw as { message?: { role?: string; content?: Array<{ type: string; id?: string; tool_use_id?: string }> } }
          if (raw && typeof raw === 'object' && entry.message && Array.isArray(entry.message.content)) {
            if (entry.message.role === 'user' && isInterruption(entry.message.content as TranscriptEntry['message']['content'])) interrupted = true
            else if (entry.message.role === 'assistant') interrupted = false
            for (const block of entry.message.content) {
              if (block.type === 'tool_use' && block.id) {
                state.seenToolUseIds.add(block.id)
                pendingToolUseIds.add(block.id)
              } else if (block.type === 'tool_result' && block.tool_use_id) {
                pendingToolUseIds.delete(block.tool_use_id)
              }
            }
          }
        } catch { /* skip unparseable subagent transcript lines */ }
      })
      state.fileSize = size
    }
  } catch (err) { log.debug('Subagent initial read failed:', err) }

  log.info(`Tailing subagent: ${path.basename(filePath)} as "${agentName}" (session ${sessionId.slice(0, SESSION_ID_DISPLAY)})`)

  // Spawn now if the subagent looks like it is still running: work in flight,
  // or written to recently (older meta files may lack `finished`, so "not
  // finished" alone would resurrect every historical subagent). Anything else,
  // including an interrupted subagent later resumed with SendMessage, spawns
  // lazily on its next write.
  if (!interrupted && (pendingToolUseIds.size > 0 || (recentlyWritten && state.fileSize > 0))) {
    spawnOnce(delegate, session, state, sessionId)
  }

  watchFile(delegate, parser, filePath, sessionId, state)
}

function spawnOnce(
  delegate: SubagentWatcherDelegate,
  session: WatchedSession,
  state: SubagentState,
  sessionId: string,
): void {
  if (state.spawnEmitted) return
  state.spawnEmitted = true
  if (session.spawnedSubagents.has(state.agentName)) return
  session.spawnedSubagents.add(state.agentName)
  emitSubagentSpawn(delegate, ORCHESTRATOR_NAME, state.agentName, state.agentName, sessionId)
}

export function readSubagentNewLines(
  delegate: SubagentWatcherDelegate,
  parser: TranscriptParser,
  filePath: string,
  sessionId: string,
): void {
  const session = delegate.getSession(sessionId)
  if (!session) return
  const state = session.subagentWatchers.get(filePath)
  if (!state || state.finished) return

  const result = readNewFileLines(filePath, state.fileSize)
  if (!result) return
  state.fileSize = result.newSize

  // If inline progress events are handling this subagent, skip event emission
  // from the file watcher to avoid duplicates. We still advance fileSize above
  // so that if inline progress stops (e.g. reconnection), we resume from the
  // correct position without re-emitting old events.
  if (session.inlineProgressAgents.has(state.agentName)) {
    // Still keep the session alive — the subagent is working
    delegate.resetInactivityTimer(sessionId)
    return
  }

  spawnOnce(delegate, session, state, sessionId)

  for (const line of result.lines) {
    parser.processTranscriptLine(line, state.agentName, state.pendingToolCalls, state.seenToolUseIds, sessionId)
  }

  // Keep main session alive while subagents are working
  delegate.resetInactivityTimer(sessionId)
}

/** The subagent's final answer (last assistant text block), used as its return
 *  summary. Only the tail of the transcript is read. */
function lastAssistantText(filePath: string): string {
  try {
    const size = fs.statSync(filePath).size
    const start = Math.max(0, size - SUMMARY_TAIL_BYTES)
    const lines = readFileChunk(filePath, start, size - start).split(/\r?\n/).reverse()
    for (const line of lines) {
      if (!line.includes('"assistant"')) continue
      try {
        const entry = JSON.parse(line) as { type?: string; message?: { content?: unknown } }
        if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue
        const text = (entry.message.content as Array<{ type?: string; text?: string }>)
          .filter(b => b.type === 'text' && b.text).map(b => b.text!.trim()).join('\n')
        if (text) return text.slice(0, ARGS_MAX)
      } catch { /* partial first line of the tail, or unparseable */ }
    }
  } catch { /* file gone */ }
  return ''
}

/** Poll tick for one subagent: read new lines, then check whether its meta
 *  file says it finished. Called on the session's fallback poll interval. */
export function pollSubagent(
  delegate: SubagentWatcherDelegate,
  parser: TranscriptParser,
  filePath: string,
  sessionId: string,
): void {
  const session = delegate.getSession(sessionId)
  const state = session?.subagentWatchers.get(filePath)
  if (!session || !state || state.finished) return

  readSubagentNewLines(delegate, parser, filePath, sessionId)

  const meta = readSubagentMeta(filePath)
  if (!meta?.finished) return
  state.finished = true
  state.watcher?.close()
  state.watcher = null
  const toolUseId = meta.toolUseId ?? state.toolUseId
  // Background launches complete here; foreground ones already completed
  // through their tool_result, so finishBackgroundSubagent is a no-op for them.
  if (toolUseId) parser.finishBackgroundSubagent(toolUseId, 'completed', lastAssistantText(filePath), sessionId)
  log.info(`Subagent finished: "${state.agentName}" (session ${sessionId.slice(0, SESSION_ID_DISPLAY)})`)
}
