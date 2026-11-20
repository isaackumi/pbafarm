import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import PlatformLayout, { ConsoleHeader, SimpleTable, StatusPill } from '../../../components/platform/PlatformLayout'
import { Badge, Button, Field, GhostButton, Input, LoadingState, Modal, Select, SolidButton, StatusDot, SummaryCard, Tabs, Textarea } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { errorMessage } from '../../../lib/errorMessage'
import { formatDate, formatDateTime, formatMinor, minorDigits, toMinor } from '../../../lib/billingFormat'
import { balanceDue } from '../../../lib/billingBalance'
import { useT } from '../../../lib/i18n/context'
import { daysUntil, limitOf, nextOpenInvoice, tenantStatus } from '../../../lib/platformConsole'

const TABS = ['invoices', 'subscription', 'members', 'usage', 'audit', 'limits', 'notes', 'profile']
const CURRENCIES = ['GHS', 'XOF', 'USD']
const DOT_TONE = { good: 'good', warn: 'warn', alert: 'alert', cyan: 'neutral', neutral: 'neutral' }
const SUMMARY_TONE = { good: 'good', warn: 'warn', alert: 'alert', cyan: 'cyan', neutral: 'default' }
const DAY = 24 * 60 * 60 * 1000

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

/** One modal form per action; `onSubmit` returns a success message. */
function ActionModal({ open, title, description, submitLabel, danger, onClose, onSubmit, children }) {
  const t = useT()
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
      showToast(errorMessage(err, t('platform.detail.failed')), 'error')
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
            {t('platform.modal.cancel')}
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy}>
            {busy ? t('platform.modal.working') : submitLabel || t('platform.modal.save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Every console action on a tenant, as modals. `useTenantActions` returns
 * `show(name)` for the buttons spread across the page (header, subscription
 * card, invoices tab) plus the modal elements to render once.
 */
function useTenantActions(d) {
  const t = useT()
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
  const close = () => setOpen(null)
  const currency = d.subscription?.currency || d.company.currency || 'GHS'
  const initial = {
    reject: {},
    suspend: {},
    reactivate: { graceDays: '7' },
    plan: { planId: d.subscription?.planId || '', status: 'active' },
    trial: { days: '14' },
    credits: { kind: 'ai', amount: '100' },
    invoice: { currency, description: t('platform.modal.subscription'), amount: '', dueInDays: '7', renews: 'yes' },
    payment: { currency, method: 'mobile_money', invoiceId: '', amount: '' },
    actas: { minutes: '30' },
  }
  const show = (name) => {
    setForm({ ...initial[name], key: newKey() })
    setOpen(name)
  }
  const run = async (fn, msg) => {
    try {
      await fn()
      showToast(msg, 'success')
    } catch (err) {
      showToast(errorMessage(err, t('platform.detail.failed')), 'error')
    }
  }
  const doApprove = () => run(() => approve({ companyId }), t('platform.detail.approved'))
  const doExport = () => run(() => requestExport({ companyId }), t('platform.detail.exportStarted'))

  const modals = (
    <>
      <ActionModal
        open={open === 'reject'}
        title={t('platform.modal.rejectTitle')}
        danger
        submitLabel={t('platform.detail.reject')}
        onClose={close}
        onSubmit={async () => {
          await reject({ companyId, reason: form.reason || '' })
          return t('platform.modal.rejected')
        }}
      >
        <Field label={t('platform.modal.reason')} htmlFor="reject-reason" required>
          <Textarea id="reject-reason" required value={form.reason || ''} onChange={set('reason')} />
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'suspend'}
        title={t('platform.modal.suspendTitle', { name: d.company.name })}
        description={t('platform.modal.suspendHint')}
        danger
        submitLabel={t('platform.detail.suspend')}
        onClose={close}
        onSubmit={async () => {
          const r = await suspend({ companyId, reason: form.reason || '' })
          return t('platform.modal.suspended', { count: r.sessionsRevoked })
        }}
      >
        <Field label={t('platform.modal.reasonShown')} htmlFor="suspend-reason" required>
          <Textarea id="suspend-reason" required minLength={3} value={form.reason || ''} onChange={set('reason')} />
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'reactivate'}
        title={t('platform.modal.reactivateTitle', { name: d.company.name })}
        description={t('platform.modal.reactivateHint')}
        submitLabel={t('platform.detail.reactivate')}
        onClose={close}
        onSubmit={async () => {
          await reactivate({ companyId, graceDays: Number(form.graceDays) || undefined })
          return t('platform.modal.reactivated')
        }}
      >
        <Field label={t('platform.modal.graceDays')} htmlFor="grace-days">
          <Input id="grace-days" type="number" min={1} max={60} value={form.graceDays || ''} onChange={set('graceDays')} />
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'plan'}
        title={t('platform.detail.changePlan')}
        onClose={close}
        onSubmit={async () => {
          await changePlan({ companyId, planId: form.planId, status: form.status })
          return t('platform.modal.planChanged')
        }}
      >
        <Field label={t('platform.modal.plan')} htmlFor="plan-id" required>
          <Select id="plan-id" required value={form.planId || ''} onChange={set('planId')}>
            <option value="">{t('platform.modal.choosePlan')}</option>
            {(plans ?? [])
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('platform.modal.status')} htmlFor="plan-status">
          <Select id="plan-status" value={form.status} onChange={set('status')}>
            <option value="active">{t('platform.modal.statusActive')}</option>
            <option value="trialing">{t('platform.modal.statusTrialing')}</option>
          </Select>
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'trial'}
        title={t('platform.detail.extendTrial')}
        onClose={close}
        onSubmit={async () => {
          const ends = await extendTrial({ companyId, days: Number(form.days) })
          return t('platform.modal.trialExtended', { date: formatDate(ends) })
        }}
      >
        <Field label={t('platform.modal.extraDays')} htmlFor="trial-days" required>
          <Input id="trial-days" type="number" min={1} max={90} required value={form.days || ''} onChange={set('days')} />
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'credits'}
        title={t('platform.detail.grantCredits')}
        onClose={close}
        onSubmit={async () => {
          await grantCredits({ companyId, kind: form.kind, amount: Number(form.amount), reason: form.reason || '' })
          return t('platform.modal.creditsGranted')
        }}
      >
        <Field label={t('platform.modal.kind')} htmlFor="credit-kind">
          <Select id="credit-kind" value={form.kind} onChange={set('kind')}>
            <option value="ai">{t('platform.modal.aiCredits')}</option>
            <option value="sms">{t('platform.modal.smsCredits')}</option>
          </Select>
        </Field>
        <Field label={t('platform.modal.amount')} htmlFor="credit-amount" required>
          <Input id="credit-amount" type="number" min={1} required value={form.amount || ''} onChange={set('amount')} />
        </Field>
        <Field label={t('platform.modal.reason')} htmlFor="credit-reason" required>
          <Input id="credit-reason" required value={form.reason || ''} onChange={set('reason')} />
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'invoice'}
        title={t('platform.detail.createInvoice')}
        onClose={close}
        onSubmit={async () => {
          const unit = toMinor(form.amount, form.currency)
          if (unit === null) throw new Error(t('platform.modal.invalidAmount'))
          const r = await createInvoice({
            companyId,
            currency: form.currency,
            lines: [{ description: form.description || t('platform.modal.subscription'), quantity: 1, unitAmountMinor: unit }],
            dueInDays: Number(form.dueInDays) || 7,
            renewsSubscription: form.renews === 'yes',
          })
          return t('platform.modal.invoiceCreated', { number: r.number })
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('platform.modal.currency')} htmlFor="inv-currency">
            <Select id="inv-currency" value={form.currency} onChange={set('currency')}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('platform.modal.amount')} htmlFor="inv-amount" required>
            <Input id="inv-amount" inputMode="decimal" required value={form.amount || ''} onChange={set('amount')} />
          </Field>
        </div>
        <Field label={t('platform.modal.description')} htmlFor="inv-desc">
          <Input id="inv-desc" value={form.description || ''} onChange={set('description')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('platform.modal.dueInDays')} htmlFor="inv-due">
            <Input id="inv-due" type="number" min={0} max={90} value={form.dueInDays || ''} onChange={set('dueInDays')} />
          </Field>
          <Field label={t('platform.modal.renews')} htmlFor="inv-renews">
            <Select id="inv-renews" value={form.renews} onChange={set('renews')}>
              <option value="yes">{t('platform.modal.yes')}</option>
              <option value="no">{t('platform.modal.noOneOff')}</option>
            </Select>
          </Field>
        </div>
      </ActionModal>

      <ActionModal
        open={open === 'payment'}
        title={t('platform.detail.recordPayment')}
        description={t('platform.modal.paymentHint')}
        onClose={close}
        onSubmit={async () => {
          const amountMinor = toMinor(form.amount, form.currency)
          if (!amountMinor) throw new Error(t('platform.modal.invalidAmount'))
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
            ? t('platform.modal.paymentDuplicate')
            : r.reactivated
              ? t('platform.modal.paymentReactivated')
              : r.invoicePaid
                ? t('platform.modal.paymentInvoicePaid')
                : t('platform.modal.paymentRecorded')
        }}
      >
        <Field label={t('platform.modal.invoice')} htmlFor="pay-invoice">
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
            <option value="">{t('platform.modal.noInvoice')}</option>
            {d.invoices
              .filter((i) => i.status === 'open')
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {t('platform.modal.invoiceDue', { number: i.number, amount: formatMinor(i.totalMinor - i.paidMinor, i.currency) })}
                </option>
              ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('platform.modal.currency')} htmlFor="pay-currency">
            <Select id="pay-currency" value={form.currency} onChange={set('currency')}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('platform.modal.amount')} htmlFor="pay-amount" required>
            <Input id="pay-amount" inputMode="decimal" required value={form.amount || ''} onChange={set('amount')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('platform.modal.method')} htmlFor="pay-method">
            <Select id="pay-method" value={form.method} onChange={set('method')}>
              {['mobile_money', 'bank', 'card', 'manual'].map((m) => (
                <option key={m} value={m}>
                  {t(`platform.method.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('platform.modal.reference')} htmlFor="pay-ref">
            <Input id="pay-ref" value={form.providerRef || ''} onChange={set('providerRef')} placeholder={t('platform.modal.referenceHint')} />
          </Field>
        </div>
        <Field label={t('platform.modal.note')} htmlFor="pay-note">
          <Input id="pay-note" value={form.note || ''} onChange={set('note')} />
        </Field>
      </ActionModal>

      <ActionModal
        open={open === 'actas'}
        title={t('platform.modal.actAsTitle')}
        description={t('platform.modal.actAsHint')}
        submitLabel={t('platform.modal.start')}
        onClose={close}
        onSubmit={async () => {
          await startActAs({ companyId, reason: form.reason || '', minutes: Number(form.minutes) || 30, allowWrites: false })
          // Act-as follows the admin account, so it applies wherever they are signed in to the tenant app.
          const appUrl = process.env.NEXT_PUBLIC_TENANT_APP_URL
          if (appUrl) window.open(`${appUrl.replace(/\/$/, '')}/dashboard`, '_blank', 'noopener')
          else router.push('/dashboard')
          return t('platform.modal.actAsStarted')
        }}
      >
        <Field label={t('platform.modal.actAsReason')} htmlFor="actas-reason" required>
          <Input id="actas-reason" required value={form.reason || ''} onChange={set('reason')} />
        </Field>
        <Field label={t('platform.modal.minutes')} htmlFor="actas-minutes">
          <Input id="actas-minutes" type="number" min={1} max={120} value={form.minutes || ''} onChange={set('minutes')} />
        </Field>
      </ActionModal>
    </>
  )
  return { show, doApprove, doExport, modals }
}

function StatusStrip({ d, now }) {
  const t = useT()
  const s = d.subscription
  const status = tenantStatus(d.company.state, s?.status ?? 'none')
  const statusSub =
    d.company.state === 'suspended'
      ? d.company.suspensionReason || t(`platform.detail.suspendedBy.${d.company.suspensionSource || 'platform'}`)
      : s?.status === 'past_due' && s.graceEndsAt
        ? t('platform.detail.suspendsIn', { count: daysUntil(s.graceEndsAt, now) })
        : s?.status === 'trialing' && s.trialEndsAt
          ? t('platform.detail.trialEnds', { date: formatDate(s.trialEndsAt) })
          : s?.status === 'active'
            ? t('platform.detail.renews', { date: formatDate(s.currentPeriodEnd) })
            : null
  const due = balanceDue(d.invoices)
  const next = nextOpenInvoice(d.invoices)
  const lim = (kind) => limitOf(d.limits, kind)
  const kinds = ['sites', 'units', 'users']
  const used = kinds.map((k) => lim(k)?.used ?? 0).join(' · ')
  const maxes = kinds.map((k) => (lim(k)?.max == null ? '∞' : lim(k).max)).join(' · ')
  const week = d.usage.filter((u) => u.date >= new Date(now - 7 * DAY).toISOString().slice(0, 10))
  const records7d = week.reduce((n, u) => n + u.dailyRecords, 0)
  const wa7d = week.reduce((n, u) => n + u.whatsappSent, 0)

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:flex">
      <SummaryCard
        size="md"
        label={t('platform.detail.status')}
        tone={SUMMARY_TONE[status.tone]}
        value={
          <>
            <StatusDot tone={DOT_TONE[status.tone]} size={8} />
            {t(`platform.status.${status.key}`)}
          </>
        }
        sub={statusSub}
      />
      <SummaryCard
        size="md"
        label={t('platform.detail.balanceDue')}
        value={due.length ? due.map(([c, m]) => formatMinor(m, c)).join(' · ') : formatMinor(0, d.subscription?.currency || d.company.currency || 'GHS')}
        sub={next ? t('platform.detail.nextInvoice', { number: next.number, date: formatDate(next.dueAt) }) : t('platform.detail.nothingDue')}
      />
      <SummaryCard size="md" label={t('platform.detail.sitesCagesUsers')} value={used} sub={t('platform.detail.limits', { limits: maxes })} />
      <SummaryCard
        size="md"
        label={t('platform.detail.lastActivity')}
        value={d.lastActivityAt ? formatDateTime(d.lastActivityAt) : '—'}
        sub={t('platform.detail.activity7d', { records: records7d, whatsapp: wa7d })}
      />
    </div>
  )
}

function invoiceBadge(t, inv, now) {
  if (inv.status === 'open' && inv.dueAt < now) {
    return <Badge tone="warn">{t('platform.detail.overdue', { count: Math.max(1, Math.floor((now - inv.dueAt) / DAY)) })}</Badge>
  }
  const tone = { paid: 'good', open: 'cyan', void: 'neutral', uncollectible: 'alert' }[inv.status] || 'neutral'
  return <Badge tone={tone}>{t(`billing.invoiceStatus.${inv.status}`)}</Badge>
}

function InvoicesTab({ d, now, onCreate, canBill }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <SimpleTable
        rows={d.invoices}
        empty={t('platform.detail.noInvoices')}
        columns={[
          { key: 'number', label: t('platform.detail.col.invoice'), render: (r) => <span className="font-medium">{r.number}</span> },
          { key: 'issuedAt', label: t('platform.detail.col.issued'), render: (r) => <span className="text-muted">{formatDate(r.issuedAt)}</span> },
          { key: 'total', label: t('platform.detail.col.amount'), align: 'right', render: (r) => formatMinor(r.totalMinor, r.currency) },
          { key: 'paid', label: t('platform.detail.col.paid'), align: 'right', render: (r) => formatMinor(r.paidMinor, r.currency) },
          { key: 'dueAt', label: t('platform.detail.col.due'), render: (r) => <span className="text-muted">{formatDate(r.dueAt)}</span> },
          { key: 'status', label: t('platform.detail.col.status'), render: (r) => invoiceBadge(t, r, now) },
        ]}
      />
      <div>
        <h3 className="mb-1 text-[11px] uppercase leading-[14px] tracking-[0.08em] text-muted">{t('platform.detail.payments')}</h3>
        <SimpleTable
          rows={d.payments}
          empty={t('platform.detail.noPayments')}
          columns={[
            { key: 'receivedAt', label: t('platform.detail.col.received'), render: (r) => formatDate(r.receivedAt) },
            { key: 'amount', label: t('platform.detail.col.amount'), align: 'right', render: (r) => formatMinor(r.amountMinor, r.currency) },
            { key: 'method', label: t('platform.detail.col.method'), render: (r) => t(`platform.method.${r.method}`) },
            { key: 'providerRef', label: t('platform.detail.col.reference'), render: (r) => r.providerRef || '—' },
          ]}
        />
      </div>
      {canBill ? (
        <div className="flex flex-wrap gap-2">
          <GhostButton onClick={onCreate}>{t('platform.detail.createInvoice')}</GhostButton>
        </div>
      ) : null}
    </div>
  )
}

function SubscriptionTab({ d }) {
  const t = useT()
  const s = d.subscription
  if (!s) return <p className="text-sm text-muted">{t('platform.detail.noSubscription')}</p>
  const rows = [
    [t('platform.detail.plan'), `${s.planName} (${s.planCode})`],
    [t('platform.detail.status'), <StatusPill key="s" status={s.status} />],
    [t('platform.detail.period'), `${formatDate(s.currentPeriodStart)} – ${formatDate(s.currentPeriodEnd)}`],
    [t('platform.detail.trialEndsLabel'), formatDate(s.trialEndsAt)],
    [t('platform.detail.graceEnds'), formatDate(s.graceEndsAt)],
    [t('platform.detail.currency'), s.currency],
    [t('platform.detail.provider'), s.provider],
    [t('platform.detail.seats'), s.seats ?? '—'],
    [t('platform.detail.creditsGranted'), t('platform.detail.credits', { ai: s.aiCreditsGranted, sms: s.smsCreditsGranted })],
  ]
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-line pb-3">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right text-text">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function MembersTab({ d }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-6">
      <SimpleTable
        rowKey={(r) => r.userId}
        rows={d.members}
        empty={t('platform.detail.noMembers')}
        columns={[
          { key: 'name', label: t('platform.detail.col.name') },
          { key: 'email', label: t('platform.detail.col.email'), render: (r) => r.email || '—' },
          { key: 'roleKey', label: t('platform.detail.col.role') },
          { key: 'status', label: t('platform.detail.col.status'), render: (r) => <StatusPill status={r.status} /> },
        ]}
      />
      <div>
        <h3 className="mb-1 text-[11px] uppercase leading-[14px] tracking-[0.08em] text-muted">
          {t('platform.detail.sites', { count: d.sites.length })}
        </h3>
        <SimpleTable
          rows={d.sites}
          empty={t('platform.detail.noSites')}
          columns={[
            { key: 'name', label: t('platform.detail.col.name') },
            { key: 'code', label: t('platform.detail.col.code'), render: (r) => r.code || '—' },
            {
              key: 'active',
              label: t('platform.detail.col.status'),
              render: (r) => <Badge tone={r.active ? 'good' : 'neutral'}>{t(r.active ? 'platform.detail.siteActive' : 'platform.detail.siteInactive')}</Badge>,
            },
          ]}
        />
      </div>
    </div>
  )
}

function UsageTab({ d }) {
  const t = useT()
  const days = d.usage
  const totals = useMemo(
    () =>
      days.reduce(
        (acc, r) => ({
          dailyRecords: acc.dailyRecords + r.dailyRecords,
          smsSent: acc.smsSent + r.smsSent,
          whatsappSent: acc.whatsappSent + r.whatsappSent,
          aiTokens: acc.aiTokens + r.aiTokens,
          aiCostUsd: acc.aiCostUsd + r.aiCostUsd,
        }),
        { dailyRecords: 0, smsSent: 0, whatsappSent: 0, aiTokens: 0, aiCostUsd: 0 },
      ),
    [days],
  )
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {t('platform.detail.usageTotals', {
          records: totals.dailyRecords,
          sms: totals.smsSent,
          whatsapp: totals.whatsappSent,
          tokens: totals.aiTokens.toLocaleString(),
          cost: `$${totals.aiCostUsd.toFixed(2)}`,
        })}
      </p>
      <SimpleTable
        rowKey={(r) => r.date}
        rows={[...days].reverse()}
        empty={t('platform.detail.noUsage')}
        columns={[
          { key: 'date', label: t('platform.detail.col.date') },
          { key: 'dailyRecords', label: t('platform.detail.col.records'), align: 'right' },
          { key: 'activeUsers', label: t('platform.detail.col.activeUsers'), align: 'right' },
          { key: 'smsSent', label: 'SMS', align: 'right' },
          { key: 'whatsappSent', label: 'WhatsApp', align: 'right' },
          { key: 'aiCalls', label: t('platform.detail.col.aiCalls'), align: 'right' },
          { key: 'aiTokens', label: t('platform.detail.col.aiTokens'), align: 'right' },
          { key: 'aiCostUsd', label: t('platform.detail.col.aiCost'), align: 'right', render: (r) => `$${r.aiCostUsd.toFixed(2)}` },
        ]}
      />
    </div>
  )
}

const LIMIT_KEYS = ['sites', 'users', 'units', 'aiCredits', 'smsIncluded']

function LimitsTab({ d }) {
  const t = useT()
  const setOverrides = useMutation(api.platform.tenants.setOverrides)
  const { showToast } = useToast()
  const s = d.subscription
  const [limits, setLimits] = useState(() => Object.fromEntries(LIMIT_KEYS.map((k) => [k, s?.limitOverrides?.[k] ?? ''])))
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
      showToast(t('platform.detail.overridesSaved'), 'success')
    } catch (err) {
      showToast(errorMessage(err, t('platform.detail.failed')), 'error')
    }
  }
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold text-text">{t('platform.detail.usageVsLimits')}</h3>
        <p className="mb-2 text-xs text-muted">{t('platform.detail.effectiveLimits')}</p>
        <SimpleTable
          rowKey={(r) => r.kind}
          rows={d.limits}
          columns={[
            { key: 'label', label: t('platform.detail.col.limit') },
            { key: 'used', label: t('platform.detail.col.used'), align: 'right' },
            { key: 'max', label: t('platform.detail.col.max'), align: 'right', render: (r) => (r.max === null ? t('platform.detail.unlimited') : r.max) },
          ]}
        />
      </div>
      <div>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text">{t('platform.detail.overrides')}</h3>
            <p className="text-xs text-muted">{t('platform.detail.overridesHint')}</p>
          </div>
          {s ? (
            <GhostButton size="sm" onClick={save}>
              {t('platform.detail.saveOverrides')}
            </GhostButton>
          ) : null}
        </div>
        {!s ? (
          <p className="text-sm text-muted">{t('platform.detail.planFirst')}</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {LIMIT_KEYS.map((k) => (
                <Field key={k} label={k} htmlFor={`lim-${k}`}>
                  <Input id={`lim-${k}`} type="number" min={0} value={limits[k]} onChange={(e) => setLimits((l) => ({ ...l, [k]: e.target.value }))} />
                </Field>
              ))}
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-text">{t('platform.detail.features')}</legend>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                {Object.keys(d.features).map((f) => (
                  <label key={f} className="flex items-center gap-2 text-text">
                    <Select
                      aria-label={f}
                      size="sm"
                      className="w-28"
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
                      <option value="">{t(d.features[f] ? 'platform.detail.planOn' : 'platform.detail.planOff')}</option>
                      <option value="true">{t('platform.detail.on')}</option>
                      <option value="false">{t('platform.detail.off')}</option>
                    </Select>
                    {f.replace(/_/g, ' ')}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </div>
    </div>
  )
}

function NotesTab({ d }) {
  const t = useT()
  const addNote = useMutation(api.platform.tenants.addNote)
  const { showToast } = useToast()
  const [body, setBody] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    try {
      await addNote({ companyId: d.company.companyId, body })
      setBody('')
    } catch (err) {
      showToast(errorMessage(err, t('platform.detail.failed')), 'error')
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">{t('platform.detail.notesHint')}</p>
      <form onSubmit={submit} className="flex items-start gap-2">
        <Textarea aria-label={t('platform.detail.newNote')} rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
        <GhostButton type="submit" disabled={!body.trim()}>
          {t('platform.detail.addNote')}
        </GhostButton>
      </form>
      <ul className="flex flex-col">
        {d.notes.map((n) => (
          <li key={n.id} className="border-t border-line py-3 text-sm">
            <p className="whitespace-pre-wrap text-text">{n.body}</p>
            <p className="mt-1 text-xs text-muted">
              {n.author} · {formatDateTime(n.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AuditTab({ d }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <Link className="self-end text-sm text-pearl-cyan hover:underline" href={`/platform/audit?companyId=${d.company.companyId}`}>
        {t('platform.detail.fullLog')}
      </Link>
      <SimpleTable
        rows={d.events}
        empty={t('platform.detail.noEvents')}
        columns={[
          { key: 'at', label: t('platform.detail.col.when'), render: (r) => formatDateTime(r.at) },
          { key: 'action', label: t('platform.detail.col.action') },
          { key: 'actor', label: t('platform.detail.col.by'), render: (r) => r.actor || t('platform.detail.system') },
          {
            key: 'details',
            label: t('platform.detail.col.details'),
            render: (r) => <code className="break-all text-xs text-muted">{r.details ? JSON.stringify(r.details) : ''}</code>,
          },
        ]}
      />
    </div>
  )
}

function ProfileTab({ d, onExport, canManage }) {
  const t = useT()
  const exportUrl = useMutation(api.platform.tenants.exportUrl)
  const { showToast } = useToast()
  const c = d.company
  const download = async (id) => {
    try {
      const url = await exportUrl({ exportId: id })
      if (url) window.open(url, '_blank', 'noopener')
      else showToast(t('platform.detail.fileUnavailable'), 'error')
    } catch (err) {
      showToast(errorMessage(err, t('platform.detail.failed')), 'error')
    }
  }
  const facts = [
    [t('platform.detail.contactEmail'), c.contactEmail || '—'],
    [t('platform.detail.phone'), c.contactPhone || '—'],
    [t('platform.detail.address'), c.address || '—'],
    [t('platform.detail.currency'), c.currency || '—'],
    [t('platform.detail.registered'), formatDate(c.createdAt)],
    [t('platform.detail.approvedAt'), formatDate(c.approvedAt)],
  ]
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {facts.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-line pb-3">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right text-text">{v}</dd>
          </div>
        ))}
        {c.suspendedAt ? (
          <div className="flex justify-between gap-3 border-b border-line pb-3 sm:col-span-2">
            <dt className="text-muted">{t('platform.detail.suspendedAt')}</dt>
            <dd className="text-right text-alert">
              {formatDateTime(c.suspendedAt)} ({c.suspensionSource}) — {c.suspensionReason}
            </dd>
          </div>
        ) : null}
      </dl>
      <div>
        <div className="mb-1 flex items-center justify-between gap-3">
          <h3 className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-muted">{t('platform.detail.exports')}</h3>
          {canManage ? (
            <GhostButton size="sm" onClick={onExport}>
              {t('platform.detail.exportData')}
            </GhostButton>
          ) : null}
        </div>
        <SimpleTable
          rows={d.exports}
          empty={t('platform.detail.noExports')}
          columns={[
            { key: 'createdAt', label: t('platform.detail.col.requested'), render: (r) => formatDateTime(r.createdAt) },
            { key: 'status', label: t('platform.detail.col.status'), render: (r) => <StatusPill status={r.status} /> },
            { key: 'size', label: t('platform.detail.col.size'), render: (r) => (r.sizeBytes ? `${Math.round(r.sizeBytes / 1024)} KB` : '—') },
            {
              key: 'dl',
              label: '',
              render: (r) =>
                r.status === 'ready' ? (
                  <GhostButton size="sm" onClick={() => download(r.id)}>
                    {t('platform.detail.download')}
                  </GhostButton>
                ) : null,
            },
          ]}
        />
      </div>
    </div>
  )
}

function SubscriptionCard({ d, show, canManage }) {
  const t = useT()
  const s = d.subscription
  const owner = d.members.find((m) => m.roleKey === 'owner')
  const rows = s
    ? [
        [t('platform.detail.plan'), s.planName],
        [t('platform.detail.period'), `${formatDate(s.currentPeriodStart)} – ${formatDate(s.currentPeriodEnd)}`],
        [t('platform.detail.billingContact'), owner ? `${owner.name} · ${owner.roleKey}` : d.company.contactEmail || '—'],
      ]
    : []
  return (
    <section aria-labelledby="sub-card" className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-5">
      <h2 id="sub-card" className="text-[15px] font-semibold leading-[18px] text-text">
        {t('platform.detail.subscription')}
      </h2>
      {s ? (
        <dl className="flex flex-col gap-3">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 text-[13px] leading-4">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right text-text">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted">{t('platform.detail.noSubscription')}</p>
      )}
      {canManage ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <GhostButton size="sm" onClick={() => show('plan')}>
            {t('platform.detail.changePlan')}
          </GhostButton>
          {s?.status === 'trialing' ? (
            <GhostButton size="sm" onClick={() => show('trial')}>
              {t('platform.detail.extendTrial')}
            </GhostButton>
          ) : null}
          <GhostButton size="sm" onClick={() => show('credits')}>
            {t('platform.detail.grantCredits')}
          </GhostButton>
        </div>
      ) : null}
    </section>
  )
}

function RecentActivity({ d }) {
  const t = useT()
  const recent = d.events.slice(0, 5)
  return (
    <section aria-labelledby="recent-activity" className="flex flex-col gap-[10px] rounded-[12px] border border-line bg-surface p-5">
      <h2 id="recent-activity" className="text-[15px] font-semibold leading-[18px] text-text">
        {t('platform.detail.recentActivity')}
      </h2>
      {recent.length === 0 ? (
        <p className="text-xs leading-[18px] text-muted">{t('platform.detail.noEvents')}</p>
      ) : (
        <ul className="flex flex-col gap-[10px]">
          {recent.map((e) => (
            <li key={e.id} className="text-xs leading-[18px] text-muted">
              {formatDateTime(e.at)} · {e.action.replace(/_/g, ' ')} · {e.actor || t('platform.detail.system')}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TenantDetail({ d }) {
  const t = useT()
  const [tab, setTab] = useState('invoices')
  const [now] = useState(() => Date.now())
  const { show, doApprove, doExport, modals } = useTenantActions(d)
  const state = d.company.state
  const canManage = state !== 'pending' && state !== 'rejected'
  const eyebrow = (
    <nav aria-label={t('platform.detail.breadcrumb')} className="flex flex-wrap items-center gap-1">
      <Link href="/platform/tenants" className="rounded hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
        {t('platform.nav.tenants')}
      </Link>
      <span aria-hidden>/</span>
      <span>
        {[d.company.name, d.subscription ? t('platform.detail.planLabel', { plan: d.subscription.planName }) : null, t('platform.detail.since', { date: formatDate(d.company.createdAt) })]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </nav>
  )
  const actions = (
    <>
      {state === 'pending' ? (
        <>
          <GhostButton size="lg" onClick={() => show('reject')}>
            {t('platform.detail.reject')}
          </GhostButton>
          <SolidButton onClick={doApprove}>{t('platform.detail.approve')}</SolidButton>
        </>
      ) : null}
      {canManage ? (
        <GhostButton size="lg" onClick={() => show('actas')}>
          {t('platform.detail.actAs')}
        </GhostButton>
      ) : null}
      {state === 'active' ? (
        <GhostButton size="lg" tone="danger" onClick={() => show('suspend')}>
          {t('platform.detail.suspend')}
        </GhostButton>
      ) : null}
      {state === 'suspended' ? (
        <GhostButton size="lg" onClick={() => show('reactivate')}>
          {t('platform.detail.reactivate')}
        </GhostButton>
      ) : null}
      {canManage ? <SolidButton onClick={() => show('payment')}>{t('platform.detail.recordPayment')}</SolidButton> : null}
    </>
  )

  return (
    <div className="flex flex-col gap-8">
      <ConsoleHeader eyebrow={eyebrow} title={d.company.name} actions={actions} />
      <StatusStrip d={d} now={now} />
      <div className="flex flex-col gap-4 xl:flex-row">
        <section className="flex min-w-0 flex-col rounded-[12px] border border-line bg-surface xl:grow-[1.4] xl:basis-0">
          <div className="overflow-x-auto border-b border-line px-5">
            <Tabs
              variant="underline"
              label={t('platform.detail.sections')}
              value={tab}
              onChange={setTab}
              tabs={TABS.map((x) => ({ value: x, id: `tenant-tab-${x}`, controls: 'tenant-panel', label: t(`platform.detail.tab.${x}`) }))}
            />
          </div>
          <div id="tenant-panel" role="tabpanel" aria-labelledby={`tenant-tab-${tab}`} className="p-5">
            {tab === 'invoices' && <InvoicesTab d={d} now={now} canBill={canManage} onCreate={() => show('invoice')} />}
            {tab === 'subscription' && <SubscriptionTab d={d} />}
            {tab === 'members' && <MembersTab d={d} />}
            {tab === 'usage' && <UsageTab d={d} />}
            {tab === 'audit' && <AuditTab d={d} />}
            {tab === 'limits' && <LimitsTab key={d.subscription?.subscriptionId || 'none'} d={d} />}
            {tab === 'notes' && <NotesTab d={d} />}
            {tab === 'profile' && <ProfileTab d={d} canManage={canManage} onExport={doExport} />}
          </div>
        </section>
        <div className="flex min-w-0 flex-col gap-4 xl:grow xl:basis-0">
          <SubscriptionCard d={d} show={show} canManage={canManage} />
          <RecentActivity d={d} />
        </div>
      </div>
      {modals}
    </div>
  )
}

function TenantLoader({ id }) {
  const t = useT()
  const d = useQuery(api.platform.tenants.detail, { companyId: id })
  if (d === undefined) return <LoadingState label={t('platform.detail.loading')} />
  if (d === null) return <ConsoleHeader title={t('platform.detail.notFound')} eyebrow={<Link href="/platform/tenants">{t('platform.nav.tenants')}</Link>} />
  return <TenantDetail d={d} />
}

export default function PlatformTenantPage() {
  const t = useT()
  const router = useRouter()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  return (
    <PlatformLayout title={t('platform.detail.title')} hideHeader>
      {id ? <TenantLoader id={id} /> : <LoadingState />}
    </PlatformLayout>
  )
}
