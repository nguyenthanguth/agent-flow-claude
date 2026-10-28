/**
 * Color palette and role color definitions.
 *
 * Warm dark theme: neutral stone surfaces, Claude's clay as the accent, and
 * muted hues for agent states. State/edge colors must stay 6-digit hex —
 * drawing code appends alpha bytes to them (e.g. `color + '40'`).
 */

import type { AgentState, ContextBreakdown } from './agent-types'

const C = {
  clay: '#d97757',
  blue: '#6a9bcc',
  sage: '#86a87a',
  red: '#e0675d',
  amber: '#e2b05a',
  mauve: '#b48fbf',
  stone: '#a29f96',
} as const

export const COLORS = {
  // Background
  void: '#191816',
  hexGrid: '#2e2d29',

  // Primary accent
  holoBase: C.clay,
  holoBright: '#edebe5',
  holoHot: '#ffffff',

  // Agent States
  idle: C.stone,
  thinking: C.clay,
  tool_calling: C.blue,
  complete: C.sage,
  error: C.red,
  paused: '#75736c',
  waiting_permission: C.amber,

  // Edge/Particle Colors
  dispatch: C.clay,
  return: C.sage,
  tool: C.blue,
  message: C.stone,

  // Context breakdown colors
  contextSystem: '#6b6962',     // fixed overhead
  contextUser: C.amber,         // user input
  contextToolResults: C.blue,   // tool output — usually the biggest share
  contextReasoning: C.mauve,    // agent thinking
  contextSubagent: C.sage,      // child agent results

  // UI Chrome
  nodeInterior: '#24231f',
  textPrimary: '#edebe5',
  textDim: '#b7b4ab',
  textMuted: '#8a877e',

  // Panels
  glassBg: 'rgba(33, 32, 29, 0.96)',
  glassBorder: 'rgba(255, 248, 235, 0.10)',
  glassHighlight: 'rgba(255, 248, 235, 0.04)',

  // Neutral overlays (avoids scattered rgba literals)
  holoBg03: 'rgba(255, 248, 235, 0.03)',
  holoBg05: 'rgba(255, 248, 235, 0.05)',
  holoBg10: 'rgba(255, 248, 235, 0.08)',
  holoBorder06: 'rgba(255, 248, 235, 0.06)',
  holoBorder08: 'rgba(255, 248, 235, 0.08)',
  holoBorder10: 'rgba(255, 248, 235, 0.10)',
  holoBorder12: 'rgba(255, 248, 235, 0.13)',

  // Panel chrome
  panelBg: 'rgba(30, 29, 26, 0.97)',
  panelSeparator: 'rgba(255, 248, 235, 0.07)',

  // Toggle button states
  toggleActive: 'rgba(217, 119, 87, 0.16)',
  toggleInactive: 'rgba(255, 248, 235, 0.04)',
  toggleBorder: 'rgba(255, 248, 235, 0.10)',

  // Live indicator
  liveDot: C.red,
  liveText: '#ef8a80',
  liveResumeBg: 'rgba(224, 103, 93, 0.14)',
  liveResumeBorder: 'rgba(224, 103, 93, 0.35)',

  // Discovery type colors
  discoveryFile: C.blue,
  discoveryPattern: C.mauve,
  discoveryFinding: C.sage,
  discoveryCode: C.amber,

  // Session tab states
  tabSelectedBg: 'rgba(255, 248, 235, 0.08)',
  tabInactiveBg: 'rgba(255, 248, 235, 0.02)',
  tabSelectedBorder: 'rgba(217, 119, 87, 0.50)',
  tabInactiveBorder: 'rgba(255, 248, 235, 0.07)',
  tabClose: C.red,

  // Role colors (message bubbles)
  roleAssistantBg: 'rgba(255, 248, 235, 0.05)',
  roleAssistantBgSelected: 'rgba(255, 248, 235, 0.09)',
  roleAssistantText: '#e4e1d9',
  roleThinkingBg: 'rgba(180, 143, 191, 0.10)',
  roleThinkingBgSelected: 'rgba(180, 143, 191, 0.17)',
  roleThinkingText: '#cdb3d4',
  roleUserBg: 'rgba(226, 176, 90, 0.10)',
  roleUserBgSelected: 'rgba(226, 176, 90, 0.17)',
  roleUserText: '#ecd3a2',

  // Result/success
  resultBg: 'rgba(134, 168, 122, 0.07)',
  resultBorder: 'rgba(134, 168, 122, 0.16)',

  // Unread indicator
  unreadDot: C.clay,

  // Play button
  playBtnBg: 'rgba(217, 119, 87, 0.14)',
  playBtnActiveBg: 'rgba(217, 119, 87, 0.24)',
  playBtnBorder: 'rgba(217, 119, 87, 0.45)',
  playBtnGlow: 'none',

  // Scrubber
  scrubberFill: 'linear-gradient(90deg, rgba(217,119,87,0.45), rgba(217,119,87,0.85))',
  scrubberHeadGlow: '0 0 0 3px rgba(217, 119, 87, 0.25)',
  reviewBtnBorder: 'rgba(255, 248, 235, 0.14)',

  // Cost overlay
  costActiveBg: 'rgba(134, 168, 122, 0.16)',

  // Canvas drawing — bubble base colors (partial rgba, alpha appended at draw time)
  bubbleThinkingBase: 'rgba(58, 48, 62,',
  bubbleUserBase: 'rgba(64, 54, 36,',
  bubbleAssistantBase: 'rgba(40, 39, 36,',

  // Canvas drawing — tool card backgrounds (partial rgba, alpha appended at draw time)
  toolCardErrorBase: 'rgba(62, 30, 27,',
  toolCardSelectedBase: 'rgba(217, 119, 87,',
  toolCardBase: 'rgba(38, 37, 34,',

  // Canvas drawing — agent/tool card backgrounds
  cardBgDark: 'rgba(27, 26, 24, 0.92)',
  cardBg: 'rgba(38, 37, 34, 0.94)',
  cardBgSelected: 'rgba(46, 45, 41, 0.97)',
  cardBgError: 'rgba(62, 30, 27, 0.94)',
  cardBgSelectedHolo: 'rgba(217, 119, 87, 0.14)',
  cardBgFaintOverlay: 'rgba(0, 0, 0, 0.01)',

  // Active tool indicator (detail card)
  toolIndicatorBg: 'rgba(106, 155, 204, 0.12)',
  toolIndicatorBorder: 'rgba(106, 155, 204, 0.30)',
  toolIndicatorText: '#8fb6dd',

  // Canvas drawing — cost labels
  costText: '#a3c497',
  costTextDim: '#a3c49799',
  costPillBg: 'rgba(33, 32, 29, 0.94)',
  costPillStroke: 'rgba(134, 168, 122, 0.35)',

  // Canvas drawing — cost panel bar fills
  barFillMain: 'rgba(217, 119, 87, 0.28)',
  barFillSub: 'rgba(106, 155, 204, 0.28)',

  // ─── Transcript / message feed colors ───────────────────────────────────────

  // User messages
  userMsgBg: 'rgba(226, 176, 90, 0.07)',
  userMsgBorder: 'rgba(226, 176, 90, 0.18)',
  userLabel: '#e2b05acc',
  userText: '#ecd3a2',

  // Assistant messages
  assistantLabel: C.clay,
  assistantText: '#e4e1d9',

  // Thinking messages
  thinkingBgExpanded: 'rgba(180, 143, 191, 0.08)',
  thinkingBgCollapsed: 'rgba(180, 143, 191, 0.04)',
  thinkingBorder: 'rgba(180, 143, 191, 0.15)',
  thinkingLabel: '#b48fbfcc',
  thinkingArrow: '#b48fbf99',
  thinkingPreview: '#cdb3d4',
  thinkingTextExpanded: '#cdb3d4cc',
  thinkingBorderLeft: 'rgba(180, 143, 191, 0.35)',

  // Tool call messages
  toolCallBg: 'rgba(106, 155, 204, 0.07)',
  toolCallBorder: 'rgba(106, 155, 204, 0.18)',

  // Tool result messages
  bashResultBg: 'rgba(0, 0, 0, 0.25)',
  toolResultBg: 'rgba(134, 168, 122, 0.06)',
  bashResultBorder: 'rgba(255, 248, 235, 0.08)',
  toolResultBorder: 'rgba(134, 168, 122, 0.18)',
  bashResultText: '#cfccc4',
  toolResultText: '#b5cfab',
  textFaint: '#8a877e',

  // Search highlight
  searchHighlightBg: 'rgba(226, 176, 90, 0.35)',

  // ─── Diff / code block colors ───────────────────────────────────────────────

  codeBlockBg: 'rgba(0, 0, 0, 0.28)',
  diffRemoved: '#ef8a80',
  diffRemovedBg: 'rgba(224, 103, 93, 0.12)',
  diffAdded: '#a9c99c',
  diffAddedBg: 'rgba(134, 168, 122, 0.14)',

  // ─── Tool content colors ────────────────────────────────────────────────────

  filePathActive: '#8fb6dd',
  filePathInactive: '#8fb6dd99',
  todoCompleted: C.sage,
  todoCompletedText: '#86a87a99',
  todoPending: '#8a877e',
  contentDim: '#b7b4ab',
  searchIcon: '#8a877e',

  // ─── Panel header / chrome text ─────────────────────────────────────────────

  panelLabel: '#b7b4ab',
  panelLabelDim: '#8a877e',
  scrollBtnText: C.clay,
  scrollbarThumb: 'rgba(255, 248, 235, 0.14)',
} as const

// ─── Role Colors (message feed & bubbles) ───────────────────────────────────

export const ROLE_COLORS: Record<string, { bg: string; bgSelected: string; text: string; label: string }> = {
  assistant: { bg: COLORS.roleAssistantBg, bgSelected: COLORS.roleAssistantBgSelected, text: COLORS.roleAssistantText, label: 'CLAUDE' },
  thinking:  { bg: COLORS.roleThinkingBg,  bgSelected: COLORS.roleThinkingBgSelected,  text: COLORS.roleThinkingText,  label: 'THINKING' },
  user:      { bg: COLORS.roleUserBg,       bgSelected: COLORS.roleUserBgSelected,       text: COLORS.roleUserText,       label: 'USER' },
} as const

// ─── Color Helper Functions ──────────────────────────────────────────────────

export function getStateColor(state: AgentState): string {
  switch (state) {
    case 'idle': return COLORS.idle
    case 'thinking': return COLORS.thinking
    case 'tool_calling': return COLORS.tool_calling
    case 'complete': return COLORS.complete
    case 'error': return COLORS.error
    case 'paused': return COLORS.paused
    case 'waiting_permission': return COLORS.waiting_permission
  }
}

export function getDiscoveryTypeColor(type: string): string {
  switch (type) {
    case 'file': return COLORS.discoveryFile
    case 'pattern': return COLORS.discoveryPattern
    case 'finding': return COLORS.discoveryFinding
    default: return COLORS.discoveryCode
  }
}

/** Safely combine a partial rgba base (e.g. 'rgba(10, 15, 30,') with an alpha value */
export function withAlpha(rgbaBase: string, alpha: number): string {
  return `${rgbaBase} ${alpha})`
}

/** Build the context-breakdown color segments for a given breakdown. */
export function contextSegments(bd: ContextBreakdown) {
  return [
    { value: bd.systemPrompt, color: COLORS.contextSystem },
    { value: bd.userMessages, color: COLORS.contextUser },
    { value: bd.toolResults, color: COLORS.contextToolResults },
    { value: bd.reasoning, color: COLORS.contextReasoning },
    { value: bd.subagentResults, color: COLORS.contextSubagent },
  ]
}
