/**
 * Organization profile (M3, D-012): country, timezone, unit system and locale,
 * read with defaults so companies created before these fields existed behave
 * exactly as today (Ghana, metric).
 */
import type { Doc } from '../_generated/dataModel'

export const ORG_PROFILE_DEFAULTS = {
  country: 'GH',
  timezone: 'Africa/Accra',
  unitSystem: 'metric' as 'metric' | 'imperial',
  defaultLocale: 'en-GH',
}

/** UI languages with a committed catalog in /locales (I18N-002). */
export const SUPPORTED_UI_LOCALES = ['en', 'fr'] as const

export type OrgProfile = typeof ORG_PROFILE_DEFAULTS

export function orgProfile(
  company: Pick<Doc<'companies'>, 'country' | 'timezone' | 'unitSystem' | 'defaultLocale'> | null | undefined,
): OrgProfile {
  return {
    country: company?.country ?? ORG_PROFILE_DEFAULTS.country,
    timezone: company?.timezone ?? ORG_PROFILE_DEFAULTS.timezone,
    unitSystem: company?.unitSystem ?? ORG_PROFILE_DEFAULTS.unitSystem,
    defaultLocale: company?.defaultLocale ?? ORG_PROFILE_DEFAULTS.defaultLocale,
  }
}

/** IANA zone the runtime can resolve, e.g. 'Africa/Accra'. */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** BCP 47 tag, e.g. 'en-GH'. */
export function isValidLocale(tag: string): boolean {
  if (!tag) return false
  try {
    return Intl.getCanonicalLocales(tag).length === 1
  } catch {
    return false
  }
}

/** ISO 3166-1 alpha-2 shape. */
export function isValidCountry(code: string): boolean {
  return /^[A-Z]{2}$/.test(code)
}
