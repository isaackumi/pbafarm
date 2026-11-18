import { formatMoney, formatNumber } from '../lib/format'
import { useT } from '../lib/i18n/context'

/**
 * KPI rows from convex/lib/siteKpis (regional and group reports). Each row
 * has a `name` and the KPI fields; `currency` per row or for the table.
 */
export default function SiteKpiTable({ rows, currency, showSites = false, footer = null, onSelect = null }) {
  const t = useT()
  const money = (n, c) => formatMoney(n, { currency: c || currency || undefined, decimals: 0 })
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted border-b border-foam-deep">
            <th className="px-4 py-2 font-medium">{t('ent.common.name')}</th>
            {showSites && <th className="px-4 py-2 font-medium text-right">{t('ent.kpi.sites')}</th>}
            <th className="px-4 py-2 font-medium text-right">{t('ent.kpi.activeUnits')}</th>
            <th className="px-4 py-2 font-medium text-right">{t('ent.kpi.fish')}</th>
            <th className="px-4 py-2 font-medium text-right">{t('ent.kpi.harvestKg')}</th>
            <th className="px-4 py-2 font-medium text-right">{t('ent.kpi.sales')}</th>
            <th className="px-4 py-2 font-medium text-right">{t('ent.kpi.expenses')}</th>
            <th className="px-4 py-2 font-medium text-right">{t('ent.kpi.overdueMaintenance')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-foam-deep tabular-nums">
          {[...rows, ...(footer ? [{ ...footer, isFooter: true }] : [])].map((r) => (
            <tr key={r.key} className={r.isFooter ? 'font-medium border-t-2 border-foam-deep' : ''}>
              <td className="px-4 py-2">
                {onSelect && r.selectable ? (
                  <button type="button" className="text-lake hover:underline font-medium text-left" onClick={() => onSelect(r)}>
                    {r.name}
                  </button>
                ) : (
                  <span className={r.isFooter ? '' : 'font-medium'}>{r.name}</span>
                )}
                {r.hint && <span className="text-muted"> · {r.hint}</span>}
              </td>
              {showSites && <td className="px-4 py-2 text-right">{formatNumber(r.sites)}</td>}
              <td className="px-4 py-2 text-right">{formatNumber(r.activeUnits)}</td>
              <td className="px-4 py-2 text-right">{formatNumber(r.fish)}</td>
              <td className="px-4 py-2 text-right">{formatNumber(r.harvestKg)}</td>
              <td className="px-4 py-2 text-right">{money(r.salesAmount, r.currency)}</td>
              <td className="px-4 py-2 text-right">{money(r.expensesAmount, r.currency)}</td>
              <td className={`px-4 py-2 text-right ${r.overdueMaintenance ? 'text-signal' : ''}`}>{formatNumber(r.overdueMaintenance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** First day of the current month to today (local). */
export function monthToDate(today) {
  return { from: `${today.slice(0, 8)}01`, to: today }
}
