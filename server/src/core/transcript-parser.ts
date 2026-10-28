/**
 * Transcript parsing for Claude Code session JSONL files.
 *
 * Parses JSONL transcript lines and emits AgentEvents via a delegate,
 * keeping the parsing logic decoupled from file-watching concerns.
 */

import {
  AgentEvent, PendingToolCall, WatchedSession,
  TranscriptEntry, ToolUseBlock, ToolResultBlock,
  emitSubagentSpawn,
} from './protocol'
import { forEachLine } from './fs-utils'
import {
  PREVIEW_MAX, ARGS_MAX, RESULT_MAX, MESSAGE_MAX,
  SESSION_LABEL_MAX, SESSION_LABEL_TRUNCATED,
  CHILD_NAME_MAX,
  HASH_PREFIX_MAX,
  ORCHESTRATOR_NAME,
  FAILED_RESULT_MAX,
  SYSTEM_CONTENT_PREFIXES,
  generateSubagentFallbackName,
  resolveSubagentChildName,
} from './constants'
import { summarizeInput, summarizeResult, extractInputData, detectError, buildDiscovery } from './tool-summarizer'
import { estimateTokensFromContent, estimateTokensFromText } from './token-estimator'
import { createLogger } from './logger'
import { trackingFor, parseUsage, recordUsage, AgentTracking } from './usage'

const log = createLogger('TranscriptParser')

export interface TranscriptParserDelegate {
  emit(event: AgentEvent, sessionId?: string): void
  elapsed(sessionId?: string): number
  getSession(sessionId: string): WatchedSession | undefined
  fireSessionLifecycle(event: { type: 'started' | 'ended' | 'updated'; sessionId: string; label: string }): void
  emitContextUpdate(agentName: string, session: WatchedSession, sessionId?: string): void
}

/** Type guard: check if a value is a non-null object */
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object'
}

/** Safely extract trimmed text from a text block */
function safeText(block: unknown): string {
  if (!isRecord(block)) return ''
  return String(block.text || '').trim()
}

/** Safely extract trimmed thinking content from a thinking block */
function safeThinking(block: unknown): string {
  if (!isRecord(block)) return ''
  return String(block.thinking || '').trim()
}

/** Returns the signature string if a thinking block is redacted
 *  (plaintext stripped but signature present, as Opus 4.7+ does), else null. */
function redactedThinkingSignature(block: unknown): string | null {
  if (!isRecord(block)) return null
  if (String(block.thinking || '').trim()) return null
  const sig = block.signature
  return typeof sig === 'string' && sig.length > 0 ? sig : null
}

/** Build the dedup hash key for a thinking block. Prefers the transcript entry
 *  UUID; falls back to a prefix of the content (or signature, for redacted blocks). */
function thinkingHashKey(entryUuid: string | undefined, fallbackSource: string): string {
  return entryUuid
    ? `thinking:${entryUuid}`
    : `thinking:${fallbackSource.slice(0, HASH_PREFIX_MAX)}`
}

/** Placeholder shown for redacted thinking blocks (matches Claude Code's UI label). */
const REDACTED_THINKING_LABEL = 'Thinking...'

/** Claude Code writes placeholder model ids such as `<synthetic>` on locally
 *  generated assistant messages (API errors, interrupts). They are not models. */
function isRealModelId(model: unknown): model is string {
  return typeof model === 'string' && model.length > 0 && !model.startsWith('<')
}

/** What the parent transcript records about an Agent/Task launch in the
 *  entry-level `toolUseResult` field of the user entry carrying its tool_result. */
function parseAgentToolUseResult(toolUseResult: unknown): { isAsync: boolean; model?: string } {
  if (!isRecord(toolUseResult)) return { isAsync: false }
  return {
    isAsync: toolUseResult.status === 'async_launched' || toolUseResult.isAsync === true,
    model: isRealModelId(toolUseResult.resolvedModel) ? toolUseResult.resolvedModel : undefined,
  }
}

const TASK_NOTIFICATION_PREFIX = '<task-notification'

/** Text of a user entry's content, whether a plain string or text blocks. */
function userContentText(content: TranscriptEntry['message']['content']): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content.map(safeText).filter(Boolean).join('\n')
}

function xmlTag(text: string, tag: string): string | undefined {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  if (!match) return undefined
  return match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
}

/** Parse a `<task-notification>` block (sent when a background task stops).
 *  The block may be preceded by other text (e.g. a system banner), so it is
 *  located anywhere in the string rather than only at the start. */
export function parseTaskNotification(text: string): { toolUseId: string; status: string; summary: string } | null {
  const start = text.indexOf(TASK_NOTIFICATION_PREFIX)
  if (start === -1) return null
  text = text.slice(start)
  const toolUseId = xmlTag(text, 'tool-use-id')
  if (!toolUseId) return null
  return {
    toolUseId,
    status: xmlTag(text, 'status') || 'completed',
    summary: xmlTag(text, 'result') || xmlTag(text, 'summary') || '',
  }
}

/** Text that may carry a `<task-notification>`. Claude Code has delivered it
 *  both as a user turn and, in newer versions, as an `attachment` entry
 *  (`{ type: 'attachment', attachment: { type: 'queued_command', prompt } }`). */
function taskNotificationText(entry: Record<string, unknown>): string {
  if (entry.type === 'attachment') {
    const attachment = entry.attachment
    return isRecord(attachment) && typeof attachment.prompt === 'string' ? attachment.prompt : ''
  }
  if (entry.type === 'user' && isRecord(entry.message)) {
    return userContentText((entry.message as TranscriptEntry['message']).content)
  }
  return ''
}

/** Claude Code writes this as a user entry when you press Esc mid-turn */
const INTERRUPTED_PREFIX = '[Request interrupted'

export function isInterruption(content: TranscriptEntry['message']['content']): boolean {
  return userContentText(content).startsWith(INTERRUPTED_PREFIX)
}

export class TranscriptParser {
  /** Per-subagent dedup state for inline progress events, keyed by parentToolUseID */
  private inlineSubagentState = new Map<string, {
    agentName: string
    pending: Map<string, PendingToolCall>
    seen: Set<string>
    seenMessages: Set<string>
  }>()
  /** Maps Agent tool_use ID → resolved child agent name (set in handleToolUse) */
  private subagentChildNames = new Map<string, string>()
  /** Background Agent/Task launches waiting for their <task-notification>, keyed by tool_use ID.
   *  Their tool_result only confirms the launch; the real finish arrives later. */
  private backgroundSubagents = new Map<string, { childName: string; parent: string; sessionId?: string }>()

  constructor(private delegate: TranscriptParserDelegate) {}

  /** Clean up state associated with a completed session to prevent unbounded Map growth.
   *  Pass the session's pending tool_use_ids so we can remove orphaned entries. */
  clearSessionState(pendingToolUseIds: Iterable<string>, sessionId?: string): void {
    for (const toolUseId of pendingToolUseIds) {
      this.inlineSubagentState.delete(toolUseId)
      this.subagentChildNames.delete(toolUseId)
    }
    if (sessionId) {
      for (const [toolUseId, bg] of this.backgroundSubagents) {
        if (bg.sessionId !== sessionId) continue
        this.backgroundSubagents.delete(toolUseId)
        this.subagentChildNames.delete(toolUseId)
        this.inlineSubagentState.delete(toolUseId)
      }
    }
  }

  processTranscriptLine(
    line: string,
    agentName = ORCHESTRATOR_NAME,
    ctxPending: Map<string, PendingToolCall>,
    ctxSeen: Set<string>,
    sessionId?: string,
    ctxSeenMessages?: Set<string>,
  ): void {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line.trim()) as Record<string, unknown>
    } catch (err) {
      log.debug('Skipping unparseable line:', err)
      return
    }

    // Handle inline subagent progress events (newer Claude Code versions)
    if (parsed.type === 'progress') {
      this.handleProgressEvent(parsed, sessionId)
      return
    }

    // A background task finished. Only Agent/Task launches we're tracking are
    // acted on; background Bash and other tasks send the same block. In user
    // turns the text itself is still filtered below as system-injected content.
    const notification = parseTaskNotification(taskNotificationText(parsed))
    if (notification) { this.handleTaskNotification(notification, sessionId) }

    // Claude Code's own session title — a better tab label than the first prompt
    if (parsed.type === 'ai-title' && typeof parsed.aiTitle === 'string' && sessionId) {
      this.applyAiTitle(parsed.aiTitle, sessionId)
      return
    }

    // Only process actual conversation entries (user/assistant turns)
    if (parsed.type !== 'user' && parsed.type !== 'assistant') {
      return
    }

    const msg = parsed.message as TranscriptEntry['message'] | undefined
    if (!msg) { return }

    // Now we know this is a valid transcript entry
    const entry: TranscriptEntry = {
      sessionId: parsed.sessionId as string,
      type: parsed.type as string,
      uuid: parsed.uuid as string | undefined,
      message: msg,
    }

    // Try to set session label from first user message (for live events after session start)
    if (sessionId) {
      this.maybeSetSessionLabel(entry, sessionId)
    }

    const role = msg.role // 'assistant', 'user', 'human'

    const session = sessionId ? this.delegate.getSession(sessionId) : undefined

    // Extract model from assistant messages (updates tokensMax on the frontend).
    // Per-agent tracking: re-emit when the model changes (e.g. /model switch).
    if (session && entry.type === 'assistant' && isRealModelId(msg.model) && session.modelDetectedAgents.get(agentName) !== msg.model) {
      session.modelDetectedAgents.set(agentName, msg.model)
      if (!session.model) session.model = msg.model
      this.delegate.emit({
        time: this.delegate.elapsed(sessionId),
        type: 'model_detected',
        payload: { agent: agentName, model: msg.model },
      }, sessionId)
    }

    // Real token usage and turn state (usage.ts)
    const tracking = session ? trackingFor(session, agentName) : undefined
    if (tracking && entry.type === 'assistant') {
      const usage = parseUsage(msg.usage)
      const delta = usage ? recordUsage(tracking, msg.id, usage) : null
      if (delta) {
        this.delegate.emit({
          time: this.delegate.elapsed(sessionId),
          type: 'usage',
          payload: { agent: agentName, ...(isRealModelId(msg.model) ? { model: msg.model } : {}), ...delta },
        }, sessionId)
      }
      tracking.turnEnd = msg.stop_reason === 'end_turn' ? 'waiting' : undefined
    } else if (tracking && entry.type === 'user') {
      tracking.turnEnd = isInterruption(msg.content) ? 'interrupted' : undefined
    }

    // Dedup set for messages (context compression replays old messages)
    const seenMsgs = ctxSeenMessages ?? session?.seenMessageHashes

    // Handle string content (user messages are often just strings)
    if (typeof msg.content === 'string' && msg.content.trim()) {
      if (role === 'user' || role === 'human') {
        const text = msg.content.trim()
        // Skip system-injected context (continuation summaries, IDE context, etc.)
        if (!this.isSystemInjectedContent(text)) {
          const hash = entry.uuid ? `user:${entry.uuid}` : `user:${text.slice(0, HASH_PREFIX_MAX)}`
          if (seenMsgs && seenMsgs.has(hash)) { /* skip duplicate */ }
          else {
            seenMsgs?.add(hash)
            if (tracking) { tracking.breakdown.userMessages += estimateTokensFromText(text) }
            this.delegate.emit({
              time: this.delegate.elapsed(sessionId),
              type: 'message',
              payload: { agent: agentName, role: 'user', content: text.slice(0, MESSAGE_MAX) },
            }, sessionId)
          }
        }
      }
      if (session) { this.delegate.emitContextUpdate(agentName, session, sessionId) }
      this.emitTurnEnd(agentName, tracking, sessionId)
      return
    }

    if (!Array.isArray(msg.content)) { return }

    // Determine the emitted role from the JSONL entry role
    const emitRole = (role === 'user' || role === 'human') ? 'user' : 'assistant'

    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        const toolBlock = block as ToolUseBlock
        if (ctxSeen.has(toolBlock.id)) { continue }
        ctxSeen.add(toolBlock.id)
        this.handleToolUse(toolBlock, agentName, ctxPending, sessionId)
      } else if (block.type === 'tool_result') {
        this.handleToolResult(block as ToolResultBlock, agentName, ctxPending, sessionId, parsed.toolUseResult)
      } else if (block.type === 'text' && 'text' in block) {
        this.handleTextBlock(block, emitRole, entry.uuid, agentName, seenMsgs, session, sessionId)
      } else if (block.type === 'thinking' && 'thinking' in block) {
        this.handleThinkingBlock(block, entry.uuid, agentName, seenMsgs, session, sessionId)
      }
    }

    if (session) { this.delegate.emitContextUpdate(agentName, session, sessionId) }
    this.emitTurnEnd(agentName, tracking, sessionId)
  }

  /** The main agent finished its turn (or was interrupted) and now waits for
   *  the user. Emitted last, after this entry's message and context events,
   *  so nothing for the same entry flips it back to busy. */
  private emitTurnEnd(agentName: string, tracking: AgentTracking | undefined, sessionId?: string): void {
    if (agentName !== ORCHESTRATOR_NAME || !tracking?.turnEnd) return
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: 'agent_idle',
      payload: { name: agentName, reason: tracking.turnEnd },
    }, sessionId)
  }

  /** Use Claude Code's generated title as the session label */
  private applyAiTitle(title: string, sessionId: string): void {
    const session = this.delegate.getSession(sessionId)
    if (!session) return
    const label = this.truncateLabel(title)
    if (!label || label === session.label) return
    session.label = label
    session.labelSet = true
    this.delegate.fireSessionLifecycle({ type: 'updated', sessionId, label })
  }

  /** Process a text block — dedup, track tokens, emit message event */
  private handleTextBlock(
    block: unknown,
    emitRole: 'user' | 'assistant',
    entryUuid: string | undefined,
    agentName: string,
    seenMsgs: Set<string> | undefined,
    session: WatchedSession | undefined,
    sessionId?: string,
  ): void {
    const text = safeText(block)
    if (!text) return
    // Skip system/IDE context injected into user turns
    if (emitRole === 'user' && this.isSystemInjectedContent(text)) return

    const hash = entryUuid ? `${emitRole}:${entryUuid}` : `${emitRole}:${text.slice(0, HASH_PREFIX_MAX)}`
    if (seenMsgs?.has(hash)) return
    seenMsgs?.add(hash)

    if (session) {
      const bd = trackingFor(session, agentName).breakdown
      if (emitRole === 'user') { bd.userMessages += estimateTokensFromText(text) }
      else { bd.reasoning += estimateTokensFromText(text) }
    }
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: 'message',
      payload: { agent: agentName, role: emitRole, content: text.slice(0, MESSAGE_MAX) },
    }, sessionId)
  }

  /** Process a thinking block — dedup, track tokens, emit message event.
   *  Redacted thinking (Opus 4.7+) is shown as a "Thinking..." placeholder. */
  private handleThinkingBlock(
    block: unknown,
    entryUuid: string | undefined,
    agentName: string,
    seenMsgs: Set<string> | undefined,
    session: WatchedSession | undefined,
    sessionId?: string,
  ): void {
    const thinking = safeThinking(block)
    const redactedSig = thinking ? null : redactedThinkingSignature(block)
    if (!thinking && !redactedSig) return

    const hash = thinkingHashKey(entryUuid, thinking || redactedSig || '')
    if (seenMsgs?.has(hash)) return
    seenMsgs?.add(hash)

    // Reasoning tokens are unknown for redacted blocks — skip breakdown update
    if (session && thinking) { trackingFor(session, agentName).breakdown.reasoning += estimateTokensFromText(thinking) }
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: 'message',
      payload: {
        agent: agentName,
        role: 'thinking',
        content: thinking ? thinking.slice(0, MESSAGE_MAX) : REDACTED_THINKING_LABEL,
      },
    }, sessionId)
  }

  handleToolUse(
    block: ToolUseBlock,
    agentName: string,
    ctxPending: Map<string, PendingToolCall>,
    sessionId?: string,
  ): void {
    const toolName = block.name
    const args = summarizeInput(toolName, block.input)

    const rawPath = block.input.file_path || block.input.path
    const filePath = typeof rawPath === 'string' ? rawPath : undefined
    ctxPending.set(block.id, {
      name: toolName,
      args,
      filePath,
      startTime: Date.now(),
    })

    // Check if this is a subagent call (Task in older Claude Code, Agent in newer versions)
    if (toolName === 'Task' || toolName === 'Agent') {
      const childName = resolveSubagentChildName(block.input)
      this.subagentChildNames.set(block.id, childName)
      // Only emit spawn once per subagent name (file watcher may have already spawned it)
      const session = sessionId ? this.delegate.getSession(sessionId) : undefined
      if (!session?.spawnedSubagents.has(childName)) {
        session?.spawnedSubagents.add(childName)
        emitSubagentSpawn(this.delegate, agentName, childName, args, sessionId)
      }
    }

    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: 'tool_call_start',
      payload: {
        agent: agentName,
        tool: toolName,
        args,
        preview: `${toolName}: ${args}`.slice(0, PREVIEW_MAX),
        inputData: extractInputData(toolName, block.input),
      },
    }, sessionId)
  }

  handleToolResult(
    block: ToolResultBlock,
    agentName: string,
    ctxPending: Map<string, PendingToolCall>,
    sessionId?: string,
    toolUseResult?: unknown,
  ): void {
    const pending = ctxPending.get(block.tool_use_id)
    // Skip orphaned tool_results (their tool_use was deduped during catch-up)
    if (!pending) { return }
    const toolName = pending.name
    const result = summarizeResult(block.content)
    const tokenCost = estimateTokensFromContent(block.content)

    // Update context breakdown
    if (sessionId) {
      const session = this.delegate.getSession(sessionId)
      if (session) {
        const bd = trackingFor(session, agentName).breakdown
        if (toolName === 'Task' || toolName === 'Agent') {
          bd.subagentResults += tokenCost
        } else {
          bd.toolResults += tokenCost
        }
      }
    }

    ctxPending.delete(block.tool_use_id)

    // Build discovery for file-related tools
    const discovery = buildDiscovery(toolName, pending?.filePath || '', result)

    if (toolName === 'Task' || toolName === 'Agent') {
      const childName = this.subagentChildNames.get(block.tool_use_id) || pending?.args?.slice(0, CHILD_NAME_MAX) || 'subagent'
      const launch = parseAgentToolUseResult(toolUseResult)
      if (launch.model) { this.emitSubagentModel(childName, launch.model, sessionId) }

      if (launch.isAsync) {
        // Background launch: the subagent keeps running. It finishes when its
        // <task-notification> arrives (see handleTaskNotification).
        this.backgroundSubagents.set(block.tool_use_id, { childName, parent: agentName, sessionId })
      } else {
        // Clean up inline subagent tracking state
        this.subagentChildNames.delete(block.tool_use_id)
        this.inlineSubagentState.delete(block.tool_use_id)
        this.emitSubagentFinished(childName, agentName, result, sessionId)
      }
    }

    // Detect errors in tool output
    const isError = detectError(result)
    const errorMessage = isError ? result.slice(0, FAILED_RESULT_MAX) : undefined

    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: 'tool_call_end',
      payload: {
        agent: agentName,
        tool: toolName,
        result: result.slice(0, RESULT_MAX),
        tokenCost,
        ...(discovery ? { discovery } : {}),
        ...(isError ? { isError, errorMessage } : {}),
      },
    }, sessionId)

    // Emit updated context breakdown
    if (sessionId) {
      const session = this.delegate.getSession(sessionId)
      if (session) { this.delegate.emitContextUpdate(agentName, session, sessionId) }
    }
  }

  private emitSubagentFinished(childName: string, parent: string, summary: string, sessionId?: string): void {
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: 'subagent_return',
      payload: { child: childName, parent, summary: summary.slice(0, ARGS_MAX) },
    }, sessionId)
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: 'agent_complete',
      payload: { name: childName },
    }, sessionId)
  }

  /** Report a subagent's model from the parent transcript, unless its own
   *  transcript already did. Covers subagents whose file is never tailed. */
  private emitSubagentModel(childName: string, model: string, sessionId?: string): void {
    const session = sessionId ? this.delegate.getSession(sessionId) : undefined
    if (!session || session.modelDetectedAgents.has(childName)) return
    session.modelDetectedAgents.set(childName, model)
    this.delegate.emit({
      time: this.delegate.elapsed(sessionId),
      type: 'model_detected',
      payload: { agent: childName, model },
    }, sessionId)
  }

  private handleTaskNotification(
    notification: { toolUseId: string; status: string; summary: string },
    sessionId?: string,
  ): void {
    this.finishBackgroundSubagent(notification.toolUseId, notification.status, notification.summary, sessionId)
  }

  /** Complete a background Agent/Task launch. Called for its `<task-notification>`
   *  and by the subagent watcher when the subagent's .meta.json reports
   *  `finished: true` — whichever comes first wins, the other is a no-op.
   *  Returns false if the launch isn't tracked (unknown, or not a background run). */
  finishBackgroundSubagent(toolUseId: string, status: string, summary: string, sessionId?: string): boolean {
    const bg = this.backgroundSubagents.get(toolUseId)
    if (!bg) return false
    this.backgroundSubagents.delete(toolUseId)
    this.subagentChildNames.delete(toolUseId)
    this.inlineSubagentState.delete(toolUseId)
    const text = status === 'completed' ? summary : `[${status}] ${summary}`.trim()
    this.emitSubagentFinished(bg.childName, bg.parent, text, sessionId)
    return true
  }

  /**
   * Handle inline progress events from newer Claude Code versions.
   * These carry subagent transcript entries directly in the main JSONL,
   * keyed by parentToolUseID (the Agent tool_use that spawned the subagent).
   */
  private handleProgressEvent(
    parsed: Record<string, unknown>,
    sessionId?: string,
  ): void {
    const data = parsed.data
    if (!isRecord(data) || data.type !== 'agent_progress') { return }

    const innerEntry = data.message as TranscriptEntry | undefined
    if (!innerEntry?.message) { return }

    const parentToolUseID = typeof parsed.parentToolUseID === 'string' ? parsed.parentToolUseID : undefined
    if (!parentToolUseID) { return }

    // Get or create per-subagent dedup state
    let subState = this.inlineSubagentState.get(parentToolUseID)
    if (!subState) {
      // Resolve agent name from the stored child name (set when the Agent tool_use was parsed)
      const childName = this.subagentChildNames.get(parentToolUseID) || generateSubagentFallbackName('', this.inlineSubagentState.size + 1)
      subState = {
        agentName: childName,
        pending: new Map(),
        seen: new Set(),
        seenMessages: new Set(),
      }
      this.inlineSubagentState.set(parentToolUseID, subState)

      // Mark this subagent as receiving inline progress — file watcher should skip events
      if (sessionId) {
        const session = this.delegate.getSession(sessionId)
        session?.inlineProgressAgents.add(childName)
      }
    }

    // Re-wrap as a JSONL line and process through the normal pipeline
    const innerLine = JSON.stringify(innerEntry)
    this.processTranscriptLine(innerLine, subState.agentName, subState.pending, subState.seen, sessionId, subState.seenMessages)
  }

  /**
   * Pre-scan existing file content:
   * 1. Build seenToolUseIds dedup set (prevents re-emitting old tool calls)
   * 2. Return all entries for catch-up emission
   */
  prescanExistingContent(filePath: string, size: number, session: WatchedSession): TranscriptEntry[] {
    if (size === 0) { return [] }
    // Only two kinds of entries are needed afterwards: the first real user
    // message (session label) and the current turn (catch-up). Keeping every
    // entry would hold a whole transcript in memory — they reach hundreds of MB.
    let labelEntry: TranscriptEntry | null = null
    let currentTurn: TranscriptEntry[] = []
    let entryCount = 0
    let aiTitle: string | null = null
    const orchestrator = trackingFor(session, ORCHESTRATOR_NAME)
    try {
      // Read only up to `size` bytes — the file may have grown since stat.
      // Reading beyond would add tool_use IDs to the dedup set that haven't
      // been accounted for in fileSize, causing readNewLines to silently skip them.
      // Streamed line by line: large files don't fit in a single string.
      forEachLine(filePath, size, (line) => {
        if (!line.trim()) { return }
        try {
          const entry = JSON.parse(line.trim()) as TranscriptEntry & { toolUseResult?: unknown }
          // Track background subagents still running at attach time, so the
          // <task-notification> that arrives later can complete them.
          const notification = parseTaskNotification(taskNotificationText(entry as unknown as Record<string, unknown>))
          if (notification) { this.backgroundSubagents.delete(notification.toolUseId) }
          // Build dedup sets for tool_use blocks and messages + accumulate token counts
          const isUser = entry.message?.role === 'user' || entry.message?.role === 'human'
          if (entry.message && Array.isArray(entry.message.content)) {
            for (const block of entry.message.content) {
              if (block.type === 'tool_use' && (block as ToolUseBlock).id) {
                const toolBlock = block as ToolUseBlock
                session.seenToolUseIds.add(toolBlock.id)
                // Track subagent names so handleToolResult can resolve the child
                // name on completion. They are not marked as spawned: the subagent
                // watcher spawns the ones still running once their files are found.
                if (toolBlock.name === 'Agent' || toolBlock.name === 'Task') {
                  this.subagentChildNames.set(toolBlock.id, resolveSubagentChildName(toolBlock.input))
                }
                // Track pending tool calls so handleToolResult works after reconnect
                const args = summarizeInput(toolBlock.name, toolBlock.input)
                const rawPath = toolBlock.input.file_path || toolBlock.input.path
                const filePath = typeof rawPath === 'string' ? rawPath : undefined
                session.pendingToolCalls.set(toolBlock.id, { name: toolBlock.name, args, filePath, startTime: Date.now() })
              } else if (block.type === 'tool_result') {
                const resultBlock = block as ToolResultBlock
                const childName = resultBlock.tool_use_id ? this.subagentChildNames.get(resultBlock.tool_use_id) : undefined
                if (childName && parseAgentToolUseResult(entry.toolUseResult).isAsync) {
                  this.backgroundSubagents.set(resultBlock.tool_use_id, { childName, parent: ORCHESTRATOR_NAME, sessionId: session.sessionId })
                }
                // Clear matched pending tool call
                if (resultBlock.tool_use_id) {
                  session.pendingToolCalls.delete(resultBlock.tool_use_id)
                }
                // Accumulate tool result tokens
                session.contextBreakdown.toolResults += estimateTokensFromContent(resultBlock.content)
              } else if (block.type === 'text' && 'text' in block) {
                const text = safeText(block)
                if (text) {
                  const emitRole = isUser ? 'user' : 'assistant'
                  const hashKey = entry.uuid ? `${emitRole}:${entry.uuid}` : `${emitRole}:${text.slice(0, HASH_PREFIX_MAX)}`
                  session.seenMessageHashes.add(hashKey)
                  // Accumulate text tokens
                  if (isUser) { session.contextBreakdown.userMessages += estimateTokensFromText(text) }
                  else { session.contextBreakdown.reasoning += estimateTokensFromText(text) }
                }
              } else if (block.type === 'thinking' && 'thinking' in block) {
                const thinking = safeThinking(block)
                const redactedSig = thinking ? null : redactedThinkingSignature(block)
                if (thinking || redactedSig) {
                  session.seenMessageHashes.add(thinkingHashKey(entry.uuid, thinking || redactedSig || ''))
                  if (thinking) { session.contextBreakdown.reasoning += estimateTokensFromText(thinking) }
                }
              }
            }
          } else if (entry.type === 'user' && typeof entry.message?.content === 'string') {
            const text = entry.message.content.trim()
            if (text) {
              const hashKey = entry.uuid ? `user:${entry.uuid}` : `user:${text.slice(0, HASH_PREFIX_MAX)}`
              session.seenMessageHashes.add(hashKey)
              session.contextBreakdown.userMessages += estimateTokensFromText(text)
            }
          }
          // Extract model from first assistant message
          if (entry.type === 'assistant' && isRealModelId(entry.message?.model) && !session.model) {
            session.model = entry.message.model
          }
          if ((entry as { type?: string }).type === 'ai-title') {
            const title = (entry as { aiTitle?: unknown }).aiTitle
            if (typeof title === 'string' && title.trim()) { aiTitle = title }
            return
          }
          // Real usage and how the last turn ended (orchestrator — this is the main transcript)
          if (entry.type === 'assistant' && entry.message) {
            const usage = parseUsage(entry.message.usage)
            if (usage) { recordUsage(orchestrator, entry.message.id, usage) }
            orchestrator.turnEnd = entry.message.stop_reason === 'end_turn' ? 'waiting' : undefined
          } else if (entry.type === 'user' && entry.message) {
            orchestrator.turnEnd = isInterruption(entry.message.content) ? 'interrupted' : undefined
          }
          // Keep the label candidate and the entries since the last user entry
          if (entry.type === 'user' || entry.type === 'assistant') {
            entryCount++
            if (!labelEntry && entry.type === 'user' && this.extractUserMessageText(entry)) { labelEntry = entry }
            if (entry.type === 'user') { currentTurn = [entry] } else { currentTurn.push(entry) }
          }
        } catch (err) { log.debug('Skipping unparseable transcript line:', err) }
      })
      log.info(`Pre-scanned ${session.seenToolUseIds.size} existing tool_use IDs, ${entryCount} entries total`)
      if (aiTitle) {
        session.label = this.truncateLabel(aiTitle)
        session.labelSet = true
      }

      // Label entry first, current turn last: emitCatchUpEntries replays from the last user entry
      return labelEntry && !currentTurn.includes(labelEntry) ? [labelEntry, ...currentTurn] : currentTurn
    } catch (err) {
      log.error('Pre-scan failed:', err)
      return []
    }
  }

  /** Emit message events for pre-existing transcript entries (catch-up on session detection).
   *  Only emits the last user message (the current turn), not the full history. */
  emitCatchUpEntries(entries: TranscriptEntry[], session: WatchedSession, sessionId: string): void {
    // Find the last user entry — that's the current turn
    let lastUserIndex = -1
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === 'user') { lastUserIndex = i; break }
    }
    if (lastUserIndex === -1) { return }
    const recentEntries = entries.slice(lastUserIndex)

    for (const entry of recentEntries) {
      const role = entry.type === 'user' ? 'user' : 'assistant'
      const msg = entry.message
      if (!msg) { continue }

      // String content (common for user messages)
      if (typeof msg.content === 'string' && msg.content.trim()) {
        const text = msg.content.trim()
        if (this.isSystemInjectedContent(text)) { continue }
        this.delegate.emit({
          time: 0,
          type: 'message',
          payload: { agent: ORCHESTRATOR_NAME, role, content: text.slice(0, MESSAGE_MAX) },
        }, sessionId)
        continue
      }

      // Array content (text blocks, thinking blocks, tool_use blocks)
      if (!Array.isArray(msg.content)) { continue }
      for (const block of msg.content) {
        if (block.type === 'text' && 'text' in block) {
          const text = safeText(block)
          if (text && !this.isSystemInjectedContent(text)) {
            this.delegate.emit({
              time: 0,
              type: 'message',
              payload: { agent: ORCHESTRATOR_NAME, role, content: text.slice(0, MESSAGE_MAX) },
            }, sessionId)
          }
        }
      }
    }
  }

  /** Extract a human-readable label from the first user message in transcript entries */
  extractSessionLabel(entries: TranscriptEntry[], session: WatchedSession): void {
    if (session.labelSet) return
    for (const entry of entries) {
      if (entry.type !== 'user') continue
      const text = this.extractUserMessageText(entry)
      if (text) {
        session.label = this.truncateLabel(text)
        session.labelSet = true
        return
      }
    }
  }

  /** Extract text content from a user transcript entry, skipping system-injected tags */
  extractUserMessageText(entry: TranscriptEntry): string | null {
    const msg = entry.message
    if (!msg) return null
    if (typeof msg.content === 'string' && msg.content.trim()) {
      const text = msg.content.trim()
      if (!this.isSystemInjectedContent(text)) return text
      return null
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && 'text' in block) {
          const text = safeText(block)
          if (text && !this.isSystemInjectedContent(text)) return text
        }
      }
    }
    return null
  }

  /** Check if text is system-injected context (not a real user/assistant message) */
  isSystemInjectedContent(text: string): boolean {
    return SYSTEM_CONTENT_PREFIXES.some(prefix => text.startsWith(prefix))
  }

  /** Truncate to first line, max chars — fits in a tab */
  truncateLabel(text: string): string {
    const firstLine = text.split('\n')[0].trim()
    if (firstLine.length <= SESSION_LABEL_MAX) return firstLine
    return firstLine.slice(0, SESSION_LABEL_TRUNCATED) + '..'
  }

  /** Update session label on first user message and notify the webview */
  maybeSetSessionLabel(entry: TranscriptEntry, sessionId: string): void {
    const session = this.delegate.getSession(sessionId)
    if (!session || session.labelSet) return
    if (entry.type !== 'user') return
    const text = this.extractUserMessageText(entry)
    if (!text) return
    session.label = this.truncateLabel(text)
    session.labelSet = true
    this.delegate.fireSessionLifecycle({ type: 'updated', sessionId, label: session.label })
  }
}
