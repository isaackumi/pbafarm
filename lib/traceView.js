/** Pure helpers for the Paper 26 lot-traceability timeline (pages/trace/[lotId], BatchTrace). */
import { daysBetween } from './format'

const byDate = (a, b) => (a.date || '').localeCompare(b.date || '')

/**
 * Farm-to-customer steps for one lot report, oldest first: origins, movements
 * and treatments by date, then a grow-out summary, the harvest and dispatches.
 */
export function lotTimeline(r) {
  const t = r?.trace
  const steps = []
  for (const o of [...(t?.origins || [])].sort((a, b) => a.opened_on.localeCompare(b.opened_on))) {
    steps.push({ kind: 'origin', tone: o.origin === 'hatchery' ? 'lime' : 'sky', date: o.opened_on, origin: o })
  }
  const middle = [
    ...(t?.journey || []).filter((s) => s.kind !== 'harvested').map((s) => ({ kind: 'move', tone: 'sky', date: s.date, move: s })),
    ...(t?.treatments || []).map((x) => ({ kind: 'treatment', tone: 'warn', date: x.date, treatment: x })),
  ].sort(byDate)
  steps.push(...middle)
  const harvestDate = r?.lot?.harvest_date
  const first = steps[0]?.date
  if (t && first && harvestDate) {
    steps.push({
      kind: 'growout',
      tone: 'sky',
      days: daysBetween(first, harvestDate),
      feedKg: t.feed.reduce((s, f) => s + f.kg_fed, 0),
      feedTypes: t.feed.map((f) => f.feed_type),
    })
  }
  if (r?.lot) steps.push({ kind: 'harvest', tone: 'good', date: harvestDate })
  if (r?.dispatches?.length) steps.push({ kind: 'dispatch', tone: 'good', dispatches: r.dispatches })
  return steps
}

/** Withdrawal status of a lot at harvest, with the last period that ended before it. */
export function withdrawalSummary(r) {
  if (r?.harvest?.withdrawal_override) return { state: 'override', until: r.harvest.withdrawal_override.until }
  if (!r?.withdrawal_clear_at_harvest) return { state: 'running', until: null }
  const ended = (r.trace?.treatments || [])
    .map((x) => x.withdrawal_until)
    .filter((d) => d && d <= r.lot.harvest_date)
    .sort()
  return { state: 'clear', until: ended.length ? ended[ended.length - 1] : null }
}

/** Warmest recorded dispatch temperature, or null when none was logged. */
export function maxDispatchTemp(dispatches) {
  const temps = (dispatches || []).map((d) => d.temperature_c).filter((c) => c != null)
  return temps.length ? Math.max(...temps) : null
}
