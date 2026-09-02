import { useMemo } from 'react'
import { useCompanySettings } from '../contexts/CompanySettingsContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  DEFAULT_CURRENCY,
  formatCurrency as formatCurrencyBase,
  getCurrencyMeta,
  moneyUnitLabel,
  pricePerKgLabel,
  amountLabel,
} from '../lib/currencyUtils'

/**
 * Farm currency from company Global Settings, falling back to local prefs / GHS.
 */
export function useCurrency() {
  const { settings: companySettings } = useCompanySettings()
  const { settings: localSettings } = useSettings()

  const currency =
    companySettings?.locale?.currency ||
    localSettings?.currency ||
    DEFAULT_CURRENCY

  const meta = useMemo(() => getCurrencyMeta(currency), [currency])

  return useMemo(
    () => ({
      currency,
      symbol: meta.symbol,
      label: meta.label,
      shortLabel: meta.shortLabel,
      moneyUnitLabel: moneyUnitLabel(currency),
      pricePerKgLabel: pricePerKgLabel(currency),
      amountLabel: (noun) => amountLabel(currency, noun),
      formatCurrency: (amount, options = {}) =>
        formatCurrencyBase(amount, { ...options, currency }),
    }),
    [currency, meta],
  )
}
