import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { ArrowLeft, Printer } from 'lucide-react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { GhostButton, Pill } from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useCurrency } from '../../hooks/useCurrency'
import { useT } from '../../lib/i18n/context'

export default function InvoicePage() {
  const t = useT()
  return (
    <ProtectedRoute>
      <Layout title={t('sales.invoice')}>
        <Invoice />
      </Layout>
    </ProtectedRoute>
  )
}

/** Print on paper in the light palette, whatever theme is on screen. */
function usePrintLightTheme() {
  useEffect(() => {
    const root = document.documentElement
    let prev = null
    const before = () => {
      prev = root.dataset.theme
      root.dataset.theme = 'light'
    }
    const after = () => {
      if (prev) root.dataset.theme = prev
      prev = null
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])
}

function Invoice() {
  const t = useT()
  const router = useRouter()
  const { formatCurrency } = useCurrency()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  const invoice = useQuery(api.invoices.getInvoice, id ? { invoiceId: id } : 'skip')
  usePrintLightTheme()

  if (invoice === undefined) return <p className="text-[13px] leading-5 text-muted">{t('common.loading')}</p>
  if (invoice === null) return <p className="text-[13px] leading-5 text-muted">{t('sales.invoiceNotFound')}</p>

  const sale = invoice.sale
  const isUnit = sale?.unit_count != null
  const payments = invoice.payments.filter((p) => !p.voided)
  const total = sale?.total_amount ?? invoice.amount
  const status = invoice.voided
    ? { tone: 'alert', label: t('ops.invoice.voided') }
    : invoice.balance <= 0
      ? { tone: 'good', label: t('ops.sales.pill.paid') }
      : payments.length > 0
        ? { tone: 'warn', label: t('ops.invoice.partPaid') }
        : { tone: 'neutral', label: t('ops.sales.pill.unpaid') }

  return (
    <div className="flex flex-col gap-[22px]">
      <nav aria-label={t('ops.invoice.breadcrumb')} className="flex items-center justify-between gap-3 print:hidden">
        <Link
          href="/sales"
          className="inline-flex items-center gap-2 rounded-sm text-[13px] leading-5 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          <ArrowLeft size={14} aria-hidden />
          {t('sales.tabSales')}
        </Link>
        <GhostButton icon={Printer} onClick={() => window.print()}>
          {t('sales.print')}
        </GhostButton>
      </nav>

      <article className="mx-auto flex w-full max-w-3xl flex-col gap-1 rounded-lg border border-line bg-surface px-5 py-6 sm:px-[26px] print:max-w-none print:border-0">
        {invoice.voided && (
          <p role="alert" className="mb-3 rounded-[14px] border border-alert/40 bg-alert/10 px-4 py-2 text-[13px] leading-5 font-semibold text-alert">
            {t('sales.invoiceVoidedBanner')}
          </p>
        )}
        <header className="flex flex-wrap items-start justify-between gap-4 pb-[14px]">
          <div className="flex flex-col gap-1">
            <p className="text-xs leading-4 text-muted">{invoice.number}</p>
            <p className="text-[20px] font-semibold leading-6 text-text">{invoice.customer?.name || invoice.customer_name}</p>
          </div>
          <Pill tone={status.tone}>{status.label}</Pill>
        </header>

        <div className="grid grid-cols-1 gap-6 pb-5 text-[13px] leading-5 sm:grid-cols-2">
          <section aria-label={t('ops.invoice.from')}>
            <p className="pb-1 text-xs leading-4 text-muted">{t('ops.invoice.from')}</p>
            <p className="font-medium text-text">{invoice.company?.name}</p>
            {[invoice.company?.address, invoice.company?.phone, invoice.company?.email, invoice.site_name]
              .filter(Boolean)
              .map((line) => (
                <p key={line} className="text-muted">
                  {line}
                </p>
              ))}
          </section>
          <section aria-label={t('sales.billTo')}>
            <p className="pb-1 text-xs leading-4 text-muted">{t('sales.billTo')}</p>
            <p className="font-medium text-text">{invoice.customer?.name || invoice.customer_name}</p>
            {[invoice.customer?.contact_name, invoice.customer?.phone, invoice.customer?.email]
              .filter(Boolean)
              .map((line) => (
                <p key={line} className="text-muted">
                  {line}
                </p>
              ))}
          </section>
          <dl className="flex gap-6 sm:col-span-2">
            <div>
              <dt className="text-xs leading-4 text-muted">{t('sales.issueDate')}</dt>
              <dd className="tabular-nums text-text">{invoice.issue_date}</dd>
            </div>
            {invoice.due_date && (
              <div>
                <dt className="text-xs leading-4 text-muted">{t('sales.dueDate')}</dt>
                <dd className="tabular-nums text-text">{invoice.due_date}</dd>
              </div>
            )}
          </dl>
        </div>

        <dl className="flex flex-col gap-[10px] rounded-[14px] border border-line bg-bg p-4 text-[13px] leading-4">
          {sale && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">
                {sale.sale_date} · {isUnit ? t('sales.fingerlings') : t('sales.fish')} ·{' '}
                {isUnit ? sale.unit_count : `${Number(sale.weight_kg).toFixed(2)} kg`} ×{' '}
                {formatCurrency(isUnit ? sale.price_per_unit : sale.price_per_kg)}
              </dt>
              <dd className="whitespace-pre tabular-nums text-text">{formatCurrency(total)}</dd>
            </div>
          )}
          {!sale && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t('sales.total')}</dt>
              <dd className="whitespace-pre tabular-nums text-text">{formatCurrency(total)}</dd>
            </div>
          )}
          {payments.map((p) => (
            <div key={p.id} className="flex justify-between gap-4">
              <dt className="text-muted">
                {t('sales.paymentOn', { date: p.paid_date })} · {t(`sales.method.${p.method}`)}
              </dt>
              <dd className="whitespace-pre tabular-nums text-good">− {formatCurrency(p.amount)}</dd>
            </div>
          ))}
          <div className="h-px shrink-0 bg-line" aria-hidden />
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[14px] leading-[18px] text-text">
              {invoice.due_date && invoice.balance > 0
                ? t('ops.sales.balanceDueOn', { date: invoice.due_date })
                : t('sales.balanceDue')}
            </dt>
            <dd className="whitespace-pre text-[22px] font-semibold leading-[28px] tabular-nums text-text">
              {formatCurrency(invoice.balance)}
            </dd>
          </div>
        </dl>

        {invoice.notes && <p className="whitespace-pre-line pt-5 text-[13px] leading-5 text-muted">{invoice.notes}</p>}
      </article>
    </div>
  )
}
