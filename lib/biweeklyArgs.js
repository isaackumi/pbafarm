/** Arguments for api.biweeklyRecords.update: snake_case form fields to a camelCase patch. */
export function biweeklyPatchArgs(id, updates) {
  const num = (a, b) => (a != null || b != null ? Number(a ?? b) : undefined)
  const patch = {
    date: updates.date,
    batchCode: updates.batch_code || updates.batchCode,
    averageBodyWeight: num(updates.average_body_weight, updates.averageBodyWeight),
    totalFishCount: num(updates.total_fish_count, updates.totalFishCount),
    totalWeight: num(updates.total_weight, updates.totalWeight),
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') delete patch[k]
  }
  return { id, patch }
}
