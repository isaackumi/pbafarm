import { useMemo, useState } from 'react'
import { Sparkles, SlidersHorizontal } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { AlertRow, useAlertActions, useAlertLang } from '../components/FarmAlerts'
import { kg, rationText, rationWhy } from '../components/RationSuggestion'
import { EmptyState, GradientButton, IfPermitted, LoadingState, SummaryCard, Table, Tabs } from '../components/ui'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { usePermission } from '../hooks/usePermission'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { ALERT_CATEGORIES, ALERT_STATUSES, alertSummary, categoryCounts, filterAlerts } from '../lib/farmAlerts'
import { useLocale, useT } from '../lib/i18n/context'

/**
 * Alerts & insights (AI-001/AI-002, Paper 42): every early-warning alert in
 * the caller's sites with filters, plus today's suggested rations. Reads
 * farmAlerts.list and feedingPlans.rations; both require production.view.
 */
export default function AlertsPage() {
  const t = useT()
  const { locale } = useLocale()
  const { canUseApp } = useAuth()
  const { locationArgs, activeLocation } = useLocation()
  const locationId = locationArgs?.locationId
  const args = canUseApp ? (locationId ? { locationId } : {}) : 'skip'
  const rations = useOptionalQuery(api.feedingPlans.rations, args)
  const today = new Date().toLocaleDateString(locale || undefined, { weekday: 'long', day: 'numeric', month: 'short' })
  const eyebrow = [
    today,
    activeLocation?.name ?? t('alertsPage.allSites'),
    rations ? t('alertsPage.units', { count: rations.rows.length }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <ProtectedRoute permission="production.view">
      <Layout
        title={t('alertsPage.title')}
        eyebrow={eyebrow}
        actions={
          <>
            <IfPermitted permission="org.settings.manage">
              <GradientButton href="/company-settings" icon={SlidersHorizontal}>
                {t('alertsPage.alertRules')}
              </GradientButton>
            </IfPermitted>
            <IfPermitted permission="reports.view">
              <GradientButton href="/weekly-report" reverse icon={Sparkles}>
                {t('alertsPage.weeklyReport')}
              </GradientButton>
            </IfPermitted>
          </>
        }
      >
        <AlertsAndInsights args={args} rations={rations} />
      </Layout>
    </ProtectedRoute>
  )
}

function AlertsAndInsights({ args, rations }) {
  const t = useT()
  const { locale } = useLocale()
  const lang = useAlertLang()
  const canAct = usePermission('production.daily.record')
  const alerts = useOptionalQuery(api.farmAlerts.list, args === 'skip' ? 'skip' : { ...args, includeResolved: true }, [])
  const actions = useAlertActions()
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('live')
  // Read the clock once per alert list, not on every render.
  const summary = useMemo(() => alertSummary(alerts, Date.now()), [alerts])
  const counts = useMemo(() => categoryCounts(alerts, status), [alerts, status])
  const shown = useMemo(() => filterAlerts(alerts, { category, status }), [alerts, category, status])

  return (
    <div className="flex flex-col gap-[28px]">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard
          label={t('farmAlerts.severity.critical')}
          tone="alert"
          value={alerts === undefined ? '—' : summary.critical}
          sub={t('alertsPage.criticalSub')}
        />
        <SummaryCard
          label={t('farmAlerts.severity.warning')}
          tone="warn"
          value={alerts === undefined ? '—' : summary.warning}
          sub={t('alertsPage.warningSub')}
        />
        <SummaryCard
          label={t('alertsPage.resolved7d')}
          tone="good"
          value={alerts === undefined ? '—' : summary.resolved7d}
          sub={t('alertsPage.resolved7dSub')}
        />
        <SummaryCard
          label={t('alertsPage.feedToday')}
          value={rations ? `${kg(rations.totalKgPerDay)} kg` : '—'}
          sub={rations ? t('feedingPlan.coverage', { planned: rations.planned, total: rations.rows.length }) : null}
        />
      </div>

      <section aria-labelledby="alerts-list-title" className="flex flex-col rounded-[12px] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-center gap-5">
            <h2 id="alerts-list-title" className="text-base font-semibold leading-[18px] text-text">
              {t(`alertsPage.list.${status}`)}
            </h2>
            <Tabs
              label={t('alertsPage.statusFilter')}
              value={status}
              onChange={setStatus}
              tabs={ALERT_STATUSES.map((s) => ({ value: s, label: t(`alertsPage.status.${s}`), controls: 'alerts-list' }))}
            />
          </div>
          <Tabs
            variant="chip"
            label={t('alertsPage.categoryFilter')}
            value={category}
            onChange={setCategory}
            tabs={ALERT_CATEGORIES.map((c) => ({
              value: c,
              label: `${t(`alertsPage.category.${c}`)} ${counts[c]}`,
              controls: 'alerts-list',
            }))}
          />
        </div>
        <div id="alerts-list" role="tabpanel" aria-labelledby="alerts-list-title">
          {alerts === undefined ? (
            <LoadingState />
          ) : shown.length === 0 ? (
            <EmptyState title={t('alertsPage.emptyTitle')} description={t('alertsPage.emptyBody')} />
          ) : (
            <ul>
              {shown.map((a) => (
                <AlertRow key={a._id} alert={a} lang={lang} canAct={canAct} actions={actions} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <Table
        title={t('alertsPage.feedingTitle')}
        actions={<span className="text-xs leading-4 text-muted">{t('alertsPage.feedingSub')}</span>}
        rowKey={(r) => r.cageId}
        rows={rations?.rows ?? []}
        empty={rations === undefined ? t('ui.loading') : t('feedingPlan.noUnits')}
        columns={[
          { key: 'cageName', header: t('feedingPlan.col.unit'), width: 140, render: (r) => <span className="font-medium text-text">{r.cageName}</span> },
          { key: 'abwG', header: t('feedingPlan.col.abw'), width: 110, render: (r) => (r.abwG == null ? '—' : `${kg(r.abwG)} g`) },
          {
            key: 'suggested',
            header: t('alertsPage.suggested'),
            width: 130,
            render: (r) =>
              r.ration.ok ? <span className="font-semibold text-pearl-cyan">{kg(r.ration.kgPerDay)} kg</span> : <span className="text-faint">—</span>,
          },
          { key: 'how', header: t('feedingPlan.col.how'), render: (r) => <span className="text-muted">{rationText(t, r.ration)}</span> },
          { key: 'why', header: t('feedingPlan.why'), render: (r) => <span className="text-muted">{rationWhy(r, locale) || '—'}</span> },
        ]}
      />
    </div>
  )
}
