/**
 * Plan usage bar in the top bar: a meter per active plan limit (5-hour
 * session, weekly) with time to reset, and a popover listing every limit plus
 * this machine's usage in the same windows. Data: PlanUsageReport from the
 * server (server/src/usage-monitor.ts).
 */
import { memo, useEffect, useRef, useState } from 'react'
import { COLORS } from '@/lib/colors'
import { usageCost } from '@/lib/pricing'
import type { PlanLimit, PlanUsageReport, UsageTotals } from '@/lib/bridge-types'
import { useClickOutside } from '@/hooks/use-click-outside'

// ─── Formatting ─────────────────────────────────────────────────────────────

function formatRemaining(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ${minutes % 60} min`
  return `${Math.floor(hours / 24)} d ${hours % 24} h`
}

function formatAge(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  return minutes < 1 ? 'just now' : `${formatRemaining(ms)} ago`
}

function formatResetTime(at: number, now: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return at - now < 24 * 3_600_000 ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

/** Token counts here reach billions (cache reads), so go past "k" */
function compactTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

function limitColor(limit: PlanLimit): string {
  if (limit.severity === 'critical' || limit.percent >= 90) return COLORS.error
  if (limit.severity === 'warning' || limit.percent >= 70) return COLORS.waiting_permission
  return COLORS.complete
}

function windowTotals(byModel: Record<string, UsageTotals>) {
  let cost = 0
  let tokens = 0
  let output = 0
  for (const [model, u] of Object.entries(byModel)) {
    cost += usageCost(u as unknown as Record<string, unknown>, model)
    tokens += u.input + u.output + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h
    output += u.output
  }
  return { cost, tokens, output }
}

const STATUS_TEXT: Record<Exclude<PlanUsageReport['status'], 'ok'>, string> = {
  'signed-out': 'Not signed in to Claude Code — limits unavailable',
  expired: 'Claude Code login expired — run Claude Code to refresh it',
  unavailable: 'Plan limits are unavailable right now',
  disabled: 'Plan limits turned off (--no-plan-usage)',
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function Meter({ percent, color, width }: { percent: number; color: string; width: number }) {
  return (
    <span className="relative inline-block h-1.5 rounded-full overflow-hidden" style={{ width, background: COLORS.holoBg10 }}>
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: color }} />
    </span>
  )
}

function LimitRow({ limit, now }: { limit: PlanLimit; now: number }) {
  const color = limitColor(limit)
  return (
    <div className="py-2.5" style={{ opacity: limit.active ? 1 : 0.55 }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium" style={{ color: COLORS.textPrimary }}>{limit.label}</span>
        <span className="text-[13px] font-semibold tabular-nums" style={{ color }}>{Math.round(limit.percent)}%</span>
      </div>
      <div className="mt-1.5"><Meter percent={limit.percent} color={color} width={264} /></div>
      <div className="mt-1.5 text-[11px] tabular-nums" style={{ color: COLORS.textMuted }}>
        {limit.resetsAt
          ? `Resets in ${formatRemaining(limit.resetsAt - now)} · ${formatResetTime(limit.resetsAt, now)}`
          : 'Active'}
        {!limit.active && ' · not in effect'}
      </div>
    </div>
  )
}

// ─── Usage bar ──────────────────────────────────────────────────────────────

export const UsageBar = memo(function UsageBar({ report }: { report: PlanUsageReport | null }) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  // Keep countdowns current
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  if (!report) return null
  const active = report.limits.filter(l => l.active)
  // Without plan data, fall back to local usage in the last 5 hours
  const session = report.windows.find(w => w.group === 'session')
  const sessionLocal = session ? windowTotals(session.byModel) : null

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-3 h-9 px-3.5 rounded-xl"
        style={{
          background: open ? COLORS.cardBgSelected : COLORS.glassBg,
          border: `1px solid ${COLORS.glassBorder}`,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
        }}
        title="Plan usage"
      >
        {active.length > 0 ? active.map(limit => (
          <span key={limit.id} className="flex items-center gap-2 text-[12px] tabular-nums" style={{ color: COLORS.textDim }}>
            <span>{limit.group === 'session' ? '5h' : limit.group === 'weekly' ? 'Week' : limit.label}</span>
            <Meter percent={limit.percent} color={limitColor(limit)} width={44} />
            <span style={{ color: limitColor(limit) }}>{Math.round(limit.percent)}%</span>
            {limit.resetsAt && <span style={{ color: COLORS.textMuted }}>{formatRemaining(limit.resetsAt - now)}</span>}
          </span>
        )) : (
          <span className="text-[12px] tabular-nums" style={{ color: COLORS.textDim }}>
            Usage {sessionLocal && sessionLocal.tokens > 0 ? `5h $${sessionLocal.cost.toFixed(2)}` : '—'}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[300px] rounded-xl px-4 py-3"
          style={{ background: COLORS.panelBg, border: `1px solid ${COLORS.glassBorder}`, boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45)' }}
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: COLORS.textMuted }}>Plan usage</span>
            {report.plan && <span className="text-[11px] capitalize" style={{ color: COLORS.textMuted }}>{report.plan}</span>}
          </div>

          {report.limits.length > 0 ? (
            <div>
              {report.limits.map((limit, i) => (
                <div key={limit.id} style={i > 0 ? { borderTop: `1px solid ${COLORS.panelSeparator}` } : undefined}>
                  <LimitRow limit={limit} now={now} />
                </div>
              ))}
            </div>
          ) : (
            <div className="py-2.5 text-[12px]" style={{ color: COLORS.textDim }}>
              {report.status === 'ok' ? 'No limits reported for this plan' : STATUS_TEXT[report.status]}
            </div>
          )}

          {/* What this machine's transcripts show for the same windows (all models, all projects) */}
          <div className="mt-1 pt-2.5" style={{ borderTop: `1px solid ${COLORS.panelSeparator}` }}>
            <div className="text-[11px] font-semibold tracking-wider uppercase mb-1" style={{ color: COLORS.textMuted }}>On this machine</div>
            {report.windows.map(w => {
              const t = windowTotals(w.byModel)
              const aligned = report.limits.some(l => l.group === w.group && l.active && l.resetsAt)
              const label = w.group === 'session'
                ? (aligned ? 'This 5-hour session' : 'Last 5 hours')
                : (aligned ? 'This week' : 'Last 7 days')
              return (
                <div key={w.group} className="flex justify-between py-0.5 text-[12px] tabular-nums" style={{ color: COLORS.textDim }}>
                  <span>{label}</span>
                  <span title={`${compactTokens(t.output)} output tokens`}>
                    <span style={{ color: COLORS.costText }}>${t.cost.toFixed(2)}</span> · {compactTokens(t.tokens)} tokens
                  </span>
                </div>
              )
            })}
          </div>

          {report.error && report.limits.length > 0 && (
            <div className="mt-2 text-[11px]" style={{ color: COLORS.waiting_permission }}>
              Couldn't refresh ({report.error}) — showing values from {formatAge(now - report.fetchedAt)}, retrying later
            </div>
          )}

          <div className="mt-2 text-[10.5px] leading-snug" style={{ color: COLORS.textMuted }}>
            Limits from your Claude account, updated every 5 min{report.fetchedAt ? ` (last ${formatAge(now - report.fetchedAt)})` : ''}.
            Machine totals include cache reads and are priced at API list prices.
          </div>
        </div>
      )}
    </div>
  )
})
