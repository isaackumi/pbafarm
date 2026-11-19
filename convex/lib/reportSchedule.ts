import { localParts, nextRunAt, parseHhmm, zonedTimeToUtc } from '../automation/schedule'

/**
 * When a scheduled report (ANLY-007) next runs, in its own time zone. Daily
 * and weekly reuse the automation schedule maths (DST-safe); monthly days are
 * 1–28 so every month has them.
 */
export type ReportScheduleTiming = {
  frequency: 'daily' | 'weekly' | 'monthly'
  localTime: string
  /** 0 = Sunday … 6 = Saturday (weekly). */
  weekday?: number
  /** 1–28 (monthly). */
  dayOfMonth?: number
}

export function checkTiming(t: ReportScheduleTiming): string | null {
  if (!parseHhmm(t.localTime)) return 'Enter a time as HH:MM'
  if (t.frequency === 'weekly' && !(Number.isInteger(t.weekday) && t.weekday! >= 0 && t.weekday! <= 6)) {
    return 'Choose a weekday'
  }
  if (t.frequency === 'monthly' && !(Number.isInteger(t.dayOfMonth) && t.dayOfMonth! >= 1 && t.dayOfMonth! <= 28)) {
    return 'Choose a day of the month between 1 and 28'
  }
  return null
}

export function nextReportRun(t: ReportScheduleTiming, tz: string, afterMs: number): number | null {
  if (t.frequency === 'daily') return nextRunAt({ localTime: t.localTime }, tz, afterMs)
  if (t.frequency === 'weekly') return nextRunAt({ localTime: t.localTime, daysOfWeek: [t.weekday ?? 1] }, tz, afterMs)
  const time = parseHhmm(t.localTime)
  if (!time) return null
  const start = localParts(afterMs, tz)
  const day = Math.min(Math.max(t.dayOfMonth ?? 1, 1), 28)
  for (let i = 0; i <= 2; i++) {
    const y = start.year + Math.floor((start.month - 1 + i) / 12)
    const m = ((start.month - 1 + i) % 12) + 1
    const at = zonedTimeToUtc(y, m, day, time.hh, time.mm, tz)
    if (at > afterMs) return at
  }
  return null
}
