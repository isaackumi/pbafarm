/**
 * Currencies an organization can work in (I18N-003, D-012). No imports, so
 * the browser uses the same list (lib/currencyUtils.js). Amounts are stored in
 * the organization's currency; there is no FX conversion yet.
 */
export const CURRENCY_LIST = [
  { code: 'GHS', symbol: '₵', label: 'Ghanaian cedi', shortLabel: 'Cedis' },
  { code: 'USD', symbol: '$', label: 'US dollar', shortLabel: 'USD' },
  { code: 'EUR', symbol: '€', label: 'Euro', shortLabel: 'EUR' },
  { code: 'GBP', symbol: '£', label: 'Pound sterling', shortLabel: 'GBP' },
  { code: 'NGN', symbol: '₦', label: 'Nigerian naira', shortLabel: 'Naira' },
  { code: 'KES', symbol: 'KSh', label: 'Kenyan shilling', shortLabel: 'KES' },
  { code: 'UGX', symbol: 'USh', label: 'Ugandan shilling', shortLabel: 'UGX' },
  { code: 'TZS', symbol: 'TSh', label: 'Tanzanian shilling', shortLabel: 'TZS' },
  { code: 'RWF', symbol: 'FRw', label: 'Rwandan franc', shortLabel: 'RWF' },
  { code: 'ZAR', symbol: 'R', label: 'South African rand', shortLabel: 'Rand' },
  { code: 'XOF', symbol: 'CFA', label: 'West African CFA franc', shortLabel: 'XOF' },
  { code: 'XAF', symbol: 'FCFA', label: 'Central African CFA franc', shortLabel: 'XAF' },
  { code: 'EGP', symbol: 'E£', label: 'Egyptian pound', shortLabel: 'EGP' },
  { code: 'ZMW', symbol: 'ZK', label: 'Zambian kwacha', shortLabel: 'ZMW' },
  { code: 'MWK', symbol: 'MK', label: 'Malawian kwacha', shortLabel: 'MWK' },
  { code: 'INR', symbol: '₹', label: 'Indian rupee', shortLabel: 'INR' },
  { code: 'BDT', symbol: '৳', label: 'Bangladeshi taka', shortLabel: 'BDT' },
  { code: 'VND', symbol: '₫', label: 'Vietnamese dong', shortLabel: 'VND' },
  { code: 'IDR', symbol: 'Rp', label: 'Indonesian rupiah', shortLabel: 'IDR' },
  { code: 'PHP', symbol: '₱', label: 'Philippine peso', shortLabel: 'PHP' },
  { code: 'THB', symbol: '฿', label: 'Thai baht', shortLabel: 'THB' },
  { code: 'CNY', symbol: '¥', label: 'Chinese yuan', shortLabel: 'CNY' },
  { code: 'BRL', symbol: 'R$', label: 'Brazilian real', shortLabel: 'BRL' },
  { code: 'MXN', symbol: 'MX$', label: 'Mexican peso', shortLabel: 'MXN' },
  { code: 'NOK', symbol: 'kr', label: 'Norwegian krone', shortLabel: 'NOK' },
  { code: 'CLP', symbol: 'CLP$', label: 'Chilean peso', shortLabel: 'CLP' },
] as const

export type CurrencyCode = (typeof CURRENCY_LIST)[number]['code']

export const CURRENCY_CODES = CURRENCY_LIST.map((c) => c.code) as CurrencyCode[]

export const DEFAULT_CURRENCY_CODE: CurrencyCode = 'GHS'

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCY_CODES as string[]).includes(value)
}
