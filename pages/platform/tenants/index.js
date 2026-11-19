import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import PlatformLayout, { CONSOLE_KPI, CONSOLE_TABLE } from '../../../components/platform/PlatformLayout'
import { GhostButton, KpiStrip, LoadingState, Select, StatusDot, Table } from '../../../components/ui'
import { formatDate, formatMinor } from '../../../lib/billingFormat'
import { useT } from '../../../lib/i18n/context'
import { TENANT_TABS, planMix, tenantStatus, tenantTabCounts, tenantTabFilter, upcomingRenewals } from '../../../lib/platformConsole'

const DOT_TONE = { good: 'good', warn: 'warn', alert: 'alert', cyan: 'neutral', neutral: 'neutral' }
const TEXT_TONE = { warn: 'text-warn', alert: 'text-alert', cyan: 'text-pearl-cyan' }
const MIX_COLORS = ['bg-pearl-cyan', 'bg-pearl-pink', 'bg-text', 'bg-faint', 'bg-warn', 'bg-good']

function healthTone(score) {
  if (score >= 70) return 'text-good'
  if (score >= 40) return 'text-warn'
  return 'text-alert'
}

function moneyList(list) {
  if (!list || list.length === 0) return '—'
  return list.map((m) => formatMinor(m.amountMinor, m.currency)).join(' · ')
}

function Kpis({ k }) {
  const t = useT()
  if (!k) return <LoadingState label={t('platform.tenants.loadingKpis')} />
  return (
    <KpiStrip
      className={CONSOLE_KPI}
      items={[
        { key: 'mrr', label: t('platform.tenants.kpi.mrr'), value: moneyList(k.mrr) },
        {
          key: 'active',
          label: t('platform.tenants.kpi.activeFarms'),
          value: k.tenants.active,
          suffix: t('platform.tenants.kpi.onTrial', { count: k.subscriptions.trialing }),
        },
        {
          key: 'overdue',
          label: t('platform.tenants.kpi.pastDue'),
          value: k.overdue.count,
          valueTone: k.overdue.count ? 'warn' : undefined,
          suffix: k.overdue.count ? t('platform.tenants.kpi.open', { amount: moneyList(k.overdue.amounts) }) : null,
        },
        {
          key: 'wa',
          label: t('platform.tenants.kpi.whatsapp30d'),
          value: k.usage30d.whatsappSent.toLocaleString(),
          suffix: t('platform.tenants.kpi.activeUsers', { count: k.activeUsers7d }),
          suffixTone: 'cyan',
        },
      ]}
    />
  )
}

function TenantList({ k }) {
  const t = useT()
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')
  const [subscriptionStatus, setSubscriptionStatus] = useState('')
  const [planCode, setPlanCode] = useState('')
  const [sort, setSort] = useState('newest')
  const [offset, setOffset] = useState(0)
  const plans = useQuery(api.platform.billing.listPlans, {})
  const tabFilter = tenantTabFilter(tab)
  const data = useQuery(api.platform.tenants.list, {
    search: search || undefined,
    state: tabFilter.state,
    subscriptionStatus: tabFilter.subscriptionStatus || subscriptionStatus || undefined,
    planCode: planCode || undefined,
    sort,
    offset,
  })
  const counts = tenantTabCounts(k)
  const reset = (fn) => (value) => {
    fn(value)
    setOffset(0)
  }
  const tabs = TENANT_TABS.filter((x) => x.value !== 'rejected' || counts.rejected).map((x) => ({
    value: x.value,
    controls: 'tenant-rows',
    label: `${t(`platform.tenants.tab.${x.value}`)}${counts[x.value] !== undefined ? ` ${counts[x.value]}` : ''}`,
  }))

  return (
    <div className="flex flex-col gap-3">
      <div id="tenant-rows" role="tabpanel">
        <Table
          className={CONSOLE_TABLE}
          tabs={tabs}
          tab={tab}
          onTabChange={reset(setTab)}
          tabsLabel={t('platform.tenants.tabsLabel')}
          search={search}
          onSearchChange={reset(setSearch)}
          searchPlaceholder={t('platform.tenants.search')}
          actions={
            <>
              <label className="sr-only" htmlFor="tenant-sub">
                {t('platform.tenants.subscription')}
              </label>
              <Select
                id="tenant-sub"
                className="!min-h-9 !w-auto !py-1 text-sm"
                value={tabFilter.subscriptionStatus || subscriptionStatus}
                disabled={Boolean(tabFilter.subscriptionStatus)}
                onChange={(e) => reset(setSubscriptionStatus)(e.target.value)}
              >
                <option value="">{t('platform.tenants.anySubscription')}</option>
                {['trialing', 'active', 'past_due', 'suspended', 'cancelled', 'none'].map((s) => (
                  <option key={s} value={s}>
                    {t(`platform.status.${s === 'none' ? 'no_plan' : s}`)}
                  </option>
                ))}
              </Select>
              <label className="sr-only" htmlFor="tenant-plan">
                {t('platform.tenants.plan')}
              </label>
              <Select id="tenant-plan" className="!min-h-9 !w-auto !py-1 text-sm" value={planCode} onChange={(e) => reset(setPlanCode)(e.target.value)}>
                <option value="">{t('platform.tenants.anyPlan')}</option>
                {(plans ?? []).map((p) => (
                  <option key={p.id} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <label className="sr-only" htmlFor="tenant-sort">
                {t('platform.tenants.sort')}
              </label>
              <Select id="tenant-sort" className="!min-h-9 !w-auto !py-1 text-sm" value={sort} onChange={(e) => reset(setSort)(e.target.value)}>
                {['newest', 'oldest', 'name', 'trialEnding'].map((s) => (
                  <option key={s} value={s}>
                    {t(`platform.tenants.sortBy.${s}`)}
                  </option>
                ))}
              </Select>
            </>
          }
          rowKey={(r) => r.companyId}
          rows={data?.rows ?? []}
          empty={data === undefined ? t('platform.tenants.loading') : t('platform.tenants.empty')}
          columns={[
            {
              key: 'name',
              header: t('platform.tenants.col.farm'),
              render: (r) => (
                <Link
                  className="rounded font-medium text-text hover:text-pearl-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                  href={`/platform/tenants/${r.companyId}`}
                >
                  {r.name}
                </Link>
              ),
              sub: (r) => r.contactEmail || '—',
            },
            { key: 'plan', header: t('platform.tenants.col.plan'), render: (r) => r.planName || '—' },
            {
              key: 'status',
              header: t('platform.tenants.col.status'),
              render: (r) => {
                const s = tenantStatus(r.state, r.subscriptionStatus)
                return (
                  <span className={`inline-flex items-center gap-2 ${TEXT_TONE[s.tone] || 'text-text'}`}>
                    <StatusDot tone={DOT_TONE[s.tone]} size={7} />
                    {t(`platform.status.${s.key}`)}
                  </span>
                )
              },
            },
            {
              key: 'sitesUsers',
              header: t('platform.tenants.col.sitesUsers'),
              render: (r) => (
                <span className="text-muted tabular-nums">
                  {r.sites} · {r.members}
                </span>
              ),
            },
            { key: 'activeUsers30d', header: t('platform.tenants.col.active30d'), align: 'right' },
            {
              key: 'health',
              header: t('platform.tenants.col.health'),
              align: 'right',
              render: (r) => <span className={`font-medium ${healthTone(r.health)}`}>{r.health}</span>,
            },
            {
              key: 'when',
              header: t('platform.tenants.col.lastActivity'),
              align: 'right',
              render: (r) => <span className="text-muted">{formatDate(r.lastActivityAt)}</span>,
              sub: (r) =>
                r.trialEndsAt && r.subscriptionStatus === 'trialing' ? t('platform.tenants.trialEnds', { date: formatDate(r.trialEndsAt) }) : null,
            },
          ]}
        />
      </div>
      {data ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>
            {t('platform.tenants.range', {
              from: data.total === 0 ? 0 : data.offset + 1,
              to: data.offset + data.rows.length,
              total: `${data.total}${data.truncated ? '+' : ''}`,
            })}
          </span>
          <div className="flex gap-2">
            <GhostButton disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.pageSize))}>
              {t('platform.tenants.previous')}
            </GhostButton>
            <GhostButton disabled={data.offset + data.rows.length >= data.total} onClick={() => setOffset(offset + data.pageSize)}>
              {t('platform.tenants.next')}
            </GhostButton>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function RenewalsAndMix() {
  const t = useT()
  const subs = useQuery(api.platform.billing.listSubscriptions, {})
  const [now] = useState(() => Date.now())
  if (subs === undefined) return <LoadingState label={t('platform.tenants.loadingRenewals')} />
  const renewals = upcomingRenewals(subs, now)
  const mix = planMix(subs)
  const total = mix.reduce((n, m) => n + m.count, 0)
  const when = (r) =>
    r.status === 'trialing'
      ? t('platform.tenants.renewal.trialEnds', { date: formatDate(r.at) })
      : r.status === 'past_due'
        ? t('platform.tenants.renewal.graceEnds', { date: formatDate(r.at) })
        : t('platform.tenants.renewal.renews', { date: formatDate(r.at) })
  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:gap-14">
      <section aria-labelledby="renewals-title" className="flex min-w-0 flex-col gap-[14px] lg:grow-[1.4] lg:basis-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="renewals-title" className="text-[15px] font-semibold leading-[18px] text-text">
            {t('platform.tenants.renewals')}
          </h2>
          <span className="text-[13px] leading-4 text-muted">{t('platform.tenants.renewalsNote')}</span>
        </div>
        {renewals.length === 0 ? (
          <p className="text-sm text-muted">{t('platform.tenants.noRenewals')}</p>
        ) : (
          <ul>
            {renewals.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-[10px] text-[13px] leading-4">
                <Link className="text-text hover:text-pearl-cyan" href={`/platform/tenants/${r.companyId}`}>
                  {r.companyName} · {r.planName}
                </Link>
                <span className={r.status === 'past_due' ? 'text-warn' : 'text-muted'}>{when(r)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="mix-title" className="flex min-w-0 flex-col gap-[14px] lg:grow lg:basis-0">
        <h2 id="mix-title" className="text-[15px] font-semibold leading-[18px] text-text">
          {t('platform.tenants.planMix')}
        </h2>
        {total === 0 ? (
          <p className="text-sm text-muted">{t('platform.tenants.noPlans')}</p>
        ) : (
          <>
            <div className="flex h-[10px] gap-[2px] overflow-hidden rounded-pill" aria-hidden>
              {mix.map((m, i) => (
                <div key={m.plan} className={MIX_COLORS[i % MIX_COLORS.length]} style={{ flexGrow: m.count, flexBasis: 0 }} />
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {mix.map((m, i) => (
                <li key={m.plan} className="flex items-center gap-[6px] text-xs leading-4 text-muted">
                  <span className={`size-2 rounded-pill ${MIX_COLORS[i % MIX_COLORS.length]}`} aria-hidden />
                  {m.plan} {m.count}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}

export default function PlatformTenantsPage() {
  const t = useT()
  return (
    <PlatformLayout title={t('platform.nav.tenants')}>
      <TenantsBody />
    </PlatformLayout>
  )
}

function TenantsBody() {
  const k = useQuery(api.platform.overview.kpis, {})
  return (
    <div className="flex flex-col gap-8">
      <Kpis k={k} />
      <TenantList k={k} />
      <RenewalsAndMix />
    </div>
  )
}
