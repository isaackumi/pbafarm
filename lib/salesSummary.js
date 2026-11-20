import { addDays } from './format'

const monthOf = (iso) => String(iso || '').slice(0, 7)

/** 'YYYY-MM' of the month before. */
export function prevMonth(month) {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/**
 * Header KPIs for Sales (Paper 24) from api.sales.listSales and
 * api.invoices.listReceivables. `today` is the business date (YYYY-MM-DD).
 * changePct is null when last month had no sales.
 */
export function summarizeSales(sales, receivables, today) {
  const month = monthOf(today)
  const rows = sales || []
  const inMonth = rows.filter((s) => monthOf(s.sale_date) === month)
  const total = inMonth.reduce((sum, s) => sum + Number(s.total_amount || 0), 0)
  const collected = inMonth.reduce((sum, s) => sum + Number(s.amount_paid || 0), 0)
  const prev = rows
    .filter((s) => monthOf(s.sale_date) === prevMonth(month))
    .reduce((sum, s) => sum + Number(s.total_amount || 0), 0)
  const open = receivables?.sales || []
  const overdue = open.filter((s) => s.days_overdue > 0)
  return {
    month,
    total,
    changePct: prev > 0 ? Math.round(((total - prev) / prev) * 100) : null,
    collected,
    collectedPct: total > 0 ? Math.round((collected / total) * 100) : null,
    outstanding: receivables ? receivables.total : null,
    outstandingCount: open.length,
    overdue: overdue.reduce((sum, s) => sum + Number(s.balance || 0), 0),
    overdue30Count: overdue.filter((s) => s.days_overdue > 30).length,
  }
}

/** Customers ranked by sales value over the last `days` days. */
export function topCustomers(sales, today, days = 90, limit = 3) {
  const since = addDays(today, -days)
  const map = new Map()
  for (const s of sales || []) {
    if (s.sale_date < since) continue
    const key = s.customer_id || `name:${s.customer_name}`
    const row = map.get(key) || { key, name: s.customer_name || '—', total: 0, count: 0, open: 0 }
    row.total += Number(s.total_amount || 0)
    row.count += 1
    if (Number(s.balance || 0) > 0) row.open += 1
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit)
}

/**
 * Paid-column pill for one sale: { key, tone, pct?, days? }.
 * Overdue wins over part-paid; an issued invoice with nothing paid is "invoiced".
 */
export function salePill(sale, daysOverdue = 0) {
  if (sale.payment_status === 'paid' || Number(sale.balance) <= 0) return { key: 'paid', tone: 'green' }
  if (daysOverdue > 0) return { key: 'overdue', tone: 'red', days: daysOverdue }
  if (sale.payment_status === 'partial' || Number(sale.amount_paid) > 0) {
    const pct = sale.total_amount > 0 ? Math.round((Number(sale.amount_paid) / sale.total_amount) * 100) : 0
    return { key: 'partial', tone: 'amber', pct }
  }
  // Paper 24: "Invoiced" is the sky pill (border #1F3E6E, text #6AA8F5).
  if (sale.invoice_id) return { key: 'invoiced', tone: 'sky' }
  return { key: 'unpaid', tone: 'neutral' }
}
