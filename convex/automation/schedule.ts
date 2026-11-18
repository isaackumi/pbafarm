/**
 * Company-local time for automation schedules (D-012, AUTO-007). Pure
 * functions over `Intl.DateTimeFormat`, so they are DST-safe and testable.
 *
 * The organization's zone comes from companies.timezone (lib/orgProfile,
 * default Africa/Accra = UTC+0, no DST), so the legacy 16:00 UTC reminder
 * keeps its time. An unknown zone falls back to UTC.
 */
export const DEFAULT_TIMEZONE = 'UTC'

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function zoneOrDefault(tz: string | undefined | null): string {
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(tz: string) {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatters.set(tz, f)
  }
  return f
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export type LocalParts = {
  date: string
  hhmm: string
  minutes: number
  weekday: number
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function localParts(ms: number, tz: string): LocalParts {
  const parts: Record<string, string> = {}
  for (const p of formatter(tz).formatToParts(new Date(ms))) parts[p.type] = p.value
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const hour = Number(parts.hour) % 24
  const minute = Number(parts.minute)
  const second = Number(parts.second)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    hhmm: `${pad(hour)}:${pad(minute)}`,
    minutes: hour * 60 + minute,
    weekday: WEEKDAYS.indexOf(parts.weekday),
    year,
    month,
    day,
    hour,
    minute,
    second,
  }
}

/** Offset of `tz` from UTC at instant `ms`, in ms (local − UTC). */
function offsetAt(ms: number, tz: string): number {
  const p = localParts(ms, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/**
 * UTC instant of a wall-clock time in `tz`. A time skipped by a DST jump
 * resolves to the instant just after the gap; a repeated time to its first
 * occurrence.
 */
export function zonedTimeToUtc(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  tz: string,
): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  const a = wall - offsetAt(wall, tz)
  const b = wall - offsetAt(a, tz)
  const wanted = hh * 60 + mm
  const hits = [a, b].filter((c) => localParts(c, tz).minutes === wanted)
  return hits.length ? Math.min(...hits) : Math.max(a, b)
}

export function parseHhmm(s: string): { hh: number; mm: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh > 23 || mm > 59) return null
  return { hh, mm }
}

/** Calendar date `days` after `date` (YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * Next time strictly after `afterMs` that the schedule fires: `localTime` on
 * an allowed weekday (all days when `daysOfWeek` is empty), in `tz`.
 */
export function nextRunAt(
  schedule: { localTime: string; daysOfWeek?: number[] },
  tz: string,
  afterMs: number,
): number | null {
  const t = parseHhmm(schedule.localTime)
  if (!t) return null
  const days = schedule.daysOfWeek?.length ? new Set(schedule.daysOfWeek) : null
  const start = localParts(afterMs, tz)
  for (let i = 0; i <= 8; i++) {
    const date = addDays(start.date, i)
    const [y, m, d] = date.split('-').map(Number)
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    if (days && !days.has(weekday)) continue
    const at: number = zonedTimeToUtc(y, m, d, t.hh, t.mm, tz)
    if (at > afterMs) return at
  }
  return null
}

/** Whether `ms` falls inside quiet hours (which may wrap past midnight). */
export function inQuietHours(
  quiet: { start: string; end: string } | undefined,
  ms: number,
  tz: string,
): boolean {
  if (!quiet) return false
  const s = parseHhmm(quiet.start)
  const e = parseHhmm(quiet.end)
  if (!s || !e) return false
  const start = s.hh * 60 + s.mm
  const end = e.hh * 60 + e.mm
  if (start === end) return false
  const now = localParts(ms, tz).minutes
  return start < end ? now >= start && now < end : now >= start || now < end
}
