import { formatMoney } from './money'

/** Currencies without a minor unit: amounts are stored in whole units (convex/billing/tables.ts). */
const ZERO_DECIMAL = new Set(['XOF', 'XAF', 'JPY', 'KRW', 'RWF', 'UGX'])

export function minorDigits(currency) {
  return ZERO_DECIMAL.has(currency) ? 0 : 2
}

/** 25000 GHS (pesewas) → "GHS 250.00"; 12500 XOF → "XOF 12,500". */
export function formatMinor(amountMinor, currency) {
  const digits = minorDigits(currency)
  return formatMoney((Number(amountMinor) || 0) / 10 ** digits, currency, { decimals: digits })
}

/** Amount typed in major units ("250.5") → integer minor units, or null. */
export function toMinor(input, currency) {
  const n = Number(String(input ?? '').replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 10 ** minorDigits(currency))
}

export function formatDate(ms) {
  if (ms === null || ms === undefined) return '—'
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDateTime(ms) {
  if (ms === null || ms === undefined) return '—'
  return new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
