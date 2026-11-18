/**
 * Business dates (D-012, I18N-001, doc 04 §5).
 *
 * Every operational date is a `YYYY-MM-DD` string meaning the farm's local
 * calendar day. "Today" therefore depends on the site's time zone, falling
 * back to the organization's (lib/orgProfile, default Africa/Accra = UTC+0,
 * which is what every existing tenant had before time zones existed).
 *
 * daysBetween (lib/kpi) is the only day-count convention; it is re-exported
 * here so date code has one import.
 */
import type { QueryCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { daysBetween } from './kpi'
import { isValidTimezone, orgProfile } from './orgProfile'

export { daysBetween }

type Ctx = QueryCtx | MutationCtx

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** The calendar date at `now` in `timeZone`, as `YYYY-MM-DD`. Invalid zones use UTC. */
export function todayIn(timeZone: string | undefined | null, now: number = Date.now()): string {
  const zone = timeZone && isValidTimezone(timeZone) ? timeZone : 'UTC'
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now))
}

/** The zone that decides "today" for a site: its own, else its company's. */
export function zoneFor(
  site: Pick<Doc<'farmLocations'>, 'timezone'> | null | undefined,
  company: Parameters<typeof orgProfile>[0],
): string {
  return site?.timezone || orgProfile(company).timezone
}

/**
 * Today's business date for a site (or the company when no site is given).
 * Reads the site and company rows; for mutations and internal jobs.
 */
export async function todayFor(
  ctx: Ctx,
  opts: { locationId?: Id<'farmLocations'> | null; companyId?: Id<'companies'> | null },
  now: number = Date.now(),
): Promise<string> {
  const site = opts.locationId ? await ctx.db.get(opts.locationId) : null
  const companyId = opts.companyId ?? site?.companyId
  const company = companyId ? await ctx.db.get(companyId) : null
  return todayIn(zoneFor(site, company), now)
}

/** A real calendar date in `YYYY-MM-DD` form. */
export function isBusinessDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const d = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** `YYYY-MM-DD` shifted by `days` (negative for earlier). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
