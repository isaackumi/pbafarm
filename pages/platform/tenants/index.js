import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import PlatformLayout, { SimpleTable, StatusPill } from '../../../components/platform/PlatformLayout'
import { Button, Card, Field, Input, LoadingState, Select } from '../../../components/ui'
import { formatDate } from '../../../lib/billingFormat'

function healthTone(score) {
  if (score >= 70) return 'text-kelp'
  if (score >= 40) return 'text-warn'
  return 'text-signal'
}

function TenantList() {
  const [search, setSearch] = useState('')
  const [state, setState] = useState('')
  const [subscriptionStatus, setSubscriptionStatus] = useState('')
  const [planCode, setPlanCode] = useState('')
  const [sort, setSort] = useState('newest')
  const [offset, setOffset] = useState(0)
  const plans = useQuery(api.platform.billing.listPlans, {})
  const data = useQuery(api.platform.tenants.list, {
    search: search || undefined,
    state: state || undefined,
    subscriptionStatus: subscriptionStatus || undefined,
    planCode: planCode || undefined,
    sort,
    offset,
  })
  const reset = (fn) => (e) => {
    fn(e.target.value)
    setOffset(0)
  }

  return (
    <Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Field label="Search" htmlFor="tenant-search">
          <Input id="tenant-search" value={search} onChange={reset(setSearch)} placeholder="Name or email" />
        </Field>
        <Field label="Status" htmlFor="tenant-state">
          <Select id="tenant-state" value={state} onChange={reset(setState)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
            <option value="rejected">Rejected</option>
          </Select>
        </Field>
        <Field label="Subscription" htmlFor="tenant-sub">
          <Select id="tenant-sub" value={subscriptionStatus} onChange={reset(setSubscriptionStatus)}>
            <option value="">All</option>
            <option value="trialing">Trialing</option>
            <option value="active">Active</option>
            <option value="past_due">Past due</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
            <option value="none">No subscription</option>
          </Select>
        </Field>
        <Field label="Plan" htmlFor="tenant-plan">
          <Select id="tenant-plan" value={planCode} onChange={reset(setPlanCode)}>
            <option value="">All</option>
            {(plans ?? []).map((p) => (
              <option key={p.id} value={p.code}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sort" htmlFor="tenant-sort">
          <Select id="tenant-sort" value={sort} onChange={reset(setSort)}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
            <option value="trialEnding">Trial ending soonest</option>
          </Select>
        </Field>
      </div>
      {data === undefined ? (
        <LoadingState label="Loading tenants…" />
      ) : (
        <>
          <SimpleTable
            rowKey={(r) => r.companyId}
            rows={data.rows}
            empty="No tenants match these filters"
            columns={[
              {
                key: 'name',
                label: 'Tenant',
                render: (r) => (
                  <div>
                    <Link className="text-lake hover:underline font-medium" href={`/platform/tenants/${r.companyId}`}>
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted">{r.contactEmail || '—'}</div>
                  </div>
                ),
              },
              { key: 'state', label: 'Status', render: (r) => <StatusPill status={r.state} /> },
              {
                key: 'plan',
                label: 'Plan',
                render: (r) => (
                  <div>
                    {r.planName || '—'} <StatusPill status={r.subscriptionStatus} />
                    {r.trialEndsAt && r.subscriptionStatus === 'trialing' && (
                      <div className="text-xs text-muted">Trial ends {formatDate(r.trialEndsAt)}</div>
                    )}
                  </div>
                ),
              },
              { key: 'sites', label: 'Sites', align: 'right' },
              { key: 'members', label: 'Users', align: 'right' },
              { key: 'activeUsers30d', label: 'Active 30d', align: 'right' },
              { key: 'lastActivityAt', label: 'Last activity', render: (r) => formatDate(r.lastActivityAt) },
              {
                key: 'health',
                label: 'Health',
                align: 'right',
                render: (r) => <span className={`font-medium ${healthTone(r.health)}`}>{r.health}</span>,
              },
            ]}
          />
          <div className="flex items-center justify-between mt-4 text-sm text-muted">
            <span>
              {data.total === 0 ? 0 : data.offset + 1}–{data.offset + data.rows.length} of {data.total}
              {data.truncated ? '+' : ''}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.pageSize))}>
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={data.offset + data.rows.length >= data.total}
                onClick={() => setOffset(offset + data.pageSize)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}

export default function PlatformTenantsPage() {
  return (
    <PlatformLayout title="Tenants">
      <TenantList />
    </PlatformLayout>
  )
}
