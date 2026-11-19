import { Table } from './ui'
import { formatMoney, formatNumber } from '../lib/format'
import { useT } from '../lib/i18n/context'

/** Strips the Table card chrome: hosts already wrap this in a card. */
const BARE = 'rounded-none! border-0! bg-transparent! shadow-none!'

/**
 * KPI rows from convex/lib/siteKpis (regional and group reports). Each row
 * has a `name` and the KPI fields; `currency` per row or for the table.
 */
export default function SiteKpiTable({ rows, currency, showSites = false, footer = null, onSelect = null }) {
  const t = useT()
  const money = (n, c) => formatMoney(n, { currency: c || currency || undefined, decimals: 0 })
  const strong = (r, v) => (r.isFooter ? <span className="font-semibold">{v}</span> : v)
  const columns = [
    {
      key: 'name',
      header: t('ent.common.name'),
      render: (r) => (
        <span className="whitespace-nowrap">
          {onSelect && r.selectable ? (
            <button
              type="button"
              className="rounded-sm text-left font-medium text-pearl-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
              onClick={() => onSelect(r)}
            >
              {r.name}
            </button>
          ) : (
            <span className="font-medium">{r.name}</span>
          )}
          {r.hint && <span className="text-muted"> · {r.hint}</span>}
        </span>
      ),
    },
    ...(showSites
      ? [{ key: 'sites', header: t('ent.kpi.sites'), align: 'right', render: (r) => strong(r, formatNumber(r.sites)) }]
      : []),
    { key: 'activeUnits', header: t('ent.kpi.activeUnits'), align: 'right', render: (r) => strong(r, formatNumber(r.activeUnits)) },
    { key: 'fish', header: t('ent.kpi.fish'), align: 'right', render: (r) => strong(r, formatNumber(r.fish)) },
    { key: 'harvestKg', header: t('ent.kpi.harvestKg'), align: 'right', render: (r) => strong(r, formatNumber(r.harvestKg)) },
    {
      key: 'sales',
      header: t('ent.kpi.sales'),
      align: 'right',
      render: (r) => <span className="whitespace-nowrap">{strong(r, money(r.salesAmount, r.currency))}</span>,
    },
    {
      key: 'expenses',
      header: t('ent.kpi.expenses'),
      align: 'right',
      render: (r) => <span className="whitespace-nowrap">{strong(r, money(r.expensesAmount, r.currency))}</span>,
    },
    {
      key: 'overdue',
      header: t('ent.kpi.overdueMaintenance'),
      align: 'right',
      render: (r) => (
        <span className={r.overdueMaintenance ? 'text-alert' : ''}>{strong(r, formatNumber(r.overdueMaintenance))}</span>
      ),
    },
  ]
  return (
    <Table
      className={BARE}
      columns={columns}
      rows={[...rows, ...(footer ? [{ ...footer, isFooter: true }] : [])]}
      rowKey={(r) => r.key}
    />
  )
}

/** First day of the current month to today (local). */
export function monthToDate(today) {
  return { from: `${today.slice(0, 8)}01`, to: today }
}
