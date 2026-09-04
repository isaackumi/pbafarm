/** Common culture species for Ghana / West Africa cage farms. */
export const FISH_SPECIES = [
  { value: 'nile_tilapia', label: 'Nile tilapia' },
  { value: 'african_catfish', label: 'African catfish' },
  { value: 'red_tilapia', label: 'Red tilapia' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'other', label: 'Other' },
]

export function speciesLabel(value) {
  if (!value) return '—'
  return FISH_SPECIES.find((s) => s.value === value)?.label || value
}
