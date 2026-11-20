import { useEffect, useMemo, useState } from 'react'
import { useAction } from 'convex/react'
import { PenLine, RefreshCw } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { EmptyState, GradientButton, LoadingState, Tabs } from '../components/ui'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { errorMessage } from '../lib/errorMessage'
import { useLocale, useT } from '../lib/i18n/context'
import { COMPANY_SCOPE, defaultScope, fcrTrend, isoWeek, reportScopes, reportsForScope, showCosts, weekRange } from '../lib/weeklyReportView'

/**
 * Weekly farm report (AI-003, Paper 45): per site and company-wide, written
 * every Monday for the week before. Numbers come from the records; the
 * assistant only phrases them. Costs appear only for members who may see
 * finance: the server sends financeText to them alone.
 */
export default function WeeklyReportPage() {
  const t = useT()
  const { locale } = useLocale()
  const lang = String(locale || 'en').startsWith('fr') ? 'fr' : 'en'
  const { canUseApp } = useAuth()
  const { locationArgs } = useLocation()
  const activeLocationId = locationArgs?.locationId
  const reports = useOptionalQuery(api.aiReports.list, canUseApp ? { lang } : 'skip', [])
  const scopes = useMemo(() => reportScopes(reports), [reports])
  const [scope, setScope] = useState(null)
  const [week, setWeek] = useState(0)
  const current = scope && scopes.some((s) => s.value === scope) ? scope : defaultScope(scopes, activeLocationId)
  const weeks = useMemo(() => reportsForScope(reports, current), [reports, current])
  const weekIndex = Math.min(week, Math.max(0, weeks.length - 1))
  const report = weeks[weekIndex] ?? null
  useEffect(() => setWeek(0), [current])

  const generate = useAction(api.aiReports.generateNow)
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (target) => {
    setBusy(true)
    try {
      const r = await generate({ ...(target && target !== COMPANY_SCOPE ? { locationId: target } : {}), lang })
      showToast('success', r.source === 'llm' ? t('weeklyReport.doneAi') : t('weeklyReport.doneTemplate'))
      setWeek(0)
    } catch (err) {
      showToast('error', errorMessage(err, t('weeklyReport.failed')))
    } finally {
      setBusy(false)
    }
  }

  const scopeLabel = (value) =>
    value === COMPANY_SCOPE ? t('weeklyReport.wholeCompany') : (scopes.find((s) => s.value === value)?.label ?? '')
  const eyebrowScope = current === COMPANY_SCOPE ? t('weeklyReport.wholeCompany') : t('weeklyReport.siteScope', { site: scopeLabel(current) })
  const eyebrow = report
    ? t('weeklyReport.eyebrow', {
        week: isoWeek(report.weekEnd) ?? '—',
        range: weekRange(report.figures?.weekStart || report.weekEnd, report.weekEnd, lang === 'fr' ? 'fr-FR' : 'en-GB'),
        scope: eyebrowScope,
      })
    : t('weeklyReport.intro')

  return (
    <ProtectedRoute permission="reports.view">
      <Layout
        title={t('weeklyReport.title')}
        eyebrow={eyebrow}
        actions={
          report ? (
            <GradientButton variant="lime" icon={PenLine} disabled={busy} onClick={() => run(current)}>
              {busy ? t('weeklyReport.regenerating') : t('weeklyReport.regenerate')}
            </GradientButton>
          ) : null
        }
      >
        {reports === undefined ? (
          <LoadingState />
        ) : !report ? (
          <div className="rounded-[12px] border border-line bg-surface">
            <EmptyState
              title={t('weeklyReport.emptyTitle')}
              description={t('weeklyReport.emptyBody')}
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  {activeLocationId ? (
                    <GradientButton size="sm" icon={RefreshCw} disabled={busy} onClick={() => run(activeLocationId)}>
                      {t('weeklyReport.generateSiteShort')}
                    </GradientButton>
                  ) : null}
                  <GradientButton size="sm" reverse icon={RefreshCw} disabled={busy} onClick={() => run(COMPANY_SCOPE)}>
                    {t('weeklyReport.generateCompany')}
                  </GradientButton>
                </div>
              }
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="flex min-w-0 grow-[1.6] basis-0 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Tabs
                  variant="chip"
                  label={t('weeklyReport.scope')}
                  value={current}
                  onChange={setScope}
                  tabs={scopes.map((s) => ({ value: s.value, label: scopeLabel(s.value), controls: 'weekly-report-panel' }))}
                />
                <div className="grow" />
                <WeekPicker weeks={weeks} index={weekIndex} onChange={setWeek} />
              </div>
              <article
                id="weekly-report-panel"
                role="tabpanel"
                aria-label={scopeLabel(current)}
                className="flex flex-col gap-[14px] rounded-[12px] border border-line bg-surface p-6"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-pill bg-[color-mix(in_oklab,var(--cyan)_12%,transparent)] px-2 py-[3px] text-[11px] leading-[14px] text-sky-ink">
                    {report.source === 'llm' ? t('weeklyReport.aiSummary') : t('weeklyReport.sourceTemplate')}
                  </span>
                  <span className="text-xs leading-4 text-faint">
                    {t('weeklyReport.writtenFrom', {
                      date: new Date(report.createdAt).toLocaleString(locale || undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                    })}
                  </span>
                </div>
                <div className="whitespace-pre-line text-base leading-6 text-text">{report.text}</div>
              </article>
            </div>
            <div className="flex min-w-0 grow basis-0 flex-col gap-4">
              <KeyFigures figures={report.figures} lang={lang} />
              {showCosts(report) ? (
                <section aria-labelledby="weekly-costs" className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-5">
                  <div className="flex items-center justify-between">
                    <h2 id="weekly-costs" className="text-[15px] font-semibold leading-[18px] text-text">
                      {t('weeklyReport.costs')}
                    </h2>
                    <span className="text-[11px] leading-[14px] text-faint">{t('weeklyReport.financeOnly')}</span>
                  </div>
                  <p className="whitespace-pre-line text-sm leading-5 text-muted">{report.financeText}</p>
                </section>
              ) : null}
            </div>
          </div>
        )}
      </Layout>
    </ProtectedRoute>
  )
}

function WeekPicker({ weeks, index, onChange }) {
  const t = useT()
  const older = weeks[index + 1]
  const newer = index > 0 ? weeks[index - 1] : null
  const cls =
    'rounded-pill px-3 py-[6px] text-xs leading-4 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
  if (!older && !newer) return null
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('weeklyReport.weekPicker')}>
      {older ? (
        <button type="button" className={cls} title={t('weeklyReport.weekEnding', { date: older.weekEnd })} onClick={() => onChange(index + 1)}>
          ‹ {t('weeklyReport.weekNumber', { week: isoWeek(older.weekEnd) ?? older.weekEnd })}
        </button>
      ) : null}
      {newer ? (
        <button type="button" className={cls} title={t('weeklyReport.weekEnding', { date: newer.weekEnd })} onClick={() => onChange(index - 1)}>
          {t('weeklyReport.weekNumber', { week: isoWeek(newer.weekEnd) ?? newer.weekEnd })} ›
        </button>
      ) : null}
    </div>
  )
}

function KeyFigures({ figures: f, lang }) {
  const t = useT()
  if (!f) return null
  const n = (x, dp = 1) =>
    x == null ? '—' : Number(x).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: dp })
  const trend = fcrTrend(f)
  const rows = [
    [t('weeklyReport.fig.feed'), `${n(f.feedKg)} kg`],
    [t('weeklyReport.fig.gain'), `${n(f.gainKg)} kg`],
    [
      t('weeklyReport.fig.fcr'),
      f.fcr == null
        ? '—'
        : trend
          ? t(`weeklyReport.fig.fcrTrend.${trend.direction}`, { fcr: n(f.fcr, 2), delta: n(Math.abs(trend.delta), 2) })
          : n(f.fcr, 2),
      trend?.direction === 'better' ? 'text-good' : trend?.direction === 'worse' ? 'text-warn' : 'text-text',
    ],
    [t('weeklyReport.fig.mortality'), `${f.mortalityPct == null ? '—' : `${n(f.mortalityPct, 2)}%`} · ${n(f.mortality, 0)}`],
    [t('weeklyReport.fig.units'), n(f.units, 0)],
    [t('weeklyReport.fig.survival'), f.survivalPct == null ? '—' : `${n(f.survivalPct)}%`],
    [t('weeklyReport.fig.feedVsSuggested'), f.feedVsSuggestedPct == null ? '—' : `${n(f.feedVsSuggestedPct, 0)}%`],
    [t('weeklyReport.fig.alerts'), `${n(f.alertsRaised, 0)} / ${n(f.alertsOpen, 0)}`],
  ]
  return (
    <section aria-labelledby="weekly-figures" className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-5">
      <h2 id="weekly-figures" className="text-[15px] font-semibold leading-[18px] text-text">
        {t('weeklyReport.keyFigures')}
      </h2>
      <dl className="flex flex-col gap-3">
        {rows.map(([label, value, tone]) => (
          <div key={label} className="flex justify-between gap-3 text-[13px] leading-4">
            <dt className="text-muted">{label}</dt>
            <dd className={`text-right tabular-nums ${tone || 'text-text'}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
