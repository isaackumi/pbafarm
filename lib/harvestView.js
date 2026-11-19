/**
 * Pure helpers for the Harvest screen (Paper 08 Harvest): month totals, size
 * grade shares, lot status per harvest and the ready-to-harvest list.
 */
import { daysBetween } from './format'

const monthOf = (iso) => String(iso || '').slice(0, 7)

function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** Harvested kg this month and last month, and the change in percent. */
export function monthTotals(records, today) {
  const cur = monthOf(today)
  const prev = prevMonth(cur)
  let thisMonth = 0
  let lastMonth = 0
  let fish = 0
  let weightedAbw = 0
  for (const r of records || []) {
    const m = monthOf(r.harvest_date)
    if (m === cur) {
      thisMonth += Number(r.total_weight) || 0
      const n = Number(r.estimated_count) || 0
      if (n > 0 && Number(r.average_body_weight) > 0) {
        fish += n
        weightedAbw += n * Number(r.average_body_weight)
      }
    } else if (m === prev) lastMonth += Number(r.total_weight) || 0
  }
  const changePct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null
  return { month: cur, thisMonth, lastMonth, changePct, avgAbw: fish > 0 ? weightedAbw / fish : null }
}

/** The newest harvest that recorded a size breakdown. */
export function lastGradedHarvest(records) {
  return (records || []).find((r) => gradeShares(r).length > 0) || null
}

/** Size grades of one harvest as shares of the graded weight. */
export function gradeShares(record) {
  const grades = Array.isArray(record?.size_breakdown) ? record.size_breakdown : []
  const total = grades.reduce((s, g) => s + (Number(g.weight) || 0), 0)
  if (!(total > 0)) return []
  return grades
    .filter((g) => Number(g.weight) > 0)
    .map((g) => ({
      key: g.category,
      range: g.range || '',
      weight: Number(g.weight),
      pct: Math.round((Number(g.weight) / total) * 100),
    }))
}

/** Lots grouped by harvest: codes, total, dispatched and remaining kg. */
export function lotsByHarvest(lots) {
  const map = new Map()
  for (const l of lots || []) {
    const cur = map.get(l.harvest_id) || { codes: [], weight: 0, dispatched: 0, remaining: 0 }
    cur.codes.push(l.lot_code)
    cur.weight += Number(l.weight_kg) || 0
    cur.dispatched += Number(l.dispatched_kg) || 0
    cur.remaining += Number(l.remaining_kg) || 0
    map.set(l.harvest_id, cur)
  }
  return map
}

/** 'none' (no lot yet), 'open' (stock left) or 'out' (all dispatched). */
export function lotState(summary) {
  if (!summary) return 'none'
  return summary.remaining > 0 ? 'open' : 'out'
}

/**
 * Cages at the harvest target weight, heaviest standing biomass first. A cage
 * under a withdrawal hold stays listed with the hold's last day.
 */
export function readyCages(cages, withdrawals, today) {
  const holds = new Map()
  for (const w of withdrawals || []) {
    if (!w.withdrawal_until || w.withdrawal_until < today) continue
    const prev = holds.get(w.cage_id)
    if (!prev || w.withdrawal_until > prev) holds.set(w.cage_id, w.withdrawal_until)
  }
  return (cages || [])
    .map((c) => {
      const id = c.id || c._id
      const count = Number(c.current_count) || 0
      const abw = Number(c.current_weight) || 0
      return {
        id,
        name: c.name,
        species: c.species || null,
        abw: abw || null,
        doc: c.stocking_date ? daysBetween(c.stocking_date, today) : null,
        biomassKg: count > 0 && abw > 0 ? (count * abw) / 1000 : null,
        holdUntil: holds.get(id) || null,
      }
    })
    .sort((a, b) => (b.biomassKg || 0) - (a.biomassKg || 0))
}

export function inDateRange(iso, start, end) {
  return (!start || iso >= start) && (!end || iso <= end)
}
