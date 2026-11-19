import { addDays } from './format'

const OPEN = new Set(['draft', 'ordered'])

const lineKg = (po) => (po.lines || []).reduce((s, l) => s + Number(l.quantity_kg || 0), 0)

/**
 * Header KPIs for the Procurement board (Paper 29), from api.procurement.list.
 * `today` is the business date (YYYY-MM-DD). On-time counts received POs in the
 * last 90 days that had an expected date, received on or before it.
 */
export function summarizeProcurement(orders, today) {
  const list = orders || []
  const open = list.filter((po) => OPEN.has(po.status))
  const weekEnd = addDays(today, 7)
  const arriving = list.filter(
    (po) => po.status === 'ordered' && po.expected_date && po.expected_date >= today && po.expected_date <= weekEnd,
  )
  const month = today.slice(0, 7)
  const received = list.filter((po) => po.status === 'received' && po.received_date)
  const spendMonth = received
    .filter((po) => po.received_date.startsWith(month))
    .reduce((s, po) => s + Number(po.received_value || 0), 0)
  const since = addDays(today, -90)
  const timed = received.filter((po) => po.expected_date && po.received_date >= since)
  const onTime = timed.filter((po) => po.received_date <= po.expected_date).length
  return {
    openCount: open.length,
    openValue: open.reduce((s, po) => s + Number(po.ordered_value || 0), 0),
    arrivingCount: arriving.length,
    arrivingKg: arriving.reduce((s, po) => s + lineKg(po), 0),
    spendMonth,
    onTimePct: timed.length ? Math.round((onTime / timed.length) * 100) : null,
  }
}

/** Spend per supplier on received POs, largest first. */
export function supplierSpend(orders) {
  const map = new Map()
  for (const po of orders || []) {
    if (po.status !== 'received') continue
    const name = po.supplier_name || '—'
    const row = map.get(name) || { name, spend: 0, count: 0, timed: 0, onTime: 0 }
    row.spend += Number(po.received_value || 0)
    row.count += 1
    if (po.expected_date && po.received_date) {
      row.timed += 1
      if (po.received_date <= po.expected_date) row.onTime += 1
    }
    map.set(name, row)
  }
  return [...map.values()].sort((a, b) => b.spend - a.spend)
}

export { lineKg }
