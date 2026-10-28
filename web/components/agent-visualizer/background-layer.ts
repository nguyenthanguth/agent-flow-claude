import { DepthParticle } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'

/** World-space spacing of the background dot grid */
const GRID_SPACING = 32
/** Hide the grid when zoomed out so far that dots would turn into noise */
const GRID_MIN_SCREEN_SPACING = 14

// The old drifting "depth particles" are gone; these stay as no-ops so the
// canvas keeps a single background API.
export function createDepthParticles(_width: number, _height: number): DepthParticle[] {
  return []
}

export function updateDepthParticles(
  _particles: DepthParticle[],
  _deltaTime: number,
  _width: number,
  _height: number,
): void {}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  _particles: DepthParticle[],
  transform: { x: number; y: number; scale: number },
  showGrid: boolean,
  _time: number,
  activeAgentPos?: { x: number; y: number; color: string },
): void {
  ctx.fillStyle = COLORS.void
  ctx.fillRect(0, 0, width, height)

  // Very soft light around the agent that is currently working
  if (activeAgentPos) {
    const screenX = activeAgentPos.x * transform.scale + transform.x
    const screenY = activeAgentPos.y * transform.scale + transform.y
    const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, 360 * transform.scale)
    gradient.addColorStop(0, activeAgentPos.color + '0c')
    gradient.addColorStop(1, activeAgentPos.color + '00')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }

  if (showGrid) drawDotGrid(ctx, width, height, transform)
}

/** Dot grid that pans and zooms with the camera (drawn in screen space) */
function drawDotGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  transform: { x: number; y: number; scale: number },
): void {
  const step = GRID_SPACING * transform.scale
  if (step < GRID_MIN_SCREEN_SPACING) return

  const offsetX = ((transform.x % step) + step) % step
  const offsetY = ((transform.y % step) + step) % step
  const dot = Math.max(0.8, Math.min(1.4, transform.scale))

  ctx.fillStyle = COLORS.hexGrid
  ctx.beginPath()
  for (let x = offsetX; x < width; x += step) {
    for (let y = offsetY; y < height; y += step) {
      ctx.rect(x - dot / 2, y - dot / 2, dot, dot)
    }
  }
  ctx.fill()
}
