import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import PlatformLayout, { SimpleTable } from '../../components/platform/PlatformLayout'
import { Card, CardHeader, LoadingState, Select, StatCard } from '../../components/ui'
import { useT } from '../../lib/i18n/context'

const SORTS = {
  aiCostUsd: 'AI cost',
  aiTokens: 'AI tokens',
  smsSent: 'SMS',
  whatsappSent: 'WhatsApp',
  dailyRecords: 'Records',
}

function UsageTable() {
  const [days, setDays] = useState(30)
  const [sort, setSort] = useState('aiCostUsd')
  const data = useQuery(api.platform.usage.byTenant, { days })
  const rows = useMemo(() => (data ? [...data.rows].sort((a, b) => b[sort] - a[sort]) : []), [data, sort])
  if (data === undefined) return <LoadingState label="Loading usage…" />
  const t = rows.reduce(
    (s, r) => ({ sms: s.sms + r.smsSent, wa: s.wa + r.whatsappSent, tokens: s.tokens + r.aiTokens, cost: s.cost + r.aiCostUsd }),
    { sms: 0, wa: 0, tokens: 0, cost: 0 },
  )
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="SMS sent" value={t.sms} />
        <StatCard label="WhatsApp sent" value={t.wa} />
        <StatCard label="AI tokens" value={t.tokens.toLocaleString()} />
        <StatCard label="AI cost" value={`$${t.cost.toFixed(2)}`} />
      </div>
      <Card>
        <CardHeader
          title="Per tenant"
          subtitle={`${data.from} to ${data.to}, from the nightly rollup`}
          action={
            <div className="flex gap-2">
              <Select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-32">
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </Select>
              <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} className="w-36">
                {Object.entries(SORTS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </Select>
            </div>
          }
        />
        <SimpleTable
          rowKey={(r) => r.companyId}
          rows={rows}
          empty="No usage rolled up for this period"
          columns={[
            {
              key: 'companyName',
              label: 'Tenant',
              render: (r) => (
                <Link className="text-pearl-cyan hover:underline" href={`/platform/tenants/${r.companyId}`}>
                  {r.companyName}
                </Link>
              ),
            },
            { key: 'dailyRecords', label: 'Records', align: 'right' },
            { key: 'smsSent', label: 'SMS', align: 'right' },
            { key: 'whatsappSent', label: 'WhatsApp', align: 'right' },
            { key: 'emailSent', label: 'Email', align: 'right' },
            { key: 'aiCalls', label: 'AI calls', align: 'right' },
            { key: 'aiTokens', label: 'AI tokens', align: 'right', render: (r) => r.aiTokens.toLocaleString() },
            { key: 'aiCostUsd', label: 'AI cost', align: 'right', render: (r) => `$${r.aiCostUsd.toFixed(2)}` },
          ]}
        />
      </Card>
    </div>
  )
}

export default function PlatformUsagePage() {
  const t = useT()
  return (
    <PlatformLayout title={t('platform.nav.usage')}>
      <UsageTable />
    </PlatformLayout>
  )
}
