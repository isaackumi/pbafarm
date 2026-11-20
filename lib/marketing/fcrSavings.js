/**
 * The landing page's "What 0.1 of FCR is worth" calculator (Paper v4).
 * Fish harvested a year = cages × tonnes per cage; feed saved = that × the
 * FCR improvement (kg of feed per kg of fish); money saved = feed saved ×
 * the feed price per kg. An illustration, not a forecast.
 */
export function fcrSavings({ cages, tonnesPerCage, improvement, pricePerKg }) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  const fishTonnes = num(cages) * num(tonnesPerCage)
  const feedTonnes = fishTonnes * num(improvement)
  const amount = feedTonnes * 1000 * num(pricePerKg)
  return {
    fishTonnes: Math.round(fishTonnes * 10) / 10,
    feedTonnes: Math.round(feedTonnes * 100) / 100,
    amount: Math.round(amount),
  }
}

/** Grouped whole currency for the result ("94,080"). */
export function formatAmount(n, locale = 'en') {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(n))
}

/** Up to one decimal, no trailing zero ("96", "9.6"). */
export function formatTonnes(n, locale = 'en') {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n)
}
