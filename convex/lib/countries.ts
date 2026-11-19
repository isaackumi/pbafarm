/**
 * Country presets (I18N-004): the defaults a country suggests for the
 * organization profile (time zone, locale, units), the phone country code,
 * the currency and which compliance template pack fits. No imports, so the
 * browser uses the same table (components/OrgProfileCard.js).
 *
 * Presets only suggest values: an admin applies them explicitly, field by
 * field, and the currency is never changed unless asked (amounts are not
 * converted, I18N-003).
 */

export type CountryPreset = {
  code: string
  /** English name; the UI shows Intl.DisplayNames in the user's language. */
  name: string
  timezone: string
  currency: string
  locale: string
  unitSystem: 'metric' | 'imperial'
  /** Compliance template pack recommended for this country (lib/compliance TEMPLATE_PACKS). */
  pack: string
}

const p = (
  code: string,
  name: string,
  timezone: string,
  currency: string,
  locale: string,
  pack = 'standard',
  unitSystem: 'metric' | 'imperial' = 'metric',
): CountryPreset => ({ code, name, timezone, currency, locale, unitSystem, pack })

export const COUNTRY_PRESETS: CountryPreset[] = [
  p('GH', 'Ghana', 'Africa/Accra', 'GHS', 'en-GH', 'gh'),
  p('CI', "Côte d'Ivoire", 'Africa/Abidjan', 'XOF', 'fr-CI', 'ci'),
  p('NG', 'Nigeria', 'Africa/Lagos', 'NGN', 'en-NG'),
  p('TG', 'Togo', 'Africa/Lome', 'XOF', 'fr-TG', 'fr'),
  p('BJ', 'Benin', 'Africa/Porto-Novo', 'XOF', 'fr-BJ', 'fr'),
  p('BF', 'Burkina Faso', 'Africa/Ouagadougou', 'XOF', 'fr-BF', 'fr'),
  p('SN', 'Senegal', 'Africa/Dakar', 'XOF', 'fr-SN', 'fr'),
  p('CM', 'Cameroon', 'Africa/Douala', 'XAF', 'fr-CM', 'fr'),
  p('KE', 'Kenya', 'Africa/Nairobi', 'KES', 'en-KE'),
  p('UG', 'Uganda', 'Africa/Kampala', 'UGX', 'en-UG'),
  p('TZ', 'Tanzania', 'Africa/Dar_es_Salaam', 'TZS', 'en-TZ'),
  p('RW', 'Rwanda', 'Africa/Kigali', 'RWF', 'en-RW'),
  p('ZM', 'Zambia', 'Africa/Lusaka', 'ZMW', 'en-ZM'),
  p('MW', 'Malawi', 'Africa/Blantyre', 'MWK', 'en-MW'),
  p('ZA', 'South Africa', 'Africa/Johannesburg', 'ZAR', 'en-ZA'),
  p('EG', 'Egypt', 'Africa/Cairo', 'EGP', 'en-EG'),
  p('GB', 'United Kingdom', 'Europe/London', 'GBP', 'en-GB'),
  p('NL', 'Netherlands', 'Europe/Amsterdam', 'EUR', 'nl-NL'),
  p('NO', 'Norway', 'Europe/Oslo', 'NOK', 'nb-NO'),
  p('IN', 'India', 'Asia/Kolkata', 'INR', 'en-IN'),
  p('US', 'United States', 'America/New_York', 'USD', 'en-US', 'standard', 'imperial'),
]

export function countryPreset(code: string | undefined | null): CountryPreset | null {
  if (!code) return null
  return COUNTRY_PRESETS.find((c) => c.code === code.toUpperCase()) ?? null
}

/** Profile and settings fields a preset can fill in. */
export const COUNTRY_DEFAULT_FIELDS = ['timezone', 'locale', 'units', 'phone', 'currency'] as const
export type CountryDefaultField = (typeof COUNTRY_DEFAULT_FIELDS)[number]
