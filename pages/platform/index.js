import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import PlatformLayout, { SimpleTable } from '../../components/platform/PlatformLayout'
import { Card, CardHeader, LoadingState, StatCard } from '../../components/ui'
import { formatDate, formatMinor } from '../../lib/billingFormat'
import { useT } from '../../lib/i18n/context'

function moneyList(list) {
  if (!list || list.length === 0) return '—'
  return list.map((m) => formatMinor(m.amountMinor, m.currency)).join(' · ')
}

function RecordsChart({ days }) {
  const max = Math.max(1, ...days.map((d) => d.records))
  return (
    <div className="flex items-end gap-1 h-32" role="img" aria-label="Daily records per day, last 14 days">
      {days.map((d) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <div
            className="w-full rounded-t bg-pearl-cyan/70"
            style={{ height: `${Math.max(2, (d.records / max) * 100)}%` }}
            title={`${d.date}: ${d.records}`}
          />
          <span className="text-[10px] text-muted truncate">{d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  )
}

function Overview() {
  const k = useQuery(api.platform.overview.kpis, {})
  if (k === undefined) return <LoadingState label="Loading platform KPIs…" />
  return (
    <div className="space-y-6">
      {k.truncated && (
        <p className="text-sm text-alert">Counts cover the first organizations only; the platform has outgrown this scan.</p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active tenants" value={k.tenants.active} hint={`${k.tenants.total} total`} tone="good" />
        <StatCard label="Pending approval" value={k.tenants.pending} tone={k.tenants.pending ? 'accent' : 'default'} />
        <StatCard label="Suspended" value={k.tenants.suspended} tone={k.tenants.suspended ? 'warn' : 'default'} />
        <StatCard label="Active users" value={k.activeUsers7d} hint={`${k.activeUsers30d} in 30 days`} unit="7d" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <StatCard label="MRR" value={moneyList(k.mrr)} />
        <StatCard label="ARR" value={moneyList(k.arr)} />
        <StatCard
          label="Overdue"
          value={k.overdue.count}
          hint={moneyList(k.overdue.amounts)}
          tone={k.overdue.count ? 'warn' : 'default'}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Daily records" subtitle="Records entered per day across all tenants" />
          <RecordsChart days={k.recordsPerDay} />
        </Card>
        <Card>
          <CardHeader title="Subscriptions" />
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {Object.entries(k.subscriptions).map(([status, n]) => (
              <div key={status}>
                <dt className="text-muted capitalize">{status.replace('_', ' ')}</dt>
                <dd className="text-xl tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Trials ending in 7 days" />
          <SimpleTable
            rowKey={(r) => r.companyId}
            rows={k.trialsEnding7d}
            empty="No trials end this week"
            columns={[
              {
                key: 'name',
                label: 'Tenant',
                render: (r) => (
                  <Link className="text-pearl-cyan hover:underline" href={`/platform/tenants/${r.companyId}`}>
                    {r.name}
                  </Link>
                ),
              },
              { key: 'trialEndsAt', label: 'Trial ends', render: (r) => formatDate(r.trialEndsAt) },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Messaging & AI, last 30 days" subtitle="From the daily usage rollup" />
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div><dt className="text-muted">SMS sent</dt><dd className="text-xl tabular-nums">{k.usage30d.smsSent}</dd></div>
            <div><dt className="text-muted">WhatsApp sent</dt><dd className="text-xl tabular-nums">{k.usage30d.whatsappSent}</dd></div>
            <div><dt className="text-muted">Email sent</dt><dd className="text-xl tabular-nums">{k.usage30d.emailSent}</dd></div>
            <div><dt className="text-muted">AI calls</dt><dd className="text-xl tabular-nums">{k.usage30d.aiCalls}</dd></div>
            <div><dt className="text-muted">AI tokens</dt><dd className="text-xl tabular-nums">{k.usage30d.aiTokens.toLocaleString()}</dd></div>
            <div><dt className="text-muted">AI cost</dt><dd className="text-xl tabular-nums">${k.usage30d.aiCostUsd.toFixed(2)}</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  )
}

export default function PlatformOverviewPage() {
  const t = useT()
  return (
    <PlatformLayout title={t('platform.nav.overview')}>
      <Overview />
    </PlatformLayout>
  )
}
