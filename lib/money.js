import { useCallback } from 'react'
import { useCompanySettings } from '../contexts/CompanySettingsContext'

/** Format an amount in the company's currency (GHS → GH₵ 1,234.50). */
export function formatMoney(amount, currency = 'GHS', { decimals = 2 } = {}) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n)
  } catch {
    return `${currency} ${n.toFixed(decimals)}`
  }
}

/** Hook: money(amount) using the signed-in company's currency. */
export function useMoney() {
  const { currency } = useCompanySettings()
  return useCallback(
    (amount, opts) => formatMoney(amount, currency || 'GHS', opts),
    [currency],
  )
}
