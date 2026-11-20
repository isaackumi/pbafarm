/**
 * Pure pieces of the cage keeper screens (Paper 54 to 57): heatmap state
 * styles, drag-select ranges, the "why it's here" reason, capacity bars and
 * cover dates. No React, no Convex; the numbers come from convex/keepers.
 */

/** Square and legend classes per unit state (theme tokens, light and dark). */
export const STATE_CLASS = {
  logged: 'bg-good/50',
  due: 'bg-warn',
  none: 'bg-alert/25 ring-[1.5px] ring-inset ring-alert',
  cover: 'bg-cover',
  idle: 'bg-line-strong',
}

export const STATES = ['logged', 'due', 'none', 'cover', 'idle']

/** Units between two squares of one site (inclusive, in grid order): the drag selection. */
export function rangeIds(units, fromId, toId) {
  const a = units.findIndex((u) => u.id === fromId)
  const b = units.findIndex((u) => u.id === toId)
  if (a < 0 || b < 0) return []
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return units.slice(lo, hi + 1).map((u) => u.id)
}

/** Capacity bar: width % of capacity (capped) and tone. */
export function capacityBar(units, capacity, { unassigned = false, away = false } = {}) {
  const pct = Math.min(100, Math.round((units / Math.max(1, capacity)) * 100))
  const tone = unassigned ? 'bg-alert' : units > capacity ? 'bg-warn' : away ? 'bg-cover' : 'bg-muted'
  return { pct, tone }
}

/**
 * The "Today" cell and the reason a row is listed, as i18n keys with values.
 * Order matters: the first thing a manager should act on comes first.
 */
export function rowStatus(row, capacity) {
  if (row.kind === 'unassigned') {
    return {
      today: { key: 'keepers.list.nobodyReminded', tone: 'text-alert' },
      reason: row.since ? { key: 'keepers.reason.stockedNoKeeper', values: { date: row.since } } : { key: 'keepers.reason.neverAssigned' },
    }
  }
  if (row.away) {
    return {
      today: { key: 'keepers.list.coverLogging', values: { name: row.away.coverName }, tone: 'text-cover' },
      reason: { key: 'keepers.reason.away', values: { date: row.away.until } },
    }
  }
  const today =
    row.stocked === 0
      ? { key: 'keepers.list.nothingToLog', tone: 'text-muted' }
      : {
          key: 'keepers.list.loggedOf',
          values: { logged: row.logged, count: row.stocked },
          tone: row.logged === row.stocked ? 'text-good' : row.logged === 0 ? 'text-alert' : 'text-warn',
        }
  let reason
  if (row.units > capacity) reason = row.due ? { key: 'keepers.reason.overDue', values: { count: row.due } } : { key: 'keepers.reason.over' }
  else if (row.due > 0 && row.logged === 0) reason = { key: 'keepers.reason.notStarted', values: { count: row.due } }
  else if (row.due > 0) reason = { key: 'keepers.reason.due', values: { count: row.due } }
  else if (row.covering) reason = { key: 'keepers.reason.covering', values: { names: row.covering.names.join(', ') } }
  else reason = { key: 'keepers.reason.onTrack' }
  return { today, reason }
}

/** Short weekday + day + month in the member's language ("Mon 23 Nov"). */
export function shortDate(date, lang) {
  if (!date) return ''
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(lang || undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** HH:MM of a timestamp in the browser's zone. */
export function clock(ts, lang) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString(lang || undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** YYYY-MM-DD `days` after a date. */
export function addDaysIso(date, days) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Next Monday on or after a date (cover defaults to next week). */
export function nextMonday(date) {
  const d = new Date(`${date}T12:00:00Z`)
  const add = (8 - d.getUTCDay()) % 7 || 7
  return addDaysIso(date, add)
}

/** A draft group id (opaque, the server checks the shape). */
export function newDraftGroup() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `kg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}

/**
 * Load preview for a cover candidate: units now, units while covering, and a
 * tone (suggested / heavy load) against the capacity.
 */
export function coverLoad(candidateUnits, awayUnits, capacity) {
  const during = candidateUnits + awayUnits
  return { now: candidateUnits, during, heavy: during > capacity }
}

/** Handover note drafted from the units' facts (sampling due, deaths), in the member's words. Short: lists are capped. */
export function handoverNote(t, facts) {
  const list = (names) => (names.length > 4 ? t('keepers.cover.note.list', { names: names.slice(0, 4).join(', '), count: names.length - 4 }) : names.join(', '))
  const due = (facts || []).filter((f) => f.sampleDue).map((f) => f.name)
  const dead = (facts || []).filter((f) => f.deadYesterday > 0)
  const lines = []
  if (due.length) lines.push(t('keepers.cover.note.sampleDue', { units: list(due), count: due.length }))
  for (const f of dead.slice(0, 5)) lines.push(t('keepers.cover.note.deaths', { unit: f.name, count: f.deadYesterday }))
  return lines.join(' ')
}
