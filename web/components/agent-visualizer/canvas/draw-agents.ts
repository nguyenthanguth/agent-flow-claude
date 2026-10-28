import { Agent, NODE, ANIM } from '@/lib/agent-types'
import { COLORS, getStateColor, contextSegments } from '@/lib/colors'
import {
  AGENT_DRAW, CONTEXT_BAR, CONTEXT_RING, STATS_OVERLAY, FONT_SANS,
} from '@/lib/canvas-constants'
import { alphaHex, formatTokens } from '@/lib/utils'
import { truncateText, CLAUDE_SPARK_D } from './draw-misc'
import { getAgentGlowSprite } from './render-cache'

let _claudeSparkPath: Path2D | null = null
export function getClaudeSparkPath() {
  if (!_claudeSparkPath) _claudeSparkPath = new Path2D(CLAUDE_SPARK_D)
  return _claudeSparkPath
}

export function drawClaudeSpark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save()
  ctx.translate(cx, cy)
  const scale = (r * AGENT_DRAW.sparkScale) / AGENT_DRAW.sparkViewBox
  ctx.scale(scale, scale)
  ctx.translate(-AGENT_DRAW.sparkViewBox, -AGENT_DRAW.sparkViewBox + 1)
  ctx.fillStyle = color
  ctx.fill(getClaudeSparkPath())
  ctx.restore()
}

const isActive = (agent: Agent) => agent.state === 'thinking' || agent.state === 'tool_calling'

/** Token usage bar under sub-agents (and the main agent): a thin segmented bar plus a label */
export function drawContextComposition(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  radius: number,
) {
  const bd = agent.contextBreakdown
  const total = agent.tokensUsed
  if (total <= 0) return

  const barWidth = Math.max(CONTEXT_BAR.minWidth, radius * CONTEXT_BAR.widthMultiplier)
  const barHeight = CONTEXT_BAR.barHeight
  const barX = agent.x - barWidth / 2
  const barY = agent.y + radius + CONTEXT_BAR.yOffset

  // Track
  ctx.beginPath()
  ctx.roundRect(barX, barY, barWidth, barHeight, CONTEXT_BAR.borderRadius)
  ctx.fillStyle = COLORS.holoBg10
  ctx.fill()

  // Segments, clipped to the rounded track
  ctx.save()
  ctx.clip()
  let x = barX
  const maxWidth = barWidth * Math.min(1, total / agent.tokensMax)
  for (const seg of contextSegments(bd)) {
    if (seg.value <= 0) continue
    const segWidth = (seg.value / total) * maxWidth
    ctx.fillStyle = seg.color
    ctx.fillRect(x, barY, segWidth, barHeight)
    x += segWidth
  }
  ctx.restore()

  ctx.fillStyle = COLORS.textMuted
  ctx.font = `${CONTEXT_BAR.fontSize}px ${FONT_SANS}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(`${formatTokens(total)} / ${formatTokens(agent.tokensMax)}`, agent.x, barY + barHeight + CONTEXT_BAR.labelPadding)
}

/** Context-window ring around the main agent, segmented by what fills it */
export function drawContextRing(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  radius: number,
) {
  const total = agent.tokensUsed
  if (total <= 0) return

  const usage = total / agent.tokensMax
  const ringR = radius + CONTEXT_RING.ringOffset
  const startAngle = -Math.PI / 2

  ctx.beginPath()
  ctx.arc(agent.x, agent.y, ringR, 0, Math.PI * 2)
  ctx.strokeStyle = COLORS.holoBg10
  ctx.lineWidth = CONTEXT_RING.ringWidth
  ctx.stroke()

  ctx.lineCap = 'butt'
  let currentAngle = startAngle
  for (const seg of contextSegments(agent.contextBreakdown)) {
    if (seg.value <= 0) continue
    const sweep = (seg.value / agent.tokensMax) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(agent.x, agent.y, ringR, currentAngle, currentAngle + sweep)
    ctx.strokeStyle = seg.color
    ctx.lineWidth = CONTEXT_RING.ringWidth
    ctx.stroke()
    currentAngle += sweep
  }

  // Percentage label when usage is high
  if (usage > CONTEXT_RING.percentLabelThreshold) {
    ctx.font = `600 ${CONTEXT_BAR.fontSize}px ${FONT_SANS}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = usage > CONTEXT_RING.criticalThreshold ? COLORS.error
      : usage > CONTEXT_RING.warningThreshold ? COLORS.waiting_permission : COLORS.textDim
    ctx.fillText(`${Math.floor(usage * 100)}% context`, agent.x, agent.y - radius - CONTEXT_RING.percentYOffset)
  }
}

/** Soft halo behind agents that are working, hovered or selected */
function drawHalo(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, emphasis: boolean) {
  const alpha = emphasis ? 0.28 : isActive(agent) ? 0.2 : 0
  if (alpha === 0) return
  const glowR = r + AGENT_DRAW.glowPadding
  const sprite = getAgentGlowSprite(color, Math.round(r * 0.6), Math.ceil(glowR), alphaHex(alpha))
  ctx.drawImage(sprite, agent.x - Math.ceil(glowR), agent.y - Math.ceil(glowR))
}

function drawBody(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, emphasis: boolean, time: number) {
  // Drop shadow + solid disc
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = AGENT_DRAW.shadowBlur
  ctx.shadowOffsetY = AGENT_DRAW.shadowOffsetY
  ctx.beginPath()
  ctx.arc(agent.x, agent.y, r, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.nodeInterior
  ctx.fill()
  ctx.restore()

  // Faint state tint inside the disc
  ctx.beginPath()
  ctx.arc(agent.x, agent.y, r, 0, Math.PI * 2)
  ctx.fillStyle = color + '14'
  ctx.fill()

  // State ring
  ctx.beginPath()
  ctx.arc(agent.x, agent.y, r, 0, Math.PI * 2)
  ctx.strokeStyle = agent.state === 'complete' ? color + '90' : color
  ctx.lineWidth = emphasis ? 2.5 : 2
  if (agent.state === 'waiting_permission') {
    ctx.setLineDash([6, 4])
    ctx.lineDashOffset = -time * AGENT_DRAW.waitingDashSpeed
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.lineDashOffset = 0

  // Working indicator: a short arc sweeping around the ring
  if (isActive(agent)) {
    const start = time * 2.4
    ctx.beginPath()
    ctx.arc(agent.x, agent.y, r + 5, start, start + Math.PI * 0.6)
    ctx.strokeStyle = color + 'b0'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.lineCap = 'butt'
  }
}

function drawCenterIcon(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string) {
  if (agent.isMain) {
    drawClaudeSpark(ctx, agent.x, agent.y, r, COLORS.holoBase)
    return
  }
  // Sub-agents show the first letter of their name
  const initial = (agent.name.trim()[0] || '?').toUpperCase()
  ctx.fillStyle = agent.state === 'complete' ? COLORS.textMuted : color
  ctx.font = `600 ${Math.round(r * 0.8)}px ${FONT_SANS}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initial, agent.x, agent.y + 1)
}

function drawAgentLabel(ctx: CanvasRenderingContext2D, agent: Agent, r: number, emphasis: boolean) {
  ctx.font = `${agent.isMain ? 600 : 500} ${agent.isMain ? 13 : 12}px ${FONT_SANS}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const label = truncateText(ctx, agent.isMain ? 'Claude' : agent.name, r * AGENT_DRAW.labelWidthMultiplier)
  ctx.fillStyle = emphasis ? COLORS.textPrimary : agent.state === 'complete' ? COLORS.textMuted : COLORS.textPrimary
  ctx.fillText(label, agent.x, agent.y + r + AGENT_DRAW.labelYOffset)
}

function drawStatsOverlay(ctx: CanvasRenderingContext2D, agent: Agent, r: number) {
  const sy = agent.y - r - STATS_OVERLAY.yOffset
  ctx.beginPath()
  ctx.roundRect(agent.x - STATS_OVERLAY.boxWidth / 2, sy, STATS_OVERLAY.boxWidth, STATS_OVERLAY.boxHeight, STATS_OVERLAY.borderRadius)
  ctx.fillStyle = COLORS.cardBg
  ctx.fill()
  ctx.strokeStyle = COLORS.glassBorder
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = COLORS.textDim
  ctx.font = `${STATS_OVERLAY.fontSize}px ${FONT_SANS}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(`${agent.toolCalls} tools · ${agent.timeAlive.toFixed(1)}s`, agent.x, sy + STATS_OVERLAY.textPaddingY)
}

export function drawAgents(
  ctx: CanvasRenderingContext2D,
  agents: Map<string, Agent>,
  selectedAgentId: string | null,
  hoveredAgentId: string | null,
  showStats: boolean,
  time: number,
) {
  for (const [id, agent] of agents) {
    const radius = agent.isMain ? NODE.radiusMain : NODE.radiusSub
    const color = getStateColor(agent.state)
    const emphasis = id === hoveredAgentId || id === selectedAgentId

    // Gentle breathing while thinking; everything else holds still
    const breathe = agent.state === 'thinking'
      ? Math.sin(time * ANIM.breathe.thinkingSpeed) * ANIM.breathe.thinkingAmp * 0.6 + 1
      : 1
    const r = radius * breathe * agent.scale

    ctx.save()
    ctx.globalAlpha = agent.opacity

    drawHalo(ctx, agent, r, color, emphasis)
    drawBody(ctx, agent, r, color, emphasis, time)
    drawCenterIcon(ctx, agent, r, color)
    drawAgentLabel(ctx, agent, r, emphasis)

    if (agent.isMain) drawContextRing(ctx, agent, r)
    if (agent.state !== 'complete') drawContextComposition(ctx, agent, r)
    if (showStats && agent.state !== 'complete') drawStatsOverlay(ctx, agent, r)

    ctx.restore()
  }
}
