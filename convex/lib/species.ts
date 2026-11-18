/**
 * Species configuration (I18N-004 partial, D-012): culture species per
 * organization with growth targets and harvest size grades. No imports, so
 * the browser shares the defaults and the grade-range wording.
 */

export type HarvestGrade = { key: string; label: string; minG?: number; maxG?: number }

export const MAX_HARVEST_GRADES = 12

/** The tilapia grades every harvest form used before species were configurable. */
export const DEFAULT_TILAPIA_GRADES: HarvestGrade[] = [
  { key: 'S3', label: 'S3', minG: 800 },
  { key: 'S2', label: 'S2', minG: 700, maxG: 800 },
  { key: 'S1', label: 'S1', minG: 600, maxG: 700 },
  { key: 'Reg', label: 'Reg', minG: 500, maxG: 600 },
  { key: 'Eco', label: 'Eco', minG: 400, maxG: 500 },
  { key: 'SS', label: 'SS', minG: 300, maxG: 400 },
  { key: 'SB', label: 'SB', minG: 200, maxG: 300 },
  { key: 'Rej', label: 'Rej', maxG: 200 },
]

export const DEFAULT_SPECIES = [
  {
    key: 'nile_tilapia',
    name: 'Nile tilapia',
    scientificName: 'Oreochromis niloticus',
    targetHarvestAbwG: 500,
    targetFcr: 1.6,
    expectedDailyGrowthG: 3,
    harvestGrades: DEFAULT_TILAPIA_GRADES,
  },
  {
    key: 'red_tilapia',
    name: 'Red tilapia',
    scientificName: 'Oreochromis spp.',
    targetHarvestAbwG: 500,
    targetFcr: 1.6,
    expectedDailyGrowthG: 3,
    harvestGrades: DEFAULT_TILAPIA_GRADES,
  },
  {
    key: 'african_catfish',
    name: 'African catfish',
    scientificName: 'Clarias gariepinus',
    targetHarvestAbwG: 1000,
    targetFcr: 1.2,
    expectedDailyGrowthG: 6,
    harvestGrades: [
      { key: 'L', label: 'Large', minG: 1000 },
      { key: 'M', label: 'Medium', minG: 600, maxG: 1000 },
      { key: 'S', label: 'Small', maxG: 600 },
    ],
  },
] as const

/** "800g above", "700g-800g", "less than 200g" — today's wording. */
export function gradeRange(g: { minG?: number; maxG?: number }): string {
  if (g.minG != null && g.maxG != null) return `${g.minG}g-${g.maxG}g`
  if (g.minG != null) return `${g.minG}g above`
  if (g.maxG != null) return `less than ${g.maxG}g`
  return ''
}

/** Problems with a grade list, or [] when it is valid. */
export function gradeProblems(grades: HarvestGrade[]): string[] {
  const problems: string[] = []
  if (grades.length > MAX_HARVEST_GRADES) problems.push(`At most ${MAX_HARVEST_GRADES} grades`)
  const keys = new Set<string>()
  for (const g of grades) {
    const key = g.key.trim()
    if (!key) problems.push('Every grade needs a code')
    else if (keys.has(key)) problems.push(`Grade ${key} appears twice`)
    keys.add(key)
    if (!g.label.trim()) problems.push(`Grade ${key || '?'} needs a name`)
    for (const n of [g.minG, g.maxG]) {
      if (n != null && (!Number.isFinite(n) || n < 0)) problems.push(`Grade ${key}: weights must be zero or more`)
    }
    if (g.minG != null && g.maxG != null && g.minG >= g.maxG) {
      problems.push(`Grade ${key}: the lower weight must be below the upper weight`)
    }
  }
  return problems
}
