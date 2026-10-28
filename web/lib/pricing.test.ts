import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { usageCost, modelPricing } from './pricing'

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)

test('prices each usage kind at its own rate', () => {
  // Opus 5.5: $4 in, $20 out, $0.20 cache read, 1h writes at 2x input
  const cost = usageCost({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000 }, 'claude-opus-5-5')
  close(cost, 4 + 20 + 0.2 + 5 + 8)
})

test('picks the most specific model first', () => {
  assert.equal(modelPricing('claude-opus-5-5').input, 4)
  assert.equal(modelPricing('claude-opus-4-8').input, 5)
  assert.equal(modelPricing('claude-sonnet-5-5').input, 2)
  assert.equal(modelPricing('claude-sonnet-4-6').input, 3)
  assert.equal(modelPricing('claude-fable-5-1').cacheRead, 0.25)
  assert.equal(modelPricing('claude-haiku-4-5').input, 1)
  assert.equal(modelPricing('something-else').input, 2)
})

test('uses Haiku 5.5 long-context rates past 100K prompt tokens', () => {
  close(usageCost({ input: 50_000, output: 1_000_000 }, 'claude-haiku-5-5'), 0.005 + 0.5)
  close(usageCost({ input: 200_000, output: 1_000_000 }, 'claude-haiku-5-5'), 0.1 + 2.5)
})
