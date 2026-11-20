import { getActiveLocale } from './format'

/**
 * Money the way the finance artboards print it (Paper 10, 19, 24): the
 * currency symbol, a space, then the number: "GH₵ 74,400", "GH₵ 8.90",
 * compact "GH₵ 1.84M" / "GH₵ 610k" (three significant digits, lowercase k).
 * Negative amounts lead with a minus sign: "−GH₵ 1.02M".
 */
const symbols = new Map()

export function currencySymbol(currency = 'GHS') {
  if (!symbols.has(currency)) {
    let symbol = currency
    try {
      const part = new Intl.NumberFormat('en-GH', { style: 'currency', currency })
        .formatToParts(0)
        .find((p) => p.type === 'currency')
      if (part) symbol = part.value
    } catch {
      // Unknown ISO code: fall back to the code itself.
    }
    symbols.set(currency, symbol)
  }
  return symbols.get(currency)
}

export function paperMoney(amount, currency = 'GHS', { decimals = 0, compact = false, locale = getActiveLocale() } = {}) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const number =
    compact && abs >= 1000
      ? new Intl.NumberFormat(locale, { notation: 'compact', maximumSignificantDigits: 3 }).format(abs).replace('K', 'k')
      : new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(abs)
  return `${n < 0 ? '−' : ''}${currencySymbol(currency)} ${number}`
}
