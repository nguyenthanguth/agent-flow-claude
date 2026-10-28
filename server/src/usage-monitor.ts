/**
 * Polls plan limits and the local usage index, and publishes one report for
 * the UI's usage bar. Local totals are aligned to the plan's own windows: the
 * 5-hour session started 5 h before it resets, the week 7 days before.
 *
 * The limits endpoint rate-limits hard (and Claude Code itself uses it), so
 * polling is gentle, and the last good answer is kept on disk: a restart or
 * a 429 shows it, marked with its age, instead of an empty bar.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { PlanUsageReport } from './core/protocol'
import { fetchPlanUsage, PlanUsage } from './plan-usage'
import { LocalUsageIndex } from './local-usage'
import { createLogger } from './core/logger'

const log = createLogger('UsageMonitor')

const POLL_MS = 5 * 60 * 1000
/** After a rate limit or server error, wait longer before asking again */
const BACKOFF_MS = 15 * 60 * 1000
const HOUR = 60 * 60 * 1000
const WINDOW_MS: Record<string, number> = { session: 5 * HOUR, weekly: 7 * 24 * HOUR }
/** Last good limits (percentages, reset times, plan name — no credentials) */
const CACHE_PATH = path.join(os.homedir(), '.agent-flow-claude', 'plan-usage.json')
/** Older cached limits are not worth showing */
const CACHE_MAX_AGE_MS = 6 * HOUR

export interface UsageMonitorOptions {
  /** Ask Anthropic for the plan's limits (needs Claude Code's login) */
  fetchPlan: boolean
  onUpdate: (report: PlanUsageReport) => void
}

function readCache(): PlanUsage | null {
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) as PlanUsage
    if (cached.status !== 'ok' || !Array.isArray(cached.limits) || Date.now() - cached.fetchedAt > CACHE_MAX_AGE_MS) return null
    return cached
  } catch {
    return null
  }
}

function writeCache(plan: PlanUsage): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
    const { status, plan: name, limits, fetchedAt } = plan
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ status, plan: name, limits, fetchedAt }))
  } catch { /* cache is best effort */ }
}

export class UsageMonitor {
  private index = new LocalUsageIndex()
  private plan: PlanUsage
  private timer: NodeJS.Timeout | null = null
  private disposed = false
  latest: PlanUsageReport | null = null

  constructor(private options: UsageMonitorOptions) {
    this.plan = options.fetchPlan
      ? readCache() ?? { status: 'unavailable', limits: [], fetchedAt: 0 }
      : { status: 'disabled', limits: [], fetchedAt: 0 }
  }

  start(): void {
    void this.tick()
  }

  private async tick(): Promise<void> {
    if (this.disposed) return
    let delay = POLL_MS
    try {
      if (this.options.fetchPlan) {
        const next = await fetchPlanUsage()
        if (next.error) {
          log.warn(`Plan usage unavailable (${next.error})`)
          delay = BACKOFF_MS
        }
        if (next.status === 'ok') writeCache(next)
        // A transient failure (rate limit, network) keeps the last good limits on screen
        this.plan = next.status === 'unavailable' && this.plan.limits.length > 0
          ? { ...this.plan, error: next.error ?? 'unavailable' }
          : next
      }
      // Publish limits right away, then again once the local scan is done
      if (!this.index.ready) this.publish()
      await this.index.refresh()
      this.publish()
    } catch (err) {
      log.warn('Usage refresh failed:', err)
    }
    if (!this.disposed) this.timer = setTimeout(() => void this.tick(), delay)
  }

  private publish(): void {
    const now = Date.now()
    // Drop limits whose window has already reset — their percentage is stale
    const limits = this.plan.limits.filter(l => !l.resetsAt || l.resetsAt > now)
    const windows = Object.entries(WINDOW_MS).map(([group, length]) => {
      const limit = limits.find(l => l.group === group && l.resetsAt)
      const since = limit?.resetsAt ? limit.resetsAt - length : now - length
      return { group, since, byModel: this.index.ready ? this.index.totalsSince(since) : {} }
    })
    this.latest = { ...this.plan, limits, windows }
    this.options.onUpdate(this.latest)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
  }
}
