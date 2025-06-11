/**
 * Currency formatting utilities for consistent display of Ghanaian Cedis (₵)
 */

export const formatCurrency = (amount, options = {}) => {
  const {
    showSymbol = true,
    decimals = 2,
    compact = false
  } = options

  const formatter = new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    notation: compact ? 'compact' : 'standard'
  })

  let formatted = formatter.format(amount)
  
  // Replace GHS with ₵ if showSymbol is true
  if (showSymbol) {
    formatted = formatted.replace('GHS', '₵')
  } else {
    formatted = formatted.replace('GHS', '')
  }

  return formatted.trim()
}

export const parseCurrency = (value) => {
  if (typeof value === 'number') return value
  
  // Remove currency symbol and any non-numeric characters except decimal point
  const numericString = value.replace(/[^0-9.]/g, '')
  return parseFloat(numericString) || 0
}

export const calculateTotal = (items, priceField = 'price', quantityField = 'quantity') => {
  return items.reduce((total, item) => {
    const price = parseFloat(item[priceField]) || 0
    const quantity = parseFloat(item[quantityField]) || 0
    return total + (price * quantity)
  }, 0)
}

export const formatPercentage = (value, decimals = 1) => {
  return `${(value * 100).toFixed(decimals)}%`
}

export const formatWeight = (value, unit = 'kg') => {
  return `${parseFloat(value).toFixed(2)} ${unit}`
}

export const formatNumber = (value, options = {}) => {
  const {
    decimals = 2,
    compact = false
  } = options

  const formatter = new Intl.NumberFormat('en-GH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    notation: compact ? 'compact' : 'standard'
  })

  return formatter.format(value)
} 