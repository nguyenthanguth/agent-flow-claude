import { ToolCallNode } from '@/lib/agent-types'
import { COLORS, withAlpha } from '@/lib/colors'
import { TOOL_MAX_CARD_W, TOOL_DRAW, FONT_SANS, FONT_MONO } from '@/lib/canvas-constants'
import { truncateText } from './draw-misc'
import { measureTextCached } from './render-cache'

const NAME_FONT = `600 ${TOOL_DRAW.fontSize}px ${FONT_SANS}`
const ARGS_FONT = `${TOOL_DRAW.fontSize}px ${FONT_MONO}`
const DETAIL_FONT = `${TOOL_DRAW.tokenFontSize}px ${FONT_SANS}`

/** Card width for a tool call — shared with hit detection so clicks match what's drawn */
export function toolCardWidth(ctx: CanvasRenderingContext2D, tool: ToolCallNode): number {
  ctx.font = NAME_FONT
  const nameW = measureTextCached(ctx, tool.toolName)
  ctx.font = ARGS_FONT
  const argsW = tool.args ? measureTextCached(ctx, tool.args) + 6 : 0
  const chrome = TOOL_DRAW.padX * 2 + TOOL_DRAW.dotSpace
  return Math.max(72, Math.min(nameW + argsW + chrome, TOOL_MAX_CARD_W))
}

export function drawToolCalls(
  ctx: CanvasRenderingContext2D,
  toolCalls: Map<string, ToolCallNode>,
  time: number,
  selectedToolCallId?: string | null,
) {
  for (const [id, tool] of toolCalls) {
    const isRunning = tool.state === 'running'
    const isError = tool.state === 'error'
    const isSelected = id === selectedToolCallId
    const accent = isError ? COLORS.error : isRunning ? COLORS.tool : COLORS.return

    ctx.save()
    ctx.globalAlpha = tool.opacity

    const cardW = toolCardWidth(ctx, tool)
    const twoLines = !isRunning && (!!tool.tokenCost || isError)
    const cardH = twoLines ? TOOL_DRAW.expandedHeight : TOOL_DRAW.collapsedHeight
    const cardX = tool.x - cardW / 2
    const cardY = tool.y - cardH / 2

    // Card
    ctx.beginPath()
    ctx.roundRect(cardX, cardY, cardW, cardH, TOOL_DRAW.borderRadius)
    ctx.fillStyle = isError
      ? withAlpha(COLORS.toolCardErrorBase, 0.96)
      : withAlpha(COLORS.toolCardBase, 0.96)
    ctx.fill()
    if (isSelected) {
      ctx.fillStyle = withAlpha(COLORS.toolCardSelectedBase, 0.12)
      ctx.fill()
    }
    ctx.strokeStyle = isSelected ? COLORS.holoBase + 'cc' : accent + (isRunning ? '80' : '45')
    ctx.lineWidth = isSelected ? 1.5 : 1
    ctx.stroke()

    // Status dot — pulses while the tool runs
    const lineY = twoLines ? tool.y - TOOL_DRAW.twoLineOffset : tool.y
    const dotX = cardX + TOOL_DRAW.padX + TOOL_DRAW.dotRadius
    if (isRunning) {
      const pulse = (Math.sin(time * 5) + 1) / 2
      ctx.beginPath()
      ctx.arc(dotX, lineY, TOOL_DRAW.dotRadius + 2 + pulse * 2, 0, Math.PI * 2)
      ctx.fillStyle = accent + '30'
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(dotX, lineY, TOOL_DRAW.dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = accent
    ctx.fill()

    // Label: tool name (sans) + arguments (mono)
    const textX = cardX + TOOL_DRAW.padX + TOOL_DRAW.dotSpace
    const textMaxW = cardX + cardW - TOOL_DRAW.padX - textX
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = NAME_FONT
    const name = truncateText(ctx, tool.toolName, textMaxW)
    ctx.fillStyle = COLORS.textPrimary
    ctx.fillText(name, textX, lineY)
    const nameW = measureTextCached(ctx, name)
    if (tool.args && nameW + 12 < textMaxW) {
      ctx.font = ARGS_FONT
      ctx.fillStyle = COLORS.textDim
      ctx.fillText(truncateText(ctx, tool.args, textMaxW - nameW - 6), textX + nameW + 6, lineY)
    }

    // Second line: failure reason or token cost
    if (twoLines) {
      ctx.font = DETAIL_FONT
      const detailY = tool.y + TOOL_DRAW.twoLineOffset + 1
      if (isError) {
        ctx.fillStyle = COLORS.error
        ctx.fillText(truncateText(ctx, tool.errorMessage || tool.result || 'Failed', textMaxW), textX, detailY)
      } else {
        ctx.fillStyle = COLORS.textMuted
        ctx.fillText(`${(tool.tokenCost ?? 0).toLocaleString()} tokens`, textX, detailY)
      }
    }

    ctx.restore()
  }
}
