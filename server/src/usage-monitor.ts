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
/** Limits older than this are not shown, whether from disk or kept after failed refreshes */
const MAX_LIMITS_AGE_MS = 6 * HOUR

export interface UsageMonitorOptions {
  /** Ask Anthropic for the plan's limits (needs Claude Code's login) */
  fetchPlan: boolean
  onUpdate: (report: PlanUsageReport) => void
  /** Overrides for tests */
  fetcher?: () => Promise<PlanUsage>
  cachePath?: string
  index?: LocalUsageIndex
}

function readCache(cachePath: string): PlanUsage | null {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as PlanUsage
    if (cached.status !== 'ok' || !Array.isArray(cached.limits) || Date.now() - cached.fetchedAt > MAX_LIMITS_AGE_MS) return null
    return cached
  } catch {
    return null
  }
}

function writeCache(cachePath: string, plan: PlanUsage): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    const { status, plan: name, limits, fetchedAt } = plan
    fs.writeFileSync(cachePath, JSON.stringify({ status, plan: name, limits, fetchedAt }))
  } catch { /* cache is best effort */ }
}

export class UsageMonitor {
  private index: LocalUsageIndex
  private cachePath: string
  private fetcher: () => Promise<PlanUsage>
  private plan: PlanUsage
  private timer: NodeJS.Timeout | null = null
  private disposed = false
  latest: PlanUsageReport | null = null

  constructor(private options: UsageMonitorOptions) {
    this.index = options.index ?? new LocalUsageIndex()
    this.cachePath = options.cachePath ?? CACHE_PATH
    this.fetcher = options.fetcher ?? fetchPlanUsage
    this.plan = options.fetchPlan
      ? readCache(this.cachePath) ?? { status: 'unavailable', limits: [], fetchedAt: 0 }
      : { status: 'disabled', limits: [], fetchedAt: 0 }
  }

  start(): void {
    void this.tick()
  }

  /** One poll: publish, fetch limits, scan transcripts, publish. Schedules the next. */
  async tick(): Promise<void> {
    if (this.disposed) return
    let delay = POLL_MS
    try {
      // Show what we have (e.g. cached limits) before the network round trip
      if (!this.latest) this.publish()
      if (this.options.fetchPlan) {
        const next = await this.fetcher()
        if (next.error) {
          log.warn(`Plan usage unavailable (${next.error})`)
          delay = BACKOFF_MS
        }
        if (next.status === 'ok') writeCache(this.cachePath, next)
        // A transient failure (rate limit, network) keeps the last good limits
        // on screen; a successful answer without limits replaces them.
        this.plan = next.error && this.plan.limits.length > 0
          ? { ...this.plan, error: next.error }
          : next
      }
      // Publish limits now, then again once the local scan is done
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
    const tooOld = this.plan.limits.length > 0 && now - this.plan.fetchedAt > MAX_LIMITS_AGE_MS
    // Drop limits whose window already reset (their percentage is stale), and
    // everything once the last successful fetch is too old to trust
    const limits = tooOld ? [] : this.plan.limits.filter(l => !l.resetsAt || l.resetsAt > now)
    const plan: PlanUsage = tooOld ? { ...this.plan, status: 'unavailable', limits: [] } : this.plan
    const windows = Object.entries(WINDOW_MS).map(([group, length]) => {
      // Align with the limit actually in effect; otherwise a rolling window
      const limit = limits.find(l => l.group === group && l.active && l.resetsAt)
      const since = limit?.resetsAt ? limit.resetsAt - length : now - length
      return { group, since, byModel: this.index.ready ? this.index.totalsSince(since) : {} }
    })
    this.latest = { ...plan, limits, windows }
    this.options.onUpdate(this.latest)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
  }
}
