import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Card, CardHeader, LoadingState } from '../ui'
import { StatusPill, SimpleTable } from '../platform/PlatformLayout'
import { formatDate, formatMinor } from '../../lib/billingFormat'

const STATUS_TEXT = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment overdue',
  suspended: 'Suspended for non-payment',
  cancelled: 'Cancelled',
  none: 'No plan',
}

function LimitBar({ used, max }) {
  if (max === null) return <span className="text-sm text-muted">{used} · unlimited</span>
  const pct = max === 0 ? 100 : Math.min(100, Math.round((used / max) * 100))
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="tabular-nums">
          {used} of {max}
        </span>
        <span className="text-muted">{pct}%</span>
      </div>
      <div className="h-2 rounded bg-foam-deep mt-1 overflow-hidden" aria-hidden="true">
        <div className={`h-full ${pct >= 100 ? 'bg-signal' : pct >= 80 ? 'bg-warn' : 'bg-kelp'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** Current plan, usage vs limits and invoices for the signed-in organization (PLAT-113). */
export default function TenantBilling() {
  const b = useQuery(api.billing.tenant.myBilling, {})
  if (b === undefined) return <LoadingState label="Loading billing…" />
  if (b === null) return <p className="text-muted">No organization selected.</p>
  const open = b.invoices.filter((i) => i.status === 'open')
  return (
    <div className="space-y-4">
      {b.suspended && (
        <Card className="border-signal">
          <p className="font-medium text-signal">Access to your organization is suspended.</p>
          {b.suspensionReason && <p className="text-sm mt-1">{b.suspensionReason}</p>}
          <p className="text-sm text-muted mt-1">Settle the open invoices below; access returns once payment is recorded.</p>
        </Card>
      )}
      <Card>
        <CardHeader title="Current plan" />
        {b.plan ? (
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div>
              <dt className="text-muted">Plan</dt>
              <dd className="font-medium">{b.plan.name}</dd>
            </div>
            <div>
              <dt className="text-muted">Status</dt>
              <dd>
                <StatusPill status={b.status} /> <span className="text-muted">{STATUS_TEXT[b.status]}</span>
              </dd>
            </div>
            <div>
              <dt className="text-muted">Price</dt>
              <dd>{b.plan.amountMinor === null ? '—' : `${formatMinor(b.plan.amountMinor, b.plan.currency)} / ${b.plan.interval}`}</dd>
            </div>
            <div>
              <dt className="text-muted">{b.status === 'trialing' ? 'Trial ends' : b.status === 'past_due' ? 'Pay by' : 'Renews'}</dt>
              <dd>{formatDate(b.status === 'trialing' ? b.trialEndsAt : b.status === 'past_due' ? b.graceEndsAt : b.currentPeriodEnd)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted">Your organization is not on a plan yet.</p>
        )}
      </Card>
      <Card>
        <CardHeader title="Usage vs plan limits" subtitle="Contact us to upgrade when you reach a limit" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {b.limits.map((l) => (
            <div key={l.kind}>
              <p className="text-sm font-medium mb-1">{l.label}</p>
              <LimitBar used={l.used} max={l.max} />
            </div>
          ))}
        </div>
      </Card>
      {open.length > 0 && b.paymentInstructions && (
        <Card>
          <CardHeader title="How to pay" />
          <p className="text-sm whitespace-pre-wrap">{b.paymentInstructions}</p>
        </Card>
      )}
      <Card>
        <CardHeader title="Invoices" />
        <SimpleTable
          rows={b.invoices}
          empty="No invoices yet"
          columns={[
            { key: 'number', label: 'Number' },
            { key: 'issuedAt', label: 'Issued', render: (r) => formatDate(r.issuedAt) },
            { key: 'dueAt', label: 'Due', render: (r) => formatDate(r.dueAt) },
            { key: 'total', label: 'Total', align: 'right', render: (r) => formatMinor(r.totalMinor, r.currency) },
            { key: 'balance', label: 'Balance', align: 'right', render: (r) => formatMinor(r.totalMinor - r.paidMinor, r.currency) },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
          ]}
        />
      </Card>
    </div>
  )
}
