import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Badge, LoadingState, ProgressBar, Table } from '../ui'
import { formatDate, formatMinor } from '../../lib/billingFormat'
import { limitTone } from '../../lib/billingBalance'
import { useT } from '../../lib/i18n/context'

export const INVOICE_TONE = { paid: 'good', open: 'warn', void: 'neutral', uncollectible: 'alert' }
const STATUS_TONE = { trialing: 'cyan', active: 'good', past_due: 'warn', suspended: 'alert', cancelled: 'neutral', none: 'neutral' }
const BAR_TONE = { alert: 'alert', warn: 'warn', ok: 'cyan' }

function LimitRow({ limit }) {
  const t = useT()
  const tone = limitTone(limit.used, limit.max)
  const value =
    limit.max === null
      ? t('billing.usedUnlimited', { used: limit.used.toLocaleString() })
      : t('billing.usedOf', { used: limit.used.toLocaleString(), max: limit.max.toLocaleString() })
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex justify-between gap-3 text-xs leading-4">
        <span className="text-muted">{limit.label}</span>
        <span className={tone === 'alert' ? 'text-alert' : tone === 'warn' ? 'text-warn' : 'text-text'}>
          {value}
          {tone === 'alert' ? ` · ${t('billing.atLimit')}` : tone === 'warn' ? ` · ${t('billing.nearLimit')}` : ''}
        </span>
      </div>
      {limit.max !== null ? (
        <ProgressBar value={Math.min(limit.used, limit.max)} max={limit.max || 1} tone={BAR_TONE[tone]} label={limit.label} className="h-[6px] bg-surface-2" />
      ) : null}
    </div>
  )
}

/** Current plan, usage vs limits and invoices for the signed-in organization (PLAT-113, Paper 43). */
export default function TenantBilling() {
  const t = useT()
  const b = useQuery(api.billing.tenant.myBilling, {})
  if (b === undefined) return <LoadingState label={t('billing.loading')} />
  if (b === null) return <p className="text-muted">{t('billing.noOrg')}</p>
  const open = b.invoices.filter((i) => i.status === 'open')
  const dateLabel = b.status === 'trialing' ? 'trialEnds' : b.status === 'past_due' ? 'payBy' : 'renews'
  const date = b.status === 'trialing' ? b.trialEndsAt : b.status === 'past_due' ? b.graceEndsAt : b.currentPeriodEnd

  return (
    <div className="flex flex-col gap-4">
      {b.suspended ? (
        <div role="alert" className="rounded-[12px] border border-alert bg-[color-mix(in_oklab,var(--alert)_8%,transparent)] p-5">
          <p className="font-medium text-alert">{t('billing.suspended')}</p>
          {b.suspensionReason ? <p className="mt-1 text-sm text-text">{b.suspensionReason}</p> : null}
          <p className="mt-1 text-sm text-muted">{t('billing.suspendedHint')}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row">
        <section aria-labelledby="billing-plan" className="flex flex-col gap-4 rounded-[12px] border border-line bg-surface p-5 lg:grow-[1.2] lg:basis-0">
          <div className="flex flex-col gap-1">
            <h2 id="billing-plan" className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-muted">
              {t('billing.currentPlan')}
            </h2>
            {b.plan ? (
              <>
                <p className="text-[22px] font-semibold leading-7 text-text">
                  {b.plan.name}
                  {b.plan.amountMinor !== null
                    ? ` · ${t('billing.pricePer', { price: formatMinor(b.plan.amountMinor, b.plan.currency), interval: t(`billing.interval.${b.plan.interval}`) })}`
                    : ''}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs leading-4 text-muted">
                  <Badge tone={STATUS_TONE[b.status] || 'neutral'}>{t(`billing.status.${b.status}`)}</Badge>
                  {date ? <span>{t(`billing.${dateLabel}`, { date: formatDate(date) })}</span> : null}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">{t('billing.noPlan')}</p>
            )}
          </div>
          {b.limits.length ? (
            <div className="flex flex-col gap-3">
              {b.limits.map((l) => (
                <LimitRow key={l.kind} limit={l} />
              ))}
            </div>
          ) : null}
          <p className="text-xs leading-4 text-faint">{t('billing.upgradeHint')}</p>
        </section>

        <div className="flex flex-col lg:grow lg:basis-0">
          <Table
            variant="panel"
            className="h-full"
            title={t('billing.invoices')}
            rowKey={(r) => r.id}
            rows={b.invoices}
            empty={t('billing.noInvoices')}
            columns={[
              { key: 'number', header: t('billing.col.number'), render: (r) => r.number, sub: (r) => formatDate(r.issuedAt) },
              { key: 'dueAt', header: t('billing.col.due'), render: (r) => formatDate(r.dueAt) },
              { key: 'total', header: t('billing.col.total'), align: 'right', render: (r) => formatMinor(r.totalMinor, r.currency) },
              {
                key: 'balance',
                header: t('billing.col.balance'),
                align: 'right',
                render: (r) => formatMinor(r.totalMinor - r.paidMinor, r.currency),
              },
              {
                key: 'status',
                header: t('billing.col.status'),
                render: (r) => <Badge tone={INVOICE_TONE[r.status] || 'neutral'}>{t(`billing.invoiceStatus.${r.status}`)}</Badge>,
              },
            ]}
          />
        </div>
      </div>

      {open.length > 0 && b.paymentInstructions ? (
        <section aria-labelledby="billing-pay" className="rounded-[12px] border border-line bg-surface p-5">
          <h2 id="billing-pay" className="text-[15px] font-semibold leading-[18px] text-text">
            {t('billing.howToPay')}
          </h2>
          <p className="mt-3 whitespace-pre-wrap rounded-[10px] bg-surface-2 p-3 text-sm leading-5 text-text">{b.paymentInstructions}</p>
        </section>
      ) : null}
    </div>
  )
}
