/** Lot trace labels and the CSV download of pages/trace/[lotId] (formula-safe via toCsv). */
import { toCsv } from './csv'

export const ORIGIN = {
  stocking: 'Stocked',
  transfer_split: 'Split off by a transfer',
  grading_split: 'Graded from a parent batch',
  merge: 'Formed by a merge',
  hatchery: 'From the hatchery',
  legacy: 'Imported',
}

export const STEP = {
  stocked: 'Stocked',
  topped_up: 'Topped up',
  transfer_in: 'Moved in',
  transfer_out: 'Moved out',
  graded: 'Graded into',
  merged: 'Merged into',
  harvested: 'Harvested',
}

/** One flat CSV with a section column, for buyers' and auditors' spreadsheets. */
export function traceCsv(r) {
  const rows = [['section', 'date', 'item', 'detail', 'quantity', 'unit']]
  const t = r.trace
  rows.push(['lot', r.lot.harvest_date, r.lot.lot_code, [r.lot.grade, r.lot.destination].filter(Boolean).join(' / '), r.lot.weight_kg, 'kg'])
  if (r.harvest) rows.push(['harvest', r.harvest.date, r.cage_name, r.harvest.type, r.harvest.total_weight_kg, 'kg'])
  for (const o of t?.origins || []) {
    rows.push(['origin', o.opened_on, o.batch_number, [ORIGIN[o.origin] || o.origin, o.source, o.source_cage].filter(Boolean).join(' / '), o.stocked_count ?? '', 'fish'])
  }
  for (const s of t?.journey || []) {
    rows.push(['movement', s.date, `${STEP[s.kind] || s.kind} ${s.cageName}`, [s.batchNumber, s.counterpartCage, s.counterpartBatch, s.source].filter(Boolean).join(' / '), s.qty, 'fish'])
  }
  for (const f of t?.feed || []) {
    rows.push(['feed', `${f.first_fed}..${f.last_fed}`, f.feed_type, '', f.kg_fed, 'kg'])
    for (const l of f.lots) {
      rows.push(['feed lot', l.received_on, l.lot_number || '(no lot number)', [f.feed_type, l.supplier, l.po_number].filter(Boolean).join(' / '), l.quantity_kg, 'kg'])
    }
  }
  for (const x of t?.treatments || []) {
    rows.push(['treatment', x.date, x.product_name || x.treatment, [x.diagnosis, x.cage_name, x.withdrawal_until && `withdrawal until ${x.withdrawal_until}`].filter(Boolean).join(' / '), x.dosage || '', ''])
  }
  for (const d of r.dispatches) {
    rows.push(['dispatch', d.dispatch_date, d.customer_name || '', [d.vehicle, d.driver, d.temperature_c != null && `${d.temperature_c} °C`].filter(Boolean).join(' / '), d.weight_kg, 'kg'])
  }
  const [header, ...body] = rows
  return toCsv(header, body)
}
