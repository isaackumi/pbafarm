/**
 * Currency formatting — default Ghanaian Cedis (GHS / ₵)
 * unless Global Settings (or an explicit option) says otherwise.
 */

export const CURRENCIES = {
  GHS: {
    code: 'GHS',
    symbol: '₵',
    label: 'Ghanaian Cedi',
    shortLabel: 'Cedis',
  },
  USD: {
    code: 'USD',
    symbol: '$',
    label: 'US Dollar',
    shortLabel: 'USD',
  },
  EUR: {
    code: 'EUR',
    symbol: '€',
    label: 'Euro',
    shortLabel: 'EUR',
  },
}

export const DEFAULT_CURRENCY = 'GHS'

export function getCurrencyMeta(code = DEFAULT_CURRENCY) {
  return CURRENCIES[code] || CURRENCIES[DEFAULT_CURRENCY]
}

export const formatCurrency = (amount, options = {}) => {
  const {
    showSymbol = true,
    decimals = 2,
    compact = false,
    currency = DEFAULT_CURRENCY,
  } = options

  const meta = getCurrencyMeta(currency)
  const value = Number(amount)
  const safe = Number.isFinite(value) ? value : 0

  const formatter = new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: meta.code,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    notation: compact ? 'compact' : 'standard',
  })

  let formatted = formatter.format(safe)

  if (showSymbol) {
    // Prefer compact symbols (₵ / $ / €) over ISO codes in UI
    formatted = formatted
      .replace(meta.code, meta.symbol)
      .replace('GHS', '₵')
  } else {
    formatted = formatted.replace(meta.code, '').replace(meta.symbol, '')
  }

  return formatted.trim()
}

/** Label helpers for form fields, e.g. "Price per kg (₵)" */
export function moneyUnitLabel(currency = DEFAULT_CURRENCY) {
  return getCurrencyMeta(currency).symbol
}

export function pricePerKgLabel(currency = DEFAULT_CURRENCY) {
  const meta = getCurrencyMeta(currency)
  return `Price per kg (${meta.symbol})`
}

export function amountLabel(currency = DEFAULT_CURRENCY, noun = 'Amount') {
  const meta = getCurrencyMeta(currency)
  return `${noun} (${meta.symbol})`
}

export const parseCurrency = (value) => {
  if (typeof value === 'number') return value
  const numericString = String(value).replace(/[^0-9.]/g, '')
  return parseFloat(numericString) || 0
}

export const calculateTotal = (items, priceField = 'price', quantityField = 'quantity') => {
  return items.reduce((total, item) => {
    const price = parseFloat(item[priceField]) || 0
    const quantity = parseFloat(item[quantityField]) || 0
    return total + price * quantity
  }, 0)
}

export const formatPercentage = (value, decimals = 1) => {
  return `${(value * 100).toFixed(decimals)}%`
}

export const formatWeight = (value, unit = 'kg') => {
  return `${parseFloat(value).toFixed(2)} ${unit}`
}

export const formatNumber = (value, options = {}) => {
  const { decimals = 2, compact = false } = options
  const formatter = new Intl.NumberFormat('en-GH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    notation: compact ? 'compact' : 'standard',
  })
  return formatter.format(value)
}
