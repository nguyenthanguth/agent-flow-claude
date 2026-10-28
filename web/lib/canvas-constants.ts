// ─── Model families ──────────────────────────────────────────────────────────

/** Single source of truth for Claude model families. Display names
 *  (formatModelName in utils.ts), context-window sizes, and cost rates all
 *  derive from this table — add new families here and nowhere else.
 *  Rates are blended $/M-token (0.75 × input + 0.25 × output per-MTok). */
export const CLAUDE_FAMILIES: ReadonlyArray<{ name: string; context: number; rate: number }> = [
  { name: 'fable',  context: 1_000_000, rate: 20 }, // $10 in / $50 out
  { name: 'mythos', context: 1_000_000, rate: 20 }, // $10 in / $50 out
  { name: 'opus',   context: 1_000_000, rate: 10 }, // $5 in / $25 out
  { name: 'sonnet', context: 1_000_000, rate: 6 },  // $3 in / $15 out
  { name: 'haiku',  context: 200_000,   rate: 2 },  // $1 in / $5 out
]

/** Regex alternation fragment of all Claude family names (e.g. 'fable|mythos|…'). */
export const CLAUDE_FAMILY_ALTERNATION = CLAUDE_FAMILIES.map(f => f.name).join('|')

/** Context window size by model family. Patterns are checked in order;
 *  first match wins. Matched against lower-cased model IDs. */
export const MODEL_FAMILY_CONTEXT: ReadonlyArray<{ pattern: RegExp; size: number }> = [
  ...CLAUDE_FAMILIES.map(f => ({ pattern: new RegExp(`${f.name}-\\d`), size: f.context })),
]
/** Used when no family pattern matches (unknown model). */
export const DEFAULT_CONTEXT_SIZE = 200_000
/** Used when no model ID is available at all. */
export const FALLBACK_CONTEXT_SIZE = 1_000_000

// ─── Typography ──────────────────────────────────────────────────────────────

/** UI font for canvas labels (matches --font-sans in styles.css) */
export const FONT_SANS = '"Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
/** Code font for tool arguments and other literal text (matches --font-mono) */
export const FONT_MONO = '"JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace'

// ─── Visibility threshold ───────────────────────────────────────────────────

/** Minimum opacity for an element to be considered visible (used for edge/draw culling) */
export const MIN_VISIBLE_OPACITY = 0.05

/** Opacity finished subagents settle at — dimmed, but still on the graph */
export const COMPLETED_AGENT_OPACITY = 0.5

// ─── Agent spawn distance ───────────────────────────────────────────────────

export const AGENT_SPAWN_DISTANCE = 250

// ─── LocalStorage keys ─────────────────────────────────────────────────────

export const SOUND_PREF_KEY = 'agent-viz-sound'

// ─── Mock scenario buffer ──────────────────────────────────────────────────

export const MOCK_END_BUFFER_S = 8

// ─── Canvas drawing constants ────────────────────────────────────────────────

/** Seconds a message bubble stays fully visible */
export const BUBBLE_HOLD = 10
/** Seconds for bubble fade-in animation */
export const BUBBLE_FADE_IN = 0.3
/** Seconds for bubble fade-out animation */
export const BUBBLE_FADE_OUT = 1.5
/** Maximum width (px) of a message bubble */
export const BUBBLE_MAX_W = 280
/** Vertical gap (px) between stacked bubbles */
export const BUBBLE_GAP = 8
/** Max visible lines in a bubble before truncation */
export const BUBBLE_MAX_LINES = 6

/** Tool card width (px) for overlap detection */
export const TOOL_CARD_W = 220
/** Tool card height (px) for overlap detection */
export const TOOL_CARD_H = 44

// ─── Animation timing constants ─────────────────────────────────────────────

/** Seconds a completed tool call stays visible before fading */
export const TOOL_MIN_DISPLAY_S = 4.0
/** Seconds before a running tool with no result is treated as orphaned and
 *  faded out. Long builds and test runs are normal, so this is generous. */
export const TOOL_MAX_RUNNING_S = 300
/** Seconds a discovery card stays visible before fading */
export const DISCOVERY_HOLD_S = 8
/** Speed multiplier for discovery lerp toward target position */
export const DISCOVERY_LERP_SPEED = 3
/** Seconds a message bubble is considered visible (for pruning) */
export const BUBBLE_VISIBLE_S = 12


// ─── Animation speed multipliers ─────────────────────────────────────────────
// Multiplied by deltaTime in the animation loop

export const ANIM_SPEED = {
  /** Agent fade-in (opacity per dt) */
  agentFadeIn: 3,
  /** Agent scale-in (scale per dt) */
  agentScaleIn: 4,
  /** Agent fade-out after complete (opacity per dt) */
  agentFadeOut: 0.4,
  /** Agent scale-out after complete (scale per dt) */
  agentScaleOut: 0.05,
  /** Tool fade-in (opacity per dt) */
  toolFadeIn: 4,
  /** Tool fade-out after complete/visible (opacity per dt) */
  toolFadeOut: 1.5,
  /** Edge fade-in (opacity per dt) */
  edgeFadeIn: 4,
  /** Discovery fade-in (opacity per dt) */
  discoveryFadeIn: 2,
  /** Discovery fade-out after hold expires (opacity per dt) */
  discoveryFadeOut: 0.5,
  /** Particle speed multiplier */
  particleSpeed: 1.2,
  /** Default delta time cap (seconds) */
  maxDeltaTime: 0.1,
  /** Default delta time when time info unavailable */
  defaultDeltaTime: 0.016,
  /** Minimum ms between frames (60fps cap, with 1ms slack for timing jitter) */
  minFrameInterval: (1000 / 60) - 1,
} as const

// ─── UI panel constants ─────────────────────────────────────────────────────

/** Distance from bottom (px) before a scroll container is considered "at bottom" */
export const AUTO_SCROLL_THRESHOLD = 60

// ─── Camera / interaction constants ─────────────────────────────────────────

export const CAMERA = {
  zoomStepDown: 0.92,
  zoomStepUp: 1.08,
  minZoom: 0.2,
  maxZoom: 4,
  velocityScale: 0.016,
} as const

// ─── Force simulation config ────────────────────────────────────────────────

export const FORCE = {
  chargeStrength: -1200,
  centerStrength: 0.03,
  collideRadius: 140,
  linkDistance: 350,
  linkStrength: 0.4,
  alphaDecay: 0.02,
  velocityDecay: 0.4,
} as const

// ─── Tool slot placement config ─────────────────────────────────────────────

export const TOOL_SLOT = {
  maxRings: 5,
  baseDistance: 130,
  ringIncrement: 46,
  baseSteps: 5,
  stepsPerRing: 2,
  fallbackDistance: 120,
} as const

// ─── Discovery card dimension helpers ───────────────────────────────────────

export const DISC_CHAR_W = 6
export const DISC_LABEL_CHAR_W = 6.5
export const DISC_MIN_W = 80
export const DISC_MAX_W = 200
export const DISC_PADDING = 16
export const DISC_HEADER_H = 20
export const DISC_LINE_H = 13

/** Half-width used for discovery card bounding box in auto-fit calculations */
export const DISC_BOUNDS_HALF_W = 80
/** Half-height used for discovery card bounding box in auto-fit calculations */
export const DISC_BOUNDS_HALF_H = 30

export function getDiscoveryCardDimensions(label: string, contentLines: string[]) {
  const maxLineWidth = Math.max(...contentLines.map(l => l.length * DISC_CHAR_W), label.length * DISC_LABEL_CHAR_W)
  const cardW = Math.min(Math.max(DISC_MIN_W, maxLineWidth + DISC_PADDING), DISC_MAX_W)
  const cardH = DISC_HEADER_H + contentLines.length * DISC_LINE_H
  return { cardW, cardH }
}

// ─── Tool card dimension constant ───────────────────────────────────────────

export const TOOL_MAX_CARD_W = 240

/** Blended $/M-token rate by model family (0.75 × input + 0.25 × output
 *  per-MTok pricing, the same weighting the original Sonnet-class rate used).
 *  Claude rates derive from CLAUDE_FAMILIES. Patterns are checked in order;
 *  first match wins. Matched against lower-cased model IDs. */
export const MODEL_FAMILY_COST: ReadonlyArray<{ pattern: RegExp; rate: number }> = [
  ...CLAUDE_FAMILIES.map(f => ({ pattern: new RegExp(`${f.name}-\\d`), rate: f.rate })),
]

/** Blended $/M-token fallback rate for unknown models (Sonnet-class) */
export const COST_RATE = 6

// ─── Agent drawing constants ────────────────────────────────────────────────

export const AGENT_DRAW = {
  /** Offset from agent center to bubble anchor point */
  bubbleAnchorOffset: 44,
  /** Initial cursor Y offset for bubbles */
  bubbleCursorY: -20,
  /** Outer glow extra radius beyond agent radius */
  glowPadding: 20,
  /** Ambient outer hex ring offset from agent radius */
  outerRingOffset: 3,
  /** Shadow blur for depth shadow */
  shadowBlur: 15,
  shadowOffsetX: 3,
  shadowOffsetY: 5,
  /** Agent name label Y offset from agent radius */
  labelYOffset: 10,
  /** Agent name label width multiplier of radius */
  labelWidthMultiplier: 5,
  /** Scanline gradient half-height */
  scanlineHalfH: 4,
  /** Scanline width = 2 * scanlineHalfH */
  scanlineWidth: 8,
  /** Dash offset animation speed for waiting state */
  waitingDashSpeed: 25,
  /** Orbiting particle offset from radius */
  orbitParticleOffset: 12,
  orbitParticleSize: 1.5,
  /** Waiting state ripple inner offset from radius */
  rippleInnerOffset: 5,
  rippleMaxExpand: 45,
  rippleMaxAlpha: 0.4,
  /** Waiting state orbiting particle offset */
  waitingOrbitOffset: 14,
  waitingOrbitParticleSize: 2,
  waitingOrbitSpeed: 0.8,
  /** Waiting state breathe parameters */
  waitingBreatheSpeed: 1.2,
  waitingBreatheAmp: 0.08,
  /** Claude spark logo scale factor (relative to radius / SVG viewBox) */
  sparkScale: 0.5,
  /** SVG viewBox size for Claude spark path */
  sparkViewBox: 256,
  /** Sub-agent icon font size relative to radius */
  subIconScale: 0.45,
} as const

export const CONTEXT_BAR = {
  /** Minimum bar width */
  minWidth: 64,
  /** Bar width multiplier of radius */
  widthMultiplier: 2.6,
  barHeight: 4,
  /** Y offset from agent radius */
  yOffset: 32,
  borderRadius: 2,
  /** Font for token count label */
  fontSize: 9.5,
  /** Y padding below bar for label */
  labelPadding: 12,
} as const

export const CONTEXT_RING = {
  /** Ring offset from agent radius */
  ringOffset: 7,
  ringWidth: 3,
  /** Warning threshold ratios */
  warningThreshold: 0.8,
  criticalThreshold: 0.9,
  /** Show percentage label above this usage ratio */
  percentLabelThreshold: 0.7,
  /** Warning glow extra radius */
  glowPadding: 4,
  glowLineWidth: 2,
  glowBlur: 12,
  /** Percentage label Y offset from radius */
  percentYOffset: 14,
} as const

export const STATS_OVERLAY = {
  /** Y offset above agent radius */
  yOffset: 34,
  boxWidth: 108,
  boxHeight: 22,
  borderRadius: 6,
  fontSize: 10,
  textPaddingY: 5,
} as const

// ─── Tool card drawing constants ────────────────────────────────────────────

export const TOOL_DRAW = {
  fontSize: 10.5,
  borderRadius: 8,
  /** Horizontal padding inside the card */
  padX: 10,
  /** Space reserved left of the label for the status dot */
  dotSpace: 12,
  dotRadius: 3,
  /** Extra height for completed/error cards showing token cost */
  expandedHeight: 42,
  collapsedHeight: 30,
  /** Error glow base blur + pulse amplitude */
  errorGlowBase: 8,
  errorGlowPulse: 4,
  /** Spinning ring extra radius beyond card half-size */
  spinRingPadding: 4,
  spinSpeed: 3,
  spinArc: Math.PI * 1.2,
  /** Error detail font size */
  errorFontSize: 9,
  /** Token cost font size */
  tokenFontSize: 9,
  /** Y offset for two-line card layout */
  twoLineOffset: 7,
} as const

// ─── Cost overlay drawing constants ─────────────────────────────────────────

export const COST_DRAW = {
  /** Minimum cost to display label */
  minDisplayCost: 0.0001,
  /** Cost pill Y offset above agent radius */
  pillYOffset: 22,
  pillPadding: 14,
  pillHeight: 20,
  pillRadius: 10,
  /** Mini bar height below cost pill */
  miniBarHeight: 3,
  miniBarRadius: 1.5,
  miniBarGap: 3,
  miniBarMaxExtra: 10,
  miniBarMax: 80,
} as const

export const COST_PANEL = {
  width: 240,
  /** X margin from right edge */
  xMargin: 16,
  /** Y position (below top bar) */
  yStart: 60,
  lineHeight: 20,
  headerHeight: 32,
  sectionGap: 8,
  maxRows: 5,
  borderRadius: 8,
  contentPadding: 10,
  barInset: 4,
  barRadius: 3,
} as const

// ─── Bubble drawing constants ───────────────────────────────────────────────

export const BUBBLE_DRAW = {
  thinking: { fontSize: 9.5, labelSize: 8, lineH: 14, padding: 10, headerH: 20 },
  normal: { fontSize: 11, labelSize: 8.5, lineH: 16, padding: 11, headerH: 22 },
  /** Triangle pointer offsets */
  triOffset: 5,
  triWidth: 6,
  /** Border radius for bubble rounded rectangles */
  borderRadius: 10,
} as const

// ─── Effect drawing constants ───────────────────────────────────────────────

export const SPAWN_FX = {
  ringStart: 10,
  ringExpand: 60,
  maxAlpha: 0.7,
  flashThreshold: 0.3,
  flashAlpha: 0.6,
  flashBaseRadius: 20,
  flashMinRadius: 5,
  particleCount: 8,
  particleSize: 1.5,
} as const

export const COMPLETE_FX = {
  ringStart: 20,
  ringExpand: 80,
  maxAlpha: 0.6,
  flashThreshold: 0.2,
  flashAlpha: 0.8,
  flashRadius: 30,
  lineWidthMax: 3,
  glowInner: 5,
  glowOuter: 10,
} as const

// ─── Particle drawing constants ─────────────────────────────────────────────

export const PARTICLE_DRAW = {
  glowRadius: 15,
  coreHighlightScale: 0.4,
  labelMinT: 0.2,
  labelMaxT: 0.8,
  labelFontSize: 10,
  labelYOffset: -14,
} as const

// ─── Performance overlay constants (debug only, ?perf or ?stress) ────────────

/** Cached once at module load — avoids parsing location.search every frame */
export const PERF_OVERLAY_ENABLED = typeof window !== 'undefined'
  && (() => {
    const p = new URLSearchParams(window.location.search)
    return p.has('perf') || p.has('stress')
  })()

export const PERF_OVERLAY = {
  x: 8,
  y: 8,
  width: 260,
  height: 140,
  padding: 8,
  lineHeight: 18,
  font: '12px monospace',
  maxFrameSamples: 120,
  fpsWarning: 30,
  fpsCaution: 50,
  updateIntervalMs: 1000,
  bgColor: 'rgba(0, 0, 0, 0.75)',
  fpsGoodColor: '#44ff44',
  fpsCautionColor: '#ffaa00',
  fpsWarningColor: '#ff4444',
  textColor: '#cccccc',
} as const

// ─── Hit detection constants ────────────────────────────────────────────────

export const HIT_DETECTION = {
  /** Estimated character width for tool card labels */
  toolCharWidth: 6.4,
  /** Estimated character width for bubble text */
  bubbleCharWidth: 6,
  /** Tool card expanded height (with result) */
  toolExpandedH: 42,
  toolCollapsedH: 30,
} as const

