/**
 * Build / parse feed-type description metadata (protein, bag size, pellet).
 * Bag size always comes from the form's bag_size_kg field on submit.
 */

export function normalizeBagSizeKg(value, fallback = 25) {
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) return n
  return fallback
}

/** e.g. "Protein 40% · 20Kg bags · Pellet 2mm" */
export function buildFeedTypeDescription({
  protein,
  protein_percentage,
  protein_content,
  pellet,
  pellet_size,
  bagSizeKg,
  bag_size_kg,
} = {}) {
  const proteinVal = protein ?? protein_percentage ?? protein_content
  const pelletVal = pellet ?? pellet_size
  const bag = normalizeBagSizeKg(bagSizeKg ?? bag_size_kg, 0)

  const parts = []
  if (proteinVal !== '' && proteinVal != null) {
    parts.push(`Protein ${proteinVal}%`)
  }
  if (bag > 0) {
    parts.push(`${bag}Kg bags`)
  }
  if (typeof pelletVal === 'string' && pelletVal.trim()) {
    parts.push(`Pellet ${pelletVal.trim()}`)
  }
  return parts.length ? parts.join(' · ') : undefined
}

export function parseFeedTypeDescription(description) {
  let protein_percentage = null
  let bag_size_kg = null
  let pellet_size = ''
  if (!description) {
    return { protein_percentage, bag_size_kg, pellet_size }
  }
  const proteinMatch = description.match(/Protein\s+([\d.]+)\s*%/i)
  if (proteinMatch) {
    const n = Number(proteinMatch[1])
    if (!Number.isNaN(n)) protein_percentage = n
  }
  const bagMatch = description.match(/([\d.]+)\s*[Kk]g\s*bags/i)
  if (bagMatch) {
    const n = Number(bagMatch[1])
    if (!Number.isNaN(n) && n > 0) bag_size_kg = n
  }
  const pelletMatch = description.match(/Pellet\s+([^·|]+)/i)
  if (pelletMatch) pellet_size = pelletMatch[1].trim()
  return { protein_percentage, bag_size_kg, pellet_size }
}
