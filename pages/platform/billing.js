import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import PlatformLayout, { SimpleTable, StatusPill } from '../../components/platform/PlatformLayout'
import { Button, Card, CardHeader, Field, Input, LoadingState, Modal, Select, TabBar, Textarea } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'
import { formatDate, formatMinor, minorDigits, toMinor } from '../../lib/billingFormat'

const CURRENCIES = ['GHS', 'XOF', 'USD']
const LIMIT_KEYS = ['sites', 'users', 'units', 'aiCredits', 'smsIncluded']
const FEATURE_KEYS = ['ai_assistant', 'sms_alerts', 'whatsapp', 'public_api', 'webhooks', 'hatchery', 'multi_site_reports']

const tenantLink = (r) => (
  <Link className="text-lake hover:underline" href={`/platform/tenants/${r.companyId}`}>
    {r.companyName}
  </Link>
)

function blankPlan() {
  return {
    code: '',
    name: '',
    description: '',
    interval: 'month',
    trialDays: '14',
    sortOrder: '50',
    isDefault: false,
    active: true,
    prices: Object.fromEntries(CURRENCIES.map((c) => [c, ''])),
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, ''])),
    features: Object.fromEntries(FEATURE_KEYS.map((f) => [f, false])),
  }
}

function planToForm(p) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description || '',
    interval: p.interval,
    trialDays: String(p.trialDays),
    sortOrder: String(p.sortOrder),
    isDefault: p.isDefault,
    active: p.active,
    prices: Object.fromEntries(
      CURRENCIES.map((c) => {
        const price = p.prices.find((x) => x.currency === c)
        return [c, price ? String(price.amountMinor / 10 ** minorDigits(c)) : '']
      }),
    ),
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, p.limits[k] === undefined ? '' : String(p.limits[k])])),
    features: { ...Object.fromEntries(FEATURE_KEYS.map((f) => [f, false])), ...p.features },
  }
}

function PlanEditor({ initial, onClose }) {
  const createPlan = useMutation(api.platform.billing.createPlan)
  const updatePlan = useMutation(api.platform.billing.updatePlan)
  const { showToast } = useToast()
  const [f, setF] = useState(initial)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    const prices = []
    for (const c of CURRENCIES) {
      if (f.prices[c] === '') continue
      const m = toMinor(f.prices[c], c)
      if (m === null) return showToast(`Invalid ${c} price`, 'error')
      prices.push({ currency: c, amountMinor: m })
    }
    const limits = {}
    for (const k of LIMIT_KEYS) if (f.limits[k] !== '') limits[k] = Number(f.limits[k])
    const body = {
      name: f.name,
      description: f.description || undefined,
      prices,
      interval: f.interval,
      limits,
      features: f.features,
      trialDays: Number(f.trialDays) || 0,
      isDefault: f.isDefault,
      active: f.active,
      sortOrder: Number(f.sortOrder) || 0,
    }
    setBusy(true)
    try {
      if (f.id) await updatePlan({ planId: f.id, ...body })
      else await createPlan({ code: f.code, ...body })
      showToast('Plan saved', 'success')
      onClose()
    } catch (err) {
      showToast(errorMessage(err, 'Could not save the plan'), 'error')
    } finally {
      setBusy(false)
    }
  }
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <Modal open onClose={onClose} title={f.id ? `Edit ${f.name}` : 'New plan'} size="lg" showClose>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" htmlFor="plan-code" hint="Lowercase, fixed once created" required>
            <Input id="plan-code" required disabled={Boolean(f.id)} value={f.code} onChange={set('code')} pattern="[a-z0-9_-]+" />
          </Field>
          <Field label="Name" htmlFor="plan-name" required>
            <Input id="plan-name" required value={f.name} onChange={set('name')} />
          </Field>
        </div>
        <Field label="Description" htmlFor="plan-desc">
          <Textarea id="plan-desc" rows={2} value={f.description} onChange={set('description')} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Interval" htmlFor="plan-interval">
            <Select id="plan-interval" value={f.interval} onChange={set('interval')}>
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
            </Select>
          </Field>
          <Field label="Trial days" htmlFor="plan-trial">
            <Input id="plan-trial" type="number" min={0} max={365} value={f.trialDays} onChange={set('trialDays')} />
          </Field>
          <Field label="Sort order" htmlFor="plan-sort">
            <Input id="plan-sort" type="number" value={f.sortOrder} onChange={set('sortOrder')} />
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-medium mb-2">Prices per interval (blank: not sold in that currency)</legend>
          <div className="grid grid-cols-3 gap-3">
            {CURRENCIES.map((c) => (
              <Field key={c} label={c} htmlFor={`price-${c}`}>
                <Input
                  id={`price-${c}`}
                  inputMode="decimal"
                  value={f.prices[c]}
                  onChange={(e) => setF((x) => ({ ...x, prices: { ...x.prices, [c]: e.target.value } }))}
                />
              </Field>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium mb-2">Limits (blank: unlimited)</legend>
          <div className="grid grid-cols-3 gap-3">
            {LIMIT_KEYS.map((k) => (
              <Field key={k} label={k} htmlFor={`limit-${k}`}>
                <Input
                  id={`limit-${k}`}
                  type="number"
                  min={0}
                  value={f.limits[k]}
                  onChange={(e) => setF((x) => ({ ...x, limits: { ...x.limits, [k]: e.target.value } }))}
                />
              </Field>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium mb-2">Features</legend>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.keys(f.features).map((feat) => (
              <label key={feat} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(f.features[feat])}
                  onChange={(e) => setF((x) => ({ ...x, features: { ...x.features, [feat]: e.target.checked } }))}
                />
                {feat.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.isDefault} onChange={(e) => setF((x) => ({ ...x, isDefault: e.target.checked }))} />
            Default plan for new tenants
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} />
            Active (can be assigned)
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save plan'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function Plans() {
  const plans = useQuery(api.platform.billing.listPlans, {})
  const seed = useMutation(api.platform.billing.seedDefaultPlans)
  const { showToast } = useToast()
  const [editing, setEditing] = useState(null)
  if (plans === undefined) return <LoadingState />
  return (
    <Card>
      <CardHeader
        title="Plans"
        subtitle="Prices are placeholders until the owner sets them"
        action={
          <div className="flex gap-2">
            {plans.length === 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => seed({}).then(() => showToast('Default plans created', 'success'), (e) => showToast(errorMessage(e), 'error'))}
              >
                Create default plans
              </Button>
            )}
            <Button size="sm" onClick={() => setEditing(blankPlan())}>
              New plan
            </Button>
          </div>
        }
      />
      <SimpleTable
        rows={plans}
        empty="No plans yet"
        columns={[
          { key: 'name', label: 'Plan', render: (p) => <span className="font-medium">{p.name} <span className="text-muted text-xs">({p.code})</span></span> },
          { key: 'prices', label: 'Prices', render: (p) => p.prices.map((x) => formatMinor(x.amountMinor, x.currency)).join(' · ') + ` / ${p.interval}` },
          {
            key: 'limits',
            label: 'Limits',
            render: (p) =>
              LIMIT_KEYS.map((k) => `${k}: ${p.limits[k] ?? '∞'}`).join(', '),
          },
          { key: 'trialDays', label: 'Trial', align: 'right' },
          { key: 'flags', label: '', render: (p) => <>{p.isDefault && <StatusPill status="default" />} {!p.active && <StatusPill status="retired" />}</> },
          { key: 'edit', label: '', render: (p) => <Button size="sm" variant="secondary" onClick={() => setEditing(planToForm(p))}>Edit</Button> },
        ]}
      />
      {editing && <PlanEditor initial={editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function Subscriptions() {
  const [status, setStatus] = useState('')
  const rows = useQuery(api.platform.billing.listSubscriptions, { status: status || undefined })
  return (
    <Card>
      <CardHeader
        title="Subscriptions"
        action={
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="">All statuses</option>
            {['trialing', 'active', 'past_due', 'suspended', 'cancelled'].map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </Select>
        }
      />
      {rows === undefined ? (
        <LoadingState />
      ) : (
        <SimpleTable
          rows={rows}
          empty="No subscriptions"
          columns={[
            { key: 'companyName', label: 'Tenant', render: tenantLink },
            { key: 'planName', label: 'Plan' },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'currentPeriodEnd', label: 'Period ends', render: (r) => formatDate(r.currentPeriodEnd) },
            { key: 'trialEndsAt', label: 'Trial ends', render: (r) => formatDate(r.trialEndsAt) },
            { key: 'graceEndsAt', label: 'Grace ends', render: (r) => formatDate(r.graceEndsAt) },
            { key: 'provider', label: 'Provider' },
          ]}
        />
      )}
    </Card>
  )
}

function Invoices() {
  const [status, setStatus] = useState('open')
  const rows = useQuery(api.platform.billing.listInvoices, { status: status || undefined })
  const voidInvoice = useMutation(api.platform.billing.voidInvoice)
  const { showToast } = useToast()
  const onVoid = async (r) => {
    const reason = window.prompt(`Void ${r.number}? Reason:`)
    if (!reason) return
    try {
      await voidInvoice({ invoiceId: r.id, reason })
      showToast('Invoice voided', 'success')
    } catch (err) {
      showToast(errorMessage(err, 'Could not void the invoice'), 'error')
    }
  }
  return (
    <Card>
      <CardHeader
        title="Invoices"
        subtitle="Create invoices and record payments from the tenant's page"
        action={
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="">All statuses</option>
            {['open', 'paid', 'void', 'uncollectible'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        }
      />
      {rows === undefined ? (
        <LoadingState />
      ) : (
        <SimpleTable
          rows={rows}
          empty="No invoices"
          columns={[
            { key: 'number', label: 'Number' },
            { key: 'companyName', label: 'Tenant', render: tenantLink },
            { key: 'issuedAt', label: 'Issued', render: (r) => formatDate(r.issuedAt) },
            { key: 'dueAt', label: 'Due', render: (r) => formatDate(r.dueAt) },
            { key: 'total', label: 'Total', align: 'right', render: (r) => formatMinor(r.totalMinor, r.currency) },
            { key: 'paid', label: 'Paid', align: 'right', render: (r) => formatMinor(r.paidMinor, r.currency) },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'void', label: '', render: (r) => (r.status === 'open' && r.paidMinor === 0 ? <Button size="sm" variant="ghost" onClick={() => onVoid(r)}>Void</Button> : null) },
          ]}
        />
      )}
    </Card>
  )
}

function Payments() {
  const rows = useQuery(api.platform.billing.listPayments, {})
  return (
    <Card>
      <CardHeader title="Payments" subtitle="Most recent first" />
      {rows === undefined ? (
        <LoadingState />
      ) : (
        <SimpleTable
          rows={rows}
          empty="No payments recorded"
          columns={[
            { key: 'receivedAt', label: 'Received', render: (r) => formatDate(r.receivedAt) },
            { key: 'companyName', label: 'Tenant', render: tenantLink },
            { key: 'amount', label: 'Amount', align: 'right', render: (r) => formatMinor(r.amountMinor, r.currency) },
            { key: 'method', label: 'Method', render: (r) => r.method.replace('_', ' ') },
            { key: 'providerRef', label: 'Reference', render: (r) => r.providerRef || '—' },
          ]}
        />
      )}
    </Card>
  )
}

function Dunning() {
  const rows = useQuery(api.platform.billing.dunning, {})
  return (
    <Card>
      <CardHeader title="Dunning" subtitle="Past-due tenants; suspended automatically when grace ends" />
      {rows === undefined ? (
        <LoadingState />
      ) : (
        <SimpleTable
          rowKey={(r) => r.subscriptionId}
          rows={rows}
          empty="Nobody is past due"
          columns={[
            { key: 'companyName', label: 'Tenant', render: tenantLink },
            { key: 'pastDueAt', label: 'Past due since', render: (r) => formatDate(r.pastDueAt) },
            { key: 'graceEndsAt', label: 'Grace ends', render: (r) => formatDate(r.graceEndsAt) },
            { key: 'owed', label: 'Owed', align: 'right', render: (r) => r.owed.map((o) => formatMinor(o.amountMinor, o.currency)).join(' · ') || '—' },
            { key: 'openInvoices', label: 'Open invoices', align: 'right' },
          ]}
        />
      )}
    </Card>
  )
}

const TABS = [
  { id: 'plans', label: 'Plans' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'payments', label: 'Payments' },
  { id: 'dunning', label: 'Dunning' },
]

export default function PlatformBillingPage() {
  const [tab, setTab] = useState('plans')
  return (
    <PlatformLayout title="Billing">
      <div className="space-y-4">
        <TabBar tabs={TABS} active={tab} onChange={setTab} label="Billing sections" />
        {tab === 'plans' && <Plans />}
        {tab === 'subscriptions' && <Subscriptions />}
        {tab === 'invoices' && <Invoices />}
        {tab === 'payments' && <Payments />}
        {tab === 'dunning' && <Dunning />}
      </div>
    </PlatformLayout>
  )
}
