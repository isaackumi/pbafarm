/**
 * Phone numbers in E.164 (INT-001, doc 18 §5).
 *
 * Staff type numbers the local way ("024 412 3456"); providers want E.164
 * ("+233244123456"). A number is read with the company's default country
 * (`companies.settings.defaultCountryCode`, 'GH' when unset).
 */

/** ISO 3166 alpha-2 → country calling code, for the markets we expect. */
export const COUNTRY_CALLING_CODES: Record<string, string> = {
  GH: '233',
  NG: '234',
  CI: '225',
  TG: '228',
  BJ: '229',
  BF: '226',
  SN: '221',
  CM: '237',
  KE: '254',
  UG: '256',
  TZ: '255',
  RW: '250',
  ZM: '260',
  MW: '265',
  ZA: '27',
  EG: '20',
  GB: '44',
  US: '1',
  CA: '1',
  NL: '31',
  NO: '47',
  IN: '91',
}

export const DEFAULT_COUNTRY = 'GH'

export function isSupportedCountry(code: string | undefined): boolean {
  return !!code && Object.prototype.hasOwnProperty.call(COUNTRY_CALLING_CODES, code)
}

/**
 * E.164 form of `raw`, or null when it cannot be a phone number.
 * - "+233 24 412 3456", "00233244123456" → "+233244123456"
 * - "0244123456" with GH → "+233244123456" (trunk 0 dropped)
 * - "233244123456" with GH → "+233244123456" (already has the country code)
 * - "244123456" with GH → "+233244123456"
 */
export function normalizePhone(
  raw: string | undefined | null,
  defaultCountry: string = DEFAULT_COUNTRY,
): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Only digits and the usual separators; letters mean it is not a number.
  if (!/^[+\d\s().-]+$/.test(trimmed)) return null
  let digits = trimmed.replace(/[^\d]/g, '')
  const cc = COUNTRY_CALLING_CODES[defaultCountry] ?? COUNTRY_CALLING_CODES[DEFAULT_COUNTRY]
  let international: string
  if (trimmed.startsWith('+')) {
    international = digits
  } else if (digits.startsWith('00')) {
    international = digits.slice(2)
  } else if (digits.startsWith('0')) {
    international = cc + digits.replace(/^0+/, '')
  } else if (digits.startsWith(cc) && digits.length > cc.length + 7) {
    international = digits
  } else {
    international = cc + digits
  }
  digits = international
  // E.164: at most 15 digits; at least 8 is a sane floor for a mobile.
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null
  return `+${digits}`
}

/** "+233 ••• ••• 456" style mask for showing where a code went. */
export function maskPhone(e164: string | undefined | null): string {
  if (!e164) return ''
  const tail = e164.slice(-3)
  const head = e164.slice(0, Math.min(4, e164.length - 3))
  return `${head} ••• ••${tail}`
}
