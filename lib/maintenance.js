/**
 * Scheduled maintenance window (Paper 62 "Maintenance"). Off unless
 * NEXT_PUBLIC_MAINTENANCE_UNTIL is set to an ISO date-time in the future,
 * e.g. 2026-11-21T02:30:00Z. Read at build time like every NEXT_PUBLIC_ value.
 */
export const MAINTENANCE_UNTIL = process.env.NEXT_PUBLIC_MAINTENANCE_UNTIL || ''
export const STATUS_PAGE_URL = process.env.NEXT_PUBLIC_STATUS_URL || ''

/** The window's end as a Date while it is still ahead of `now`, else null. */
export function maintenanceUntil(value = MAINTENANCE_UNTIL, now = Date.now()) {
  if (!value) return null
  const at = Date.parse(value)
  if (!Number.isFinite(at) || at <= now) return null
  return new Date(at)
}

/** "02:30 GMT": the end time in UTC, 24-hour, as drawn. */
export function maintenanceClock(until) {
  const hh = String(until.getUTCHours()).padStart(2, '0')
  const mm = String(until.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm} GMT`
}
