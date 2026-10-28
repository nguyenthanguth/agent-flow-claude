/**
 * Message protocol between the server and the web UI (one-way, over SSE),
 * plus the Claude Code transcript types the server parses.
 */

// ─── Agent Event Types (from real agent sessions) ────────────────────────────

export type AgentEventType =
  | 'agent_spawn'
  | 'agent_complete'
  | 'agent_idle'
  | 'message'
  | 'context_update'
  | 'model_detected'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'subagent_dispatch'
  | 'subagent_return'
  | 'usage'
  | 'error'

export interface AgentEvent {
  time: number
  type: AgentEventType
  payload: Record<string, unknown>
  sessionId?: string
}

export interface SessionInfo {
  id: string
  label: string
  status: 'active' | 'completed'
  startTime: number
  lastActivityTime: number
}

// ─── Server → Web Messages (SSE) ─────────────────────────────────────────────

export type ServerMessage =
  | { type: 'agent-event'; event: AgentEvent }
  | { type: 'agent-event-batch'; events: AgentEvent[] }
  | { type: 'reset'; reason: string }
  | { type: 'session-list'; sessions: SessionInfo[] }
  | { type: 'session-started'; session: SessionInfo }
  | { type: 'session-ended'; sessionId: string }
  | { type: 'session-updated'; sessionId: string; label: string }

// ─── Transcript Types (from Claude Code JSONL files) ─────────────────────────

export interface TranscriptEntry {
  sessionId: string
  type: string
  uuid?: string
  message: {
    role: string
    model?: string
    /** API message id — shared by every entry written for one response */
    id?: string
    /** API usage for the request that produced this response */
    usage?: unknown
    stop_reason?: string | null
    content: Array<TranscriptContentBlock> | string
  }
}

export interface ToolUseBlock {
  type: 'tool_use'
  name: string
  id: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | Array<{ text?: string; type?: string }>
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface TextBlock {
  type: 'text'
  text: string
}

export type TranscriptContentBlock =
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | TextBlock
  | { type: string; [key: string]: unknown }

// ─── Shared Helpers ─────────────────────────────────────────────────────────

/** Minimal emitter interface used by {@link emitSubagentSpawn}. */
export interface AgentEventEmitter {
  emit(event: AgentEvent, sessionId?: string): void
  elapsed(sessionId?: string): number
}

/**
 * Emit the paired subagent_dispatch + agent_spawn events.
 *
 * This two-event sequence is required every time a subagent is spawned and was
 * previously duplicated in SessionWatcher and TranscriptParser.
 */
export function emitSubagentSpawn(
  emitter: AgentEventEmitter,
  parent: string,
  child: string,
  task: string,
  sessionId?: string,
): void {
  emitter.emit({
    time: emitter.elapsed(sessionId),
    type: 'subagent_dispatch',
    payload: { parent, child, task },
  }, sessionId)
  emitter.emit({
    time: emitter.elapsed(sessionId),
    type: 'agent_spawn',
    payload: { name: child, parent, task },
  }, sessionId)
}

// ─── Shared Internal Types ───────────────────────────────────────────────────

/** A tool call that has started but not yet received its result */
export interface PendingToolCall {
  name: string
  args: string
  filePath?: string
  startTime: number
}

// ─── Session Types ──────────────────────────────────────────────────────────

export interface SubagentState {
  watcher: import('fs').FSWatcher | null
  fileSize: number
  agentName: string
  pendingToolCalls: Map<string, PendingToolCall>
  seenToolUseIds: Set<string>
  spawnEmitted: boolean
  /** Agent tool_use ID that launched this subagent (from its .meta.json) */
  toolUseId?: string
  /** Set once the .meta.json reports `finished: true` — stops tailing */
  finished: boolean
}

/** State tracked for a single watched Claude Code session */
export interface WatchedSession {
  sessionId: string
  filePath: string
  fileWatcher: import('fs').FSWatcher | null
  pollTimer: NodeJS.Timeout | null
  fileSize: number
  sessionStartTime: number
  pendingToolCalls: Map<string, PendingToolCall>
  seenToolUseIds: Set<string>
  seenMessageHashes: Set<string>
  sessionDetected: boolean
  sessionCompleted: boolean
  lastActivityTime: number
  inactivityTimer: NodeJS.Timeout | null
  subagentWatchers: Map<string, SubagentState>
  /** Names of subagents already spawned (by transcript parser or file watcher) — prevents duplicate spawns */
  spawnedSubagents: Set<string>
  /** Subagent names currently receiving inline progress events — file watcher skips these */
  inlineProgressAgents: Set<string>
  subagentsDirWatcher: import('fs').FSWatcher | null
  subagentsDir: string | null
  /** Set after the first subagents-dir scan; files found later were created live */
  subagentsScanned: boolean
  label: string
  labelSet: boolean
  model: string | null
  /** Maps agent names to their last emitted model ID — re-emits on model change */
  modelDetectedAgents: Map<string, string>
  contextBreakdown: {
    systemPrompt: number
    userMessages: number
    toolResults: number
    reasoning: number
    subagentResults: number
  }
  /** Per-agent context, usage and turn state (see usage.ts → trackingFor) */
  agentTracking?: Map<string, import('./usage').AgentTracking>
}
