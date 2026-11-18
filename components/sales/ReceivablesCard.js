import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useCurrency } from '../../hooks/useCurrency'
import { useT } from '../../lib/i18n/context'
import { localToday } from '../../lib/format'

const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']

/** Money still owed by customer, aged by days past due (INV-009). */
export default function ReceivablesCard({ locationId, onOpenSale }) {
  const t = useT()
  const { formatCurrency } = useCurrency()
  const data = useQuery(api.invoices.listReceivables, {
    asOf: localToday(),
    locationId: locationId || undefined,
  })

  return (
    <div className="page-card overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-foam-deep flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-medium text-chart-ink">{t('sales.receivables')}</h3>
        {data && (
          <span className="text-sm text-muted">
            {t('sales.totalOwed')}{' '}
            <span className="font-data font-semibold text-chart-ink">{formatCurrency(data.total)}</span>
          </span>
        )}
      </div>
      {data === undefined ? (
        <p className="px-6 py-6 text-sm text-muted">{t('common.loading')}</p>
      ) : data.customers.length === 0 ? (
        <p className="px-6 py-6 text-sm text-muted">{t('sales.noReceivables')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-foam-deep text-sm">
            <thead className="bg-foam-deep/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">{t('sales.buyer')}</th>
                {BUCKETS.map((b) => (
                  <th key={b} className="px-4 py-3 text-right text-xs font-medium text-muted">
                    {t(`sales.aging.${b}`)}
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-medium text-muted">{t('sales.balance')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foam-deep">
              {data.customers.map((c) => (
                <tr key={c.customer_id || c.customer_name}>
                  <td className="px-4 py-3">
                    {c.customer_name}
                    <span className="ml-2 text-xs text-muted">{t('sales.openSales', { count: c.sale_count })}</span>
                  </td>
                  {BUCKETS.map((b) => (
                    <td key={b} className="px-4 py-3 text-right font-data">
                      {c.aging[b] ? formatCurrency(c.aging[b]) : '—'}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right font-data font-semibold">{formatCurrency(c.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {onOpenSale && (
            <ul className="px-6 py-3 border-t border-foam-deep text-sm flex flex-wrap gap-x-4 gap-y-1">
              {data.sales.map((s) => (
                <li key={s.sale_id}>
                  <button
                    type="button"
                    className="text-lagoon-800 hover:underline"
                    onClick={() => onOpenSale(s.sale_id)}
                  >
                    {s.invoice_number || s.sale_date} · {s.customer_name} · {formatCurrency(s.balance)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
