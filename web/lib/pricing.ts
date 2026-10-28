/**
 * API-priced cost of Claude requests, from the `usage` the server forwards
 * for each response (see server/src/core/usage.ts). This is what the same
 * traffic would cost at list prices — a reference point even on a plan.
 */
import { MODEL_PRICING, DEFAULT_PRICING, type ModelPricing } from './canvas-constants'

export function modelPricing(model?: string): ModelPricing {
  if (model) {
    const id = model.toLowerCase()
    for (const { pattern, price } of MODEL_PRICING) {
      if (pattern.test(id)) return price
    }
  }
  return DEFAULT_PRICING
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/** Cost in $ of one request's usage: { input, output, cacheRead, cacheWrite5m, cacheWrite1h } */
export function usageCost(usage: Record<string, unknown>, model?: string): number {
  const p = modelPricing(model)
  const input = n(usage.input)
  const cacheRead = n(usage.cacheRead)
  const write5m = n(usage.cacheWrite5m)
  const write1h = n(usage.cacheWrite1h)
  const prompt = input + cacheRead + write5m + write1h
  const long = p.longContext && prompt > p.longContext.threshold ? p.longContext : null
  const inRate = long ? long.input : p.input
  const outRate = long ? long.output : p.output
  const readRate = long ? p.cacheRead * (long.input / p.input) : p.cacheRead
  return (
    input * inRate +
    write5m * inRate * 1.25 +
    write1h * inRate * 2 +
    cacheRead * readRate +
    n(usage.output) * outRate
  ) / 1_000_000
}

/** $ per million input tokens — for estimating what a tool result adds */
export function inputRate(model?: string): number {
  return modelPricing(model).input
}
