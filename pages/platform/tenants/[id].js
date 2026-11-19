import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import PlatformLayout, { SimpleTable, StatusPill } from '../../../components/platform/PlatformLayout'
import { Button, Card, CardHeader, Field, Input, LoadingState, Modal, Select, TabBar, Textarea } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { errorMessage } from '../../../lib/errorMessage'
import { formatDate, formatDateTime, formatMinor, minorDigits, toMinor } from '../../../lib/billingFormat'

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'usage', label: 'Usage' },
  { id: 'billing', label: 'Billing' },
  { id: 'limits', label: 'Limits & features' },
  { id: 'notes', label: 'Notes' },
  { id: 'audit', label: 'Audit trail' },
]

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

/** One modal form per action; `onSubmit` returns a success message. */
function ActionModal({ open, title, description, submitLabel = 'Save', danger, onClose, onSubmit, children }) {
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  if (!open) return null
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const msg = await onSubmit()
      if (msg) showToast(msg, 'success')
      onClose()
    } catch (err) {
      showToast(errorMessage(err, 'That did not work'), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={title} description={description} showClose>
      <form onSubmit={submit} className="space-y-4">
        {children}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy}>
            {busy ? 'Working…' : submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function Actions({ d }) {
  const router = useRouter()
  const { showToast } = useToast()
  const companyId = d.company.companyId
  const plans = useQuery(api.platform.billing.listPlans, {})
  const approve = useMutation(api.companies.approve)
  const reject = useMutation(api.companies.reject)
  const suspend = useMutation(api.platform.tenants.suspend)
  const reactivate = useMutation(api.platform.tenants.reactivate)
  const changePlan = useMutation(api.platform.tenants.changePlan)
  const extendTrial = useMutation(api.platform.tenants.extendTrial)
  const grantCredits = useMutation(api.platform.tenants.grantCredits)
  const requestExport = useMutation(api.platform.tenants.requestExport)
  const startActAs = useMutation(api.actAs.start)
  const createInvoice = useMutation(api.platform.billing.createInvoiceForTenant)
  const recordPayment = useMutation(api.platform.billing.recordPayment)

  const [open, setOpen] = useState(null)
  const [form, setForm] = useState({})
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const show = (name, initial = {}) => {
    setForm(initial)
    setOpen(name)
  }
  const close = () => setOpen(null)
  const currency = d.subscription?.currency || d.company.currency || 'GHS'
  const state = d.company.state

  const run = async (fn, msg) => {
    try {
      await fn()
      showToast(msg, 'success')
    } catch (err) {
      showToast(errorMessage(err, 'That did not work'), 'error')
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {state === 'pending' && (
        <>
          <Button onClick={() => run(() => approve({ companyId }), 'Tenant approved; trial started')}>Approve</Button>
          <Button variant="secondary" onClick={() => show('reject')}>
            Reject
          </Button>
        </>
      )}
      {state === 'active' && (
        <Button variant="danger" onClick={() => show('suspend')}>
          Suspend
        </Button>
      )}
      {state === 'suspended' && <Button onClick={() => show('reactivate', { graceDays: '7' })}>Reactivate</Button>}
      {state !== 'pending' && state !== 'rejected' && (
        <>
          <Button variant="secondary" onClick={() => show('plan', { planId: d.subscription?.planId || '', status: 'active' })}>
            Change plan
          </Button>
          {d.subscription?.status === 'trialing' && (
            <Button variant="secondary" onClick={() => show('trial', { days: '14' })}>
              Extend trial
            </Button>
          )}
          <Button variant="secondary" onClick={() => show('credits', { kind: 'ai', amount: '100' })}>
            Grant credits
          </Button>
          <Button variant="secondary" onClick={() => show('invoice', { currency, description: 'Subscription', amount: '', dueInDays: '7', renews: 'yes' })}>
            Create invoice
          </Button>
          <Button variant="secondary" onClick={() => show('payment', { currency, method: 'mobile_money', invoiceId: '', amount: '', key: newKey() })}>
            Record payment
          </Button>
          <Button variant="secondary" onClick={() => show('actas', { minutes: '30' })}>
            Read-only act-as
          </Button>
          <Button variant="secondary" onClick={() => run(() => requestExport({ companyId }), 'Export started; it appears under Profile when ready')}>
            Export data
          </Button>
        </>
      )}

      <ActionModal
        open={open === 'reject'}
        title="Reject registration"
        danger
        submitLabel="Reject"
        onClose={close}
        onSubmit={async () => {
          await reject({ companyId, reason: form.reason || '' })
          return 'Registration rejected'
        }}
      >
        <Field label="Reason" htmlFor="reject-reason" required>
          <Textarea id="reject-reason" required value={form.reason || ''} onChange={set('reason')} />
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'suspend'}
        title={`Suspend ${d.company.name}`}
        description="Members lose access to the organization's data at once and are signed out. Owners can still see billing."
        danger
        submitLabel="Suspend"
        onClose={close}
        onSubmit={async () => {
          const r = await suspend({ companyId, reason: form.reason || '' })
          return `Suspended; ${r.sessionsRevoked} sessions ended`
        }}
      >
        <Field label="Reason (shown to the tenant)" htmlFor="suspend-reason" required>
          <Textarea id="suspend-reason" required minLength={3} value={form.reason || ''} onChange={set('reason')} />
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'reactivate'}
        title={`Reactivate ${d.company.name}`}
        description="Restores access. A billing suspension returns to past due with a fresh grace period."
        submitLabel="Reactivate"
        onClose={close}
        onSubmit={async () => {
          await reactivate({ companyId, graceDays: Number(form.graceDays) || undefined })
          return 'Tenant reactivated'
        }}
      >
        <Field label="Grace days (billing suspensions)" htmlFor="grace-days">
          <Input id="grace-days" type="number" min={1} max={60} value={form.graceDays || ''} onChange={set('graceDays')} />
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'plan'}
        title="Change plan"
        onClose={close}
        onSubmit={async () => {
          await changePlan({ companyId, planId: form.planId, status: form.status })
          return 'Plan changed'
        }}
      >
        <Field label="Plan" htmlFor="plan-id" required>
          <Select id="plan-id" required value={form.planId || ''} onChange={set('planId')}>
            <option value="">Choose a plan</option>
            {(plans ?? [])
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="plan-status">
          <Select id="plan-status" value={form.status} onChange={set('status')}>
            <option value="active">Active (paid period starts now)</option>
            <option value="trialing">Trialing</option>
          </Select>
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'trial'}
        title="Extend trial"
        onClose={close}
        onSubmit={async () => {
          const ends = await extendTrial({ companyId, days: Number(form.days) })
          return `Trial now ends ${formatDate(ends)}`
        }}
      >
        <Field label="Extra days" htmlFor="trial-days" required>
          <Input id="trial-days" type="number" min={1} max={90} required value={form.days || ''} onChange={set('days')} />
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'credits'}
        title="Grant credits"
        onClose={close}
        onSubmit={async () => {
          await grantCredits({ companyId, kind: form.kind, amount: Number(form.amount), reason: form.reason || '' })
          return 'Credits granted'
        }}
      >
        <Field label="Kind" htmlFor="credit-kind">
          <Select id="credit-kind" value={form.kind} onChange={set('kind')}>
            <option value="ai">AI credits</option>
            <option value="sms">SMS credits</option>
          </Select>
        </Field>
        <Field label="Amount" htmlFor="credit-amount" required>
          <Input id="credit-amount" type="number" min={1} required value={form.amount || ''} onChange={set('amount')} />
        </Field>
        <Field label="Reason" htmlFor="credit-reason" required>
          <Input id="credit-reason" required value={form.reason || ''} onChange={set('reason')} />
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'invoice'}
        title="Create invoice"
        onClose={close}
        onSubmit={async () => {
          const unit = toMinor(form.amount, form.currency)
          if (unit === null) throw new Error('Enter a valid amount')
          const r = await createInvoice({
            companyId,
            currency: form.currency,
            lines: [{ description: form.description || 'Subscription', quantity: 1, unitAmountMinor: unit }],
            dueInDays: Number(form.dueInDays) || 7,
            renewsSubscription: form.renews === 'yes',
          })
          return `Invoice ${r.number} created`
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency" htmlFor="inv-currency">
            <Select id="inv-currency" value={form.currency} onChange={set('currency')}>
              {['GHS', 'XOF', 'USD'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" htmlFor="inv-amount" required>
            <Input id="inv-amount" inputMode="decimal" required value={form.amount || ''} onChange={set('amount')} />
          </Field>
        </div>
        <Field label="Description" htmlFor="inv-desc">
          <Input id="inv-desc" value={form.description || ''} onChange={set('description')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due in days" htmlFor="inv-due">
            <Input id="inv-due" type="number" min={0} max={90} value={form.dueInDays || ''} onChange={set('dueInDays')} />
          </Field>
          <Field label="Renews subscription when paid" htmlFor="inv-renews">
            <Select id="inv-renews" value={form.renews} onChange={set('renews')}>
              <option value="yes">Yes</option>
              <option value="no">No (one-off)</option>
            </Select>
          </Field>
        </div>
      </ActionModal>

      <ActionModal
        open={open === 'payment'}
        title="Record payment"
        description="Recording the same payment twice is safe: this form carries one idempotency key."
        onClose={close}
        onSubmit={async () => {
          const amountMinor = toMinor(form.amount, form.currency)
          if (!amountMinor) throw new Error('Enter a valid amount')
          const r = await recordPayment({
            companyId,
            invoiceId: form.invoiceId || undefined,
            currency: form.currency,
            amountMinor,
            method: form.method,
            providerRef: form.providerRef || undefined,
            idempotencyKey: form.key,
            note: form.note || undefined,
          })
          return r.duplicate
            ? 'Already recorded'
            : r.reactivated
              ? 'Payment recorded; tenant reactivated'
              : r.invoicePaid
                ? 'Payment recorded; invoice paid'
                : 'Payment recorded'
        }}
      >
        <Field label="Invoice" htmlFor="pay-invoice">
          <Select
            id="pay-invoice"
            value={form.invoiceId}
            onChange={(e) => {
              const inv = d.invoices.find((i) => i.id === e.target.value)
              setForm((f) => ({
                ...f,
                invoiceId: e.target.value,
                ...(inv
                  ? { currency: inv.currency, amount: String((inv.totalMinor - inv.paidMinor) / 10 ** minorDigits(inv.currency)) }
                  : {}),
              }))
            }}
          >
            <option value="">No invoice (credit)</option>
            {d.invoices
              .filter((i) => i.status === 'open')
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number} · {formatMinor(i.totalMinor - i.paidMinor, i.currency)} due
                </option>
              ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency" htmlFor="pay-currency">
            <Select id="pay-currency" value={form.currency} onChange={set('currency')}>
              {['GHS', 'XOF', 'USD'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" htmlFor="pay-amount" required>
            <Input id="pay-amount" inputMode="decimal" required value={form.amount || ''} onChange={set('amount')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method" htmlFor="pay-method">
            <Select id="pay-method" value={form.method} onChange={set('method')}>
              <option value="mobile_money">Mobile money</option>
              <option value="bank">Bank transfer</option>
              <option value="card">Card</option>
              <option value="manual">Other / manual</option>
            </Select>
          </Field>
          <Field label="Reference" htmlFor="pay-ref">
            <Input id="pay-ref" value={form.providerRef || ''} onChange={set('providerRef')} placeholder="MoMo or bank ref" />
          </Field>
        </div>
        <Field label="Note" htmlFor="pay-note">
          <Input id="pay-note" value={form.note || ''} onChange={set('note')} />
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'actas'}
        title="Start read-only support access"
        description="You see the tenant's app as they do, without write access. It is logged and ends automatically."
        submitLabel="Start"
        onClose={close}
        onSubmit={async () => {
          await startActAs({ companyId, reason: form.reason || '', minutes: Number(form.minutes) || 30, allowWrites: false })
          // Act-as follows the admin account, so it applies wherever they are signed in to the tenant app.
          const appUrl = process.env.NEXT_PUBLIC_TENANT_APP_URL
          if (appUrl) window.open(`${appUrl.replace(/\/$/, '')}/dashboard`, '_blank', 'noopener')
          else router.push('/dashboard')
          return 'Support access started; open the tenant app signed in as yourself'
        }}
      >
        <Field label="Reason (ticket or request)" htmlFor="actas-reason" required>
          <Input id="actas-reason" required value={form.reason || ''} onChange={set('reason')} />
        </Field>
        <Field label="Minutes" htmlFor="actas-minutes">
          <Input id="actas-minutes" type="number" min={1} max={120} value={form.minutes || ''} onChange={set('minutes')} />
        </Field>
      </ActionModal>
    </div>
  )
}

function Profile({ d }) {
  const exportUrl = useMutation(api.platform.tenants.exportUrl)
  const { showToast } = useToast()
  const c = d.company
  const download = async (id) => {
    try {
      const url = await exportUrl({ exportId: id })
      if (url) window.open(url, '_blank', 'noopener')
      else showToast('The file is not available', 'error')
    } catch (err) {
      showToast(errorMessage(err, 'Could not get the file'), 'error')
    }
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader title="Organization" />
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted">Contact email</dt><dd>{c.contactEmail || '—'}</dd></div>
          <div><dt className="text-muted">Phone</dt><dd>{c.contactPhone || '—'}</dd></div>
          <div><dt className="text-muted">Address</dt><dd>{c.address || '—'}</dd></div>
          <div><dt className="text-muted">Currency</dt><dd>{c.currency || '—'}</dd></div>
          <div><dt className="text-muted">Registered</dt><dd>{formatDate(c.createdAt)}</dd></div>
          <div><dt className="text-muted">Approved</dt><dd>{formatDate(c.approvedAt)}</dd></div>
          <div><dt className="text-muted">Last activity</dt><dd>{formatDateTime(d.lastActivityAt)}</dd></div>
          {c.suspendedAt && (
            <div className="col-span-2">
              <dt className="text-muted">Suspended</dt>
              <dd>
                {formatDateTime(c.suspendedAt)} ({c.suspensionSource}) — {c.suspensionReason}
              </dd>
            </div>
          )}
        </dl>
      </Card>
      <Card>
        <CardHeader title={`Sites (${d.sites.length})`} />
        <SimpleTable
          rows={d.sites}
          empty="No sites"
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'code', label: 'Code', render: (r) => r.code || '—' },
            { key: 'active', label: 'Status', render: (r) => (r.active ? 'Active' : 'Inactive') },
          ]}
        />
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title={`Members (${d.members.length})`} />
        <SimpleTable
          rowKey={(r) => r.userId}
          rows={d.members}
          empty="No members"
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email', render: (r) => r.email || '—' },
            { key: 'roleKey', label: 'Role' },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
          ]}
        />
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Data exports" />
        <SimpleTable
          rows={d.exports}
          empty="No exports yet"
          columns={[
            { key: 'createdAt', label: 'Requested', render: (r) => formatDateTime(r.createdAt) },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
            { key: 'size', label: 'Size', render: (r) => (r.sizeBytes ? `${Math.round(r.sizeBytes / 1024)} KB` : '—') },
            {
              key: 'dl',
              label: '',
              render: (r) =>
                r.status === 'ready' ? (
                  <Button size="sm" variant="secondary" onClick={() => download(r.id)}>
                    Download
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>
    </div>
  )
}

function Usage({ d }) {
  const days = d.usage
  const totals = useMemo(
    () =>
      days.reduce(
        (t, r) => ({
          dailyRecords: t.dailyRecords + r.dailyRecords,
          smsSent: t.smsSent + r.smsSent,
          whatsappSent: t.whatsappSent + r.whatsappSent,
          aiTokens: t.aiTokens + r.aiTokens,
          aiCostUsd: t.aiCostUsd + r.aiCostUsd,
        }),
        { dailyRecords: 0, smsSent: 0, whatsappSent: 0, aiTokens: 0, aiCostUsd: 0 },
      ),
    [days],
  )
  return (
    <Card>
      <CardHeader title="Usage, last 60 days" subtitle={`${totals.dailyRecords} records · ${totals.smsSent} SMS · ${totals.whatsappSent} WhatsApp · ${totals.aiTokens.toLocaleString()} AI tokens ($${totals.aiCostUsd.toFixed(2)})`} />
      <SimpleTable
        rowKey={(r) => r.date}
        rows={[...days].reverse()}
        empty="No usage rolled up yet (the rollup runs nightly)"
        columns={[
          { key: 'date', label: 'Date' },
          { key: 'dailyRecords', label: 'Records', align: 'right' },
          { key: 'activeUsers', label: 'Active users', align: 'right' },
          { key: 'smsSent', label: 'SMS', align: 'right' },
          { key: 'whatsappSent', label: 'WhatsApp', align: 'right' },
          { key: 'aiCalls', label: 'AI calls', align: 'right' },
          { key: 'aiTokens', label: 'AI tokens', align: 'right' },
          { key: 'aiCostUsd', label: 'AI cost', align: 'right', render: (r) => `$${r.aiCostUsd.toFixed(2)}` },
        ]}
      />
    </Card>
  )
}

function Billing({ d }) {
  const s = d.subscription
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Subscription" />
        {!s ? (
          <p className="text-sm text-muted">No subscription: the tenant has no plan limits.</p>
        ) : (
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div><dt className="text-muted">Plan</dt><dd>{s.planName} ({s.planCode})</dd></div>
            <div><dt className="text-muted">Status</dt><dd><StatusPill status={s.status} /></dd></div>
            <div><dt className="text-muted">Period</dt><dd>{formatDate(s.currentPeriodStart)} – {formatDate(s.currentPeriodEnd)}</dd></div>
            <div><dt className="text-muted">Trial ends</dt><dd>{formatDate(s.trialEndsAt)}</dd></div>
            <div><dt className="text-muted">Grace ends</dt><dd>{formatDate(s.graceEndsAt)}</dd></div>
            <div><dt className="text-muted">Currency</dt><dd>{s.currency}</dd></div>
            <div><dt className="text-muted">Provider</dt><dd>{s.provider}</dd></div>
            <div><dt className="text-muted">Credits granted</dt><dd>{s.aiCreditsGranted} AI · {s.smsCreditsGranted} SMS</dd></div>
          </dl>
        )}
      </Card>
      <Card>
        <CardHeader title="Invoices" />
        <SimpleTable
          rows={d.invoices}
          empty="No invoices"
          columns={[
            { key: 'number', label: 'Number' },
            { key: 'issuedAt', label: 'Issued', render: (r) => formatDate(r.issuedAt) },
            { key: 'dueAt', label: 'Due', render: (r) => formatDate(r.dueAt) },
            { key: 'total', label: 'Total', align: 'right', render: (r) => formatMinor(r.totalMinor, r.currency) },
            { key: 'paid', label: 'Paid', align: 'right', render: (r) => formatMinor(r.paidMinor, r.currency) },
            { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Payments" />
        <SimpleTable
          rows={d.payments}
          empty="No payments"
          columns={[
            { key: 'receivedAt', label: 'Received', render: (r) => formatDate(r.receivedAt) },
            { key: 'amount', label: 'Amount', align: 'right', render: (r) => formatMinor(r.amountMinor, r.currency) },
            { key: 'method', label: 'Method', render: (r) => r.method.replace('_', ' ') },
            { key: 'providerRef', label: 'Reference', render: (r) => r.providerRef || '—' },
          ]}
        />
      </Card>
    </div>
  )
}

const LIMIT_KEYS = ['sites', 'users', 'units', 'aiCredits', 'smsIncluded']

function Limits({ d }) {
  const setOverrides = useMutation(api.platform.tenants.setOverrides)
  const { showToast } = useToast()
  const s = d.subscription
  const [limits, setLimits] = useState(() =>
    Object.fromEntries(LIMIT_KEYS.map((k) => [k, s?.limitOverrides?.[k] ?? ''])),
  )
  const [features, setFeatures] = useState(() => ({ ...(s?.featureOverrides || {}) }))
  const save = async () => {
    const lo = {}
    for (const k of LIMIT_KEYS) if (limits[k] !== '' && limits[k] !== null) lo[k] = Number(limits[k])
    try {
      await setOverrides({
        companyId: d.company.companyId,
        limitOverrides: Object.keys(lo).length ? lo : null,
        featureOverrides: Object.keys(features).length ? features : null,
      })
      showToast('Overrides saved', 'success')
    } catch (err) {
      showToast(errorMessage(err, 'Could not save overrides'), 'error')
    }
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader title="Usage vs limits" subtitle="Effective limits: plan plus overrides" />
        <SimpleTable
          rowKey={(r) => r.kind}
          rows={d.limits}
          columns={[
            { key: 'label', label: 'Limit' },
            { key: 'used', label: 'Used', align: 'right' },
            { key: 'max', label: 'Max', align: 'right', render: (r) => (r.max === null ? 'Unlimited' : r.max) },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Overrides" subtitle="Blank uses the plan's value" action={s && <Button size="sm" onClick={save}>Save overrides</Button>} />
        {!s ? (
          <p className="text-sm text-muted">Give the tenant a plan first.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {LIMIT_KEYS.map((k) => (
                <Field key={k} label={k} htmlFor={`lim-${k}`}>
                  <Input
                    id={`lim-${k}`}
                    type="number"
                    min={0}
                    value={limits[k]}
                    onChange={(e) => setLimits((l) => ({ ...l, [k]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
            <fieldset>
              <legend className="text-sm font-medium mb-2">Features</legend>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.keys(d.features).map((f) => (
                  <label key={f} className="flex items-center gap-2">
                    <Select
                      aria-label={f}
                      className="!min-h-9 !py-1 w-28"
                      value={features[f] === undefined ? '' : String(features[f])}
                      onChange={(e) =>
                        setFeatures((x) => {
                          const n = { ...x }
                          if (e.target.value === '') delete n[f]
                          else n[f] = e.target.value === 'true'
                          return n
                        })
                      }
                    >
                      <option value="">Plan ({d.features[f] ? 'on' : 'off'})</option>
                      <option value="true">On</option>
                      <option value="false">Off</option>
                    </Select>
                    {f.replace(/_/g, ' ')}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </Card>
    </div>
  )
}

function Notes({ d }) {
  const addNote = useMutation(api.platform.tenants.addNote)
  const { showToast } = useToast()
  const [body, setBody] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    try {
      await addNote({ companyId: d.company.companyId, body })
      setBody('')
    } catch (err) {
      showToast(errorMessage(err, 'Could not add the note'), 'error')
    }
  }
  return (
    <Card>
      <CardHeader title="Internal notes" subtitle="Visible to platform admins only" />
      <form onSubmit={submit} className="flex gap-2 mb-4">
        <Textarea aria-label="New note" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
        <Button type="submit" disabled={!body.trim()}>
          Add
        </Button>
      </form>
      <ul className="space-y-3">
        {d.notes.map((n) => (
          <li key={n.id} className="text-sm border-b border-foam-deep pb-2">
            <p className="whitespace-pre-wrap">{n.body}</p>
            <p className="text-xs text-muted mt-1">
              {n.author} · {formatDateTime(n.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Audit({ d }) {
  return (
    <Card>
      <CardHeader title="Platform actions on this tenant" action={<Link className="text-sm text-lake hover:underline" href={`/platform/audit?companyId=${d.company.companyId}`}>Full log</Link>} />
      <SimpleTable
        rows={d.events}
        empty="No platform actions yet"
        columns={[
          { key: 'at', label: 'When', render: (r) => formatDateTime(r.at) },
          { key: 'action', label: 'Action' },
          { key: 'actor', label: 'By', render: (r) => r.actor || 'System' },
          { key: 'details', label: 'Details', render: (r) => <code className="text-xs break-all">{r.details ? JSON.stringify(r.details) : ''}</code> },
        ]}
      />
    </Card>
  )
}

function TenantDetail({ id }) {
  const d = useQuery(api.platform.tenants.detail, { companyId: id })
  const [tab, setTab] = useState('profile')
  if (d === undefined) return <LoadingState label="Loading tenant…" />
  if (d === null) return <p className="text-muted">Tenant not found.</p>
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl">{d.company.name}</h2>
        <StatusPill status={d.company.state} />
        {d.subscription && (
          <span className="text-sm text-muted">
            {d.subscription.planName} · <StatusPill status={d.subscription.status} />
          </span>
        )}
      </div>
      <Actions d={d} />
      <TabBar tabs={TABS} active={tab} onChange={setTab} label="Tenant sections" />
      {tab === 'profile' && <Profile d={d} />}
      {tab === 'usage' && <Usage d={d} />}
      {tab === 'billing' && <Billing d={d} />}
      {tab === 'limits' && <Limits key={d.subscription?.subscriptionId || 'none'} d={d} />}
      {tab === 'notes' && <Notes d={d} />}
      {tab === 'audit' && <Audit d={d} />}
    </div>
  )
}

export default function PlatformTenantPage() {
  const router = useRouter()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  return (
    <PlatformLayout title="Tenant">
      <p className="text-sm mb-4">
        <Link className="text-lake hover:underline" href="/platform/tenants">
          ← All tenants
        </Link>
      </p>
      {id ? <TenantDetail id={id} /> : <LoadingState />}
    </PlatformLayout>
  )
}
