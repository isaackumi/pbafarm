/**
 * AI phrasing of the dashboard insights (Phase 13). The insights and their
 * numbers are computed deterministically (convex/lib/insights.ts); a model
 * may only reword them. A reworded line that drops the unit name or carries a
 * number the facts do not contain is rejected and the original title is kept.
 */

export function phrasingMessages(insights) {
  const items = insights.map((i, n) => ({
    n: n + 1,
    unit: i.unit_name,
    title: i.title,
    detail: i.detail,
  }))
  return [
    {
      role: 'system',
      content:
        'You rewrite fish farm alerts for a farm manager. For each item write one short, plain sentence (max 25 words) that says what happened and what to check. Keep the unit name. Use only numbers and dates that appear in the item; do not add any. Reply with a JSON array of strings only, one per item, in order.',
    },
    { role: 'user', content: JSON.stringify(items) },
  ]
}

const numbersIn = (text) => (String(text).match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n)))

/** Whether a reworded line keeps the unit and adds no number. */
export function grounded(line, insight) {
  if (typeof line !== 'string' || !line.trim() || line.length > 280) return false
  if (!line.includes(insight.unit_name)) return false
  // Digits in the unit name ("B2") are not facts.
  const strip = (text) => String(text).split(insight.unit_name).join(' ')
  const allowed = new Set([
    ...numbersIn(strip(insight.title)),
    ...numbersIn(strip(insight.detail)),
    ...Object.values(insight.facts || {}).flatMap((v) => numbersIn(v ?? '')),
  ])
  return numbersIn(strip(line)).every((n) => allowed.has(n))
}

/** The model's reply applied to the insights: `phrased` per insight, or null. */
export function applyPhrasing(insights, reply) {
  let lines = null
  try {
    const start = reply.indexOf('[')
    const end = reply.lastIndexOf(']')
    lines = JSON.parse(reply.slice(start, end + 1))
  } catch {
    lines = null
  }
  return insights.map((i, n) => {
    const line = Array.isArray(lines) ? lines[n] : null
    return { ...i, phrased: grounded(line, i) ? line.trim() : null }
  })
}
