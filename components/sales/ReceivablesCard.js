import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useCurrency } from '../../hooks/useCurrency'
import { useT } from '../../lib/i18n/context'
import { localToday } from '../../lib/format'
import { Table } from '../ui'

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
    <div className="flex flex-col gap-3">
      <Table
        title={t('sales.receivables')}
        actions={
          data ? (
            <span className="text-sm text-muted">
              {t('sales.totalOwed')} <span className="font-semibold tabular-nums text-text">{formatCurrency(data.total)}</span>
            </span>
          ) : null
        }
        columns={[
          {
            key: 'buyer',
            header: t('sales.buyer'),
            render: (c) => c.customer_name,
            sub: (c) => t('sales.openSales', { count: c.sale_count }),
          },
          ...BUCKETS.map((b) => ({
            key: b,
            header: t(`sales.aging.${b}`),
            align: 'right',
            render: (c) => (c.aging[b] ? formatCurrency(c.aging[b]) : <span className="text-faint">—</span>),
          })),
          { key: 'balance', header: t('sales.balance'), align: 'right', render: (c) => <span className="font-semibold">{formatCurrency(c.balance)}</span> },
        ]}
        rows={data?.customers || []}
        rowKey={(c) => c.customer_id || c.customer_name}
        empty={data === undefined ? t('common.loading') : t('sales.noReceivables')}
      />
      {onOpenSale && data && data.sales.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('sales.receivables')}>
          {data.sales.map((s) => (
            <li key={s.sale_id}>
              <button
                type="button"
                className="rounded-pill border border-line px-3 py-[6px] text-xs leading-4 text-muted hover:border-line-strong hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                onClick={() => onOpenSale(s.sale_id)}
              >
                {s.invoice_number || s.sale_date} · {s.customer_name} · {formatCurrency(s.balance)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
