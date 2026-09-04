/** Mortality cause codes for daily entry. */
export const MORTALITY_CAUSES = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'disease', label: 'Disease' },
  { value: 'do_crash', label: 'Low DO / oxygen' },
  { value: 'predator', label: 'Predator' },
  { value: 'theft', label: 'Theft / escape' },
  { value: 'cull', label: 'Cull' },
  { value: 'handling', label: 'Handling / transfer' },
  { value: 'other', label: 'Other' },
]

export function mortalityCauseLabel(value) {
  if (!value) return '—'
  return MORTALITY_CAUSES.find((c) => c.value === value)?.label || value
}

/** Common diagnosis labels (free text still allowed). */
export const DIAGNOSIS_SUGGESTIONS = [
  'Bacterial infection',
  'Fungal infection',
  'Parasites',
  'Columnaris',
  'Streptococcus',
  'Stress / handling',
  'Suspected DO-related',
  'Other / undiagnosed',
]
