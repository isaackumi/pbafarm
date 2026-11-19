const num = (v) => (v === '' || v == null ? null : Number(v))

/**
 * Harvest form totals (PROD-903). Size grades are optional: blank grades count
 * as 0. A missing total weight is the sum of the grades, and a missing count
 * is total weight / ABW. `next` holds the derived values to put back in the form.
 */
export function deriveHarvestTotals({ sizeBreakdown, totalWeight, averageBodyWeight, estimatedCount }) {
  const grades = sizeBreakdown || []
  const badGrade = grades.find((s) => {
    const n = num(s.weight)
    return n != null && (!Number.isFinite(n) || n < 0)
  })
  const gradeSum = grades.reduce((sum, s) => sum + (parseFloat(s.weight) || 0), 0)

  const next = {}
  let total = num(totalWeight)
  if (total == null && gradeSum > 0) {
    total = Math.round(gradeSum * 100) / 100
    next.totalWeight = String(total)
  }
  const abw = num(averageBodyWeight)
  let count = num(estimatedCount)
  if (count == null && total > 0 && abw > 0) {
    count = Math.round((total * 1000) / abw)
    next.estimatedCount = String(count)
  }
  const mismatch = total > 0 && gradeSum > 0 && Math.abs(gradeSum - total) > 0.5
  return { badGrade, gradeSum, total, abw, count, next, mismatch }
}
