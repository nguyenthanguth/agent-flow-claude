/**
 * Plan usage limits (the 5-hour session window, weekly limits) — the numbers
 * Claude Code's /usage shows.
 *
 * Fetched the way Claude Code does: GET api.anthropic.com/api/oauth/usage
 * with the OAuth access token Claude Code keeps in ~/.claude/.credentials.json.
 * The token is read fresh on every poll, never stored, never refreshed (Claude
 * Code does that), and sent only to api.anthropic.com. Polled every 5 minutes. The endpoint is
 * internal and undocumented, so every field is optional and any failure just
 * reports the bar as unavailable.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { PlanLimit, PlanUsageReport } from './core/protocol'

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json')
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const REQUEST_TIMEOUT_MS = 10_000

export type PlanUsage = Omit<PlanUsageReport, 'windows'>

interface OAuthCredentials { accessToken?: string; expiresAt?: number; subscriptionType?: string }

function readCredentials(): OAuthCredentials | null {
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8')) as { claudeAiOauth?: OAuthCredentials }
    return raw.claudeAiOauth ?? null
  } catch {
    return null
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const toTime = (v: unknown): number | undefined => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : undefined
}

function limitLabel(kind: string, group: string, scope: unknown): string {
  const model = isRecord(scope) && isRecord(scope.model) && typeof scope.model.display_name === 'string'
    ? scope.model.display_name : null
  if (group === 'session') return '5-hour session'
  if (group === 'weekly') return model ? `Week · ${model}` : 'Week'
  return model ? `${kind} · ${model}` : kind.replace(/_/g, ' ')
}

/** Turn the endpoint's response into the limits the UI shows */
export function parsePlanUsage(body: unknown): PlanLimit[] {
  if (!isRecord(body)) return []
  const limits: PlanLimit[] = []

  // Preferred: the generic `limits` list (what /usage renders)
  if (Array.isArray(body.limits)) {
    for (const l of body.limits) {
      if (!isRecord(l) || typeof l.percent !== 'number') continue
      const kind = typeof l.kind === 'string' ? l.kind : 'limit'
      const group = typeof l.group === 'string' ? l.group : kind
      const label = limitLabel(kind, group, l.scope)
      limits.push({
        id: `${kind}:${label}`,
        group,
        label,
        percent: l.percent,
        severity: typeof l.severity === 'string' ? l.severity : 'normal',
        resetsAt: toTime(l.resets_at),
        active: l.is_active !== false,
      })
    }
    if (limits.length > 0) return limits
  }

  // Fallback: the older five_hour / seven_day fields (utilization in %)
  const legacy: Array<[string, string, string]> = [['five_hour', 'session', '5-hour session'], ['seven_day', 'weekly', 'Week']]
  for (const [key, group, label] of legacy) {
    const w = body[key]
    if (!isRecord(w) || typeof w.utilization !== 'number') continue
    limits.push({ id: key, group, label, percent: w.utilization, severity: 'normal', resetsAt: toTime(w.resets_at), active: true })
  }
  return limits
}

export async function fetchPlanUsage(): Promise<PlanUsage> {
  const fetchedAt = Date.now()
  const creds = readCredentials()
  if (!creds?.accessToken) return { status: 'signed-out', limits: [], fetchedAt }
  if (creds.expiresAt && creds.expiresAt < fetchedAt) {
    // Claude Code refreshes the token next time it runs; we pick it up then
    return { status: 'expired', plan: creds.subscriptionType, limits: [], fetchedAt }
  }
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (res.status === 401) return { status: 'expired', plan: creds.subscriptionType, limits: [], fetchedAt }
    if (!res.ok) return { status: 'unavailable', plan: creds.subscriptionType, limits: [], fetchedAt, error: `HTTP ${res.status}` }
    const limits = parsePlanUsage(await res.json())
    return { status: limits.length ? 'ok' : 'unavailable', plan: creds.subscriptionType, limits, fetchedAt }
  } catch (err) {
    return { status: 'unavailable', plan: creds.subscriptionType, limits: [], fetchedAt, error: err instanceof Error ? err.name : 'error' }
  }
}
