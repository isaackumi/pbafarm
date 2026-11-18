import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, Button } from '../../components/ui'
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

function Invoice() {
  const t = useT()
  const router = useRouter()
  const { formatCurrency } = useCurrency()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  const invoice = useQuery(api.invoices.getInvoice, id ? { invoiceId: id } : 'skip')

  if (invoice === undefined) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (invoice === null) return <p className="text-sm text-muted">{t('sales.invoiceNotFound')}</p>

  const sale = invoice.sale
  const isUnit = sale?.unit_count != null
  const payments = invoice.payments.filter((p) => !p.voided)

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          showTitle={false}
          breadcrumbs={[{ label: t('sales.tabSales'), href: '/sales' }, { label: invoice.number }]}
          actions={
            <Button type="button" onClick={() => window.print()}>
              {t('sales.print')}
            </Button>
          }
        />
      </div>

      <article className="page-card p-8 max-w-3xl mx-auto print:shadow-none print:border-0">
        {invoice.voided && (
          <p role="alert" className="mb-4 rounded-lg border border-signal/40 bg-signal/10 px-4 py-2 text-sm font-semibold">
            {t('sales.invoiceVoidedBanner')}
          </p>
        )}
        <header className="flex flex-wrap justify-between gap-6 mb-8">
          <div>
            <p className="font-display text-xl font-semibold text-chart-ink">{invoice.company?.name}</p>
            {invoice.company?.address && <p className="text-sm text-muted">{invoice.company.address}</p>}
            {invoice.company?.phone && <p className="text-sm text-muted">{invoice.company.phone}</p>}
            {invoice.company?.email && <p className="text-sm text-muted">{invoice.company.email}</p>}
            {invoice.site_name && <p className="text-sm text-muted">{invoice.site_name}</p>}
          </div>
          <div className="text-right">
            <p className="font-display text-2xl font-semibold text-chart-ink">{t('sales.invoice')}</p>
            <p className="font-data">{invoice.number}</p>
            <p className="text-sm text-muted">
              {t('sales.issueDate')}: <span className="font-data">{invoice.issue_date}</span>
            </p>
            {invoice.due_date && (
              <p className="text-sm text-muted">
                {t('sales.dueDate')}: <span className="font-data">{invoice.due_date}</span>
              </p>
            )}
          </div>
        </header>

        <section className="mb-6">
          <p className="text-xs font-semibold text-muted">{t('sales.billTo')}</p>
          <p className="font-medium">{invoice.customer?.name || invoice.customer_name}</p>
          {invoice.customer?.contact_name && <p className="text-sm">{invoice.customer.contact_name}</p>}
          {invoice.customer?.phone && <p className="text-sm">{invoice.customer.phone}</p>}
          {invoice.customer?.email && <p className="text-sm">{invoice.customer.email}</p>}
        </section>

        {sale && (
          <table className="w-full text-sm mb-6">
            <thead className="border-b border-foam-deep">
              <tr>
                <th className="py-2 text-left font-medium text-muted">{t('sales.saleDate')}</th>
                <th className="py-2 text-left font-medium text-muted">{t('sales.description')}</th>
                <th className="py-2 text-right font-medium text-muted">{t('sales.quantity')}</th>
                <th className="py-2 text-right font-medium text-muted">{t('sales.unitPrice')}</th>
                <th className="py-2 text-right font-medium text-muted">{t('sales.amount')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-foam-deep">
                <td className="py-2 font-data">{sale.sale_date}</td>
                <td className="py-2">{isUnit ? t('sales.fingerlings') : t('sales.fish')}</td>
                <td className="py-2 text-right font-data">
                  {isUnit ? sale.unit_count : `${Number(sale.weight_kg).toFixed(2)} kg`}
                </td>
                <td className="py-2 text-right font-data">
                  {formatCurrency(isUnit ? sale.price_per_unit : sale.price_per_kg)}
                </td>
                <td className="py-2 text-right font-data">{formatCurrency(sale.total_amount)}</td>
              </tr>
            </tbody>
          </table>
        )}

        <dl className="ml-auto max-w-xs text-sm space-y-1">
          <div className="flex justify-between">
            <dt>{t('sales.total')}</dt>
            <dd className="font-data font-semibold">{formatCurrency(sale?.total_amount ?? invoice.amount)}</dd>
          </div>
          {payments.map((p) => (
            <div key={p.id} className="flex justify-between text-muted">
              <dt>
                {t('sales.paymentOn', { date: p.paid_date })} ({t(`sales.method.${p.method}`)})
              </dt>
              <dd className="font-data">−{formatCurrency(p.amount)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-foam-deep pt-1">
            <dt className="font-semibold">{t('sales.balanceDue')}</dt>
            <dd className="font-data font-semibold">{formatCurrency(invoice.balance)}</dd>
          </div>
        </dl>

        {invoice.notes && <p className="mt-8 text-sm text-muted whitespace-pre-line">{invoice.notes}</p>}
      </article>
    </div>
  )
}
