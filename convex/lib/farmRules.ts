/**
 * Farm settings defaults + enforcement helpers.
 * Missing company fields resolve to these defaults (today's hardcoded behavior).
 */
import { DEFAULT_CURRENCY_CODE, isCurrencyCode, type CurrencyCode } from './currencies'

export const DEFAULT_SETTINGS = {
  aiAssistantEnabled: false,
  branding: {
    displayName: undefined as string | undefined,
    accentHex: '#18181B',
    themeMode: 'light' as 'light' | 'dark' | 'system',
  },
  farmRules: {
    targetHarvestAbwG: 600,
    harvestDocMinDays: 150,
    harvestDocMaxDays: 210,
    maxDensityFishPerM3: 80,
    /** Ponds (fish per m² of surface). */
    maxDensityFishPerM2: 5,
    /** Tanks, raceways and RAS (fish per m³); 0 = use maxDensityFishPerM3. */
    maxDensityTankFishPerM3: 0,
    /** Warn at this % of the density limit. */
    densityWarnPct: 90,
    dailyMortalityAlertPct: 0.5,
    cumulativeMortalityAlertPct: 10,
    targetFcr: 1.4,
    maxFcrAlert: 1.8,
  },
  stockingRules: {
    requireApprovalForStocking: true,
    requireApprovalForTopup: true,
    requireApprovalForFishTransfer: true,
    /** Segregation of duties: requester cannot approve (PERM-005). */
    requireDifferentApprover: false,
    enforceCageCapacity: true,
    /** Fingerlings through small juveniles (grams). */
    minInitialAbwG: 1,
    maxInitialAbwG: 500,
    /** Top-ups may match current culture size, not only fingerlings. */
    minTopupAbwG: 1,
    maxTopupAbwG: 800,
    allowStockOnlyEmptyStatuses: ['empty', 'fallow', 'harvested'] as string[],
  },
  feedRules: {
    defaultBagSizeKg: 20,
    defaultLocation: 'Main store',
    allowNegativeStock: false,
    trackLots: true,
    lowStockMultiplier: 1,
    requireBatchOnPurchase: false,
  },
  /** Display / money defaults for the whole farm. */
  locale: {
    currency: DEFAULT_CURRENCY_CODE as CurrencyCode,
  },
}

export type EffectiveSettings = {
  aiAssistantEnabled: boolean
  branding: {
    displayName?: string
    accentHex: string
    themeMode: 'light' | 'dark' | 'system'
  }
  farmRules: {
    targetHarvestAbwG: number
    harvestDocMinDays: number
    harvestDocMaxDays: number
    maxDensityFishPerM3: number
    maxDensityFishPerM2: number
    maxDensityTankFishPerM3: number
    densityWarnPct: number
    dailyMortalityAlertPct: number
    cumulativeMortalityAlertPct: number
    targetFcr: number
    maxFcrAlert: number
  }
  stockingRules: {
    requireApprovalForStocking: boolean
    requireApprovalForTopup: boolean
    requireApprovalForFishTransfer: boolean
    requireDifferentApprover: boolean
    enforceCageCapacity: boolean
    minInitialAbwG: number
    maxInitialAbwG: number
    minTopupAbwG: number
    maxTopupAbwG: number
    allowStockOnlyEmptyStatuses: string[]
  }
  feedRules: {
    defaultBagSizeKg: number
    defaultLocation: string
    allowNegativeStock: boolean
    trackLots: boolean
    lowStockMultiplier: number
    requireBatchOnPurchase: boolean
  }
  locale: {
    currency: CurrencyCode
  }
  updatedAt?: number
}

export function mergeSettings(raw?: any): EffectiveSettings {
  const s = raw || {}
  return {
    aiAssistantEnabled: s.aiAssistantEnabled === true,
    branding: {
      displayName: s.branding?.displayName,
      accentHex: s.branding?.accentHex || DEFAULT_SETTINGS.branding.accentHex,
      themeMode: s.branding?.themeMode || DEFAULT_SETTINGS.branding.themeMode,
    },
    farmRules: {
      ...DEFAULT_SETTINGS.farmRules,
      ...(s.farmRules || {}),
    },
    stockingRules: {
      ...DEFAULT_SETTINGS.stockingRules,
      ...(s.stockingRules || {}),
      allowStockOnlyEmptyStatuses:
        s.stockingRules?.allowStockOnlyEmptyStatuses ||
        DEFAULT_SETTINGS.stockingRules.allowStockOnlyEmptyStatuses,
      // Lift legacy published default (5–80g) so farms can stock fry/juveniles
      // without a settings visit. Custom ranges other than exactly 5/80 are kept.
      ...(() => {
        const min = s.stockingRules?.minInitialAbwG
        const max = s.stockingRules?.maxInitialAbwG
        if (min === 5 && max === 80) {
          return {
            minInitialAbwG: DEFAULT_SETTINGS.stockingRules.minInitialAbwG,
            maxInitialAbwG: DEFAULT_SETTINGS.stockingRules.maxInitialAbwG,
          }
        }
        return {}
      })(),
    },
    feedRules: {
      ...DEFAULT_SETTINGS.feedRules,
      ...(s.feedRules || {}),
      allowNegativeStock: s.feedRules?.allowNegativeStock === true,
      trackLots: s.feedRules?.trackLots !== false,
      requireBatchOnPurchase: s.feedRules?.requireBatchOnPurchase === true,
      defaultLocation:
        s.feedRules?.defaultLocation || DEFAULT_SETTINGS.feedRules.defaultLocation,
    },
    locale: {
      currency: isCurrencyCode(s.locale?.currency)
        ? s.locale.currency
        : DEFAULT_SETTINGS.locale.currency,
    },
    updatedAt: s.updatedAt,
  }
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function validateSettingsForPublish(settings: any) {
  const errors: string[] = []
  const accent = settings?.branding?.accentHex
  if (accent && !HEX_RE.test(accent)) {
    errors.push('Accent color must be a hex value like #18181B')
  }
  const mode = settings?.branding?.themeMode
  if (mode && !['light', 'dark', 'system'].includes(mode)) {
    errors.push('Theme mode must be light, dark, or system')
  }
  const fr = settings?.farmRules || {}
  const sr = settings?.stockingRules || {}
  const feed = settings?.feedRules || {}
  const num = (v: any, label: string, min = 0) => {
    if (v === undefined || v === null || v === '') return
    const n = Number(v)
    if (!Number.isFinite(n) || n < min) errors.push(`${label} must be a number ≥ ${min}`)
  }
  num(fr.targetHarvestAbwG, 'Target harvest ABW')
  num(fr.harvestDocMinDays, 'Harvest DOC min')
  num(fr.harvestDocMaxDays, 'Harvest DOC max')
  num(fr.maxDensityFishPerM3, 'Max density')
  num(fr.maxDensityFishPerM2, 'Max pond density')
  num(fr.maxDensityTankFishPerM3, 'Max tank density')
  num(fr.densityWarnPct, 'Density warning %')
  if (fr.densityWarnPct != null && fr.densityWarnPct !== '' && Number(fr.densityWarnPct) > 100) {
    errors.push('Density warning % must be at most 100')
  }
  num(fr.dailyMortalityAlertPct, 'Daily mortality alert %')
  num(fr.cumulativeMortalityAlertPct, 'Cumulative mortality alert %')
  num(fr.targetFcr, 'Target FCR', 0.01)
  num(fr.maxFcrAlert, 'Max FCR alert', 0.01)
  num(sr.minInitialAbwG, 'Min initial ABW')
  num(sr.maxInitialAbwG, 'Max initial ABW')
  num(sr.minTopupAbwG, 'Min top-up ABW')
  num(sr.maxTopupAbwG, 'Max top-up ABW')
  num(feed.defaultBagSizeKg, 'Default bag size (kg)', 0.01)
  num(feed.lowStockMultiplier, 'Low-stock multiplier', 0.01)
  if (feed.defaultLocation != null && String(feed.defaultLocation).trim() === '') {
    errors.push('Default store location cannot be empty')
  }
  const currency = settings?.locale?.currency
  if (currency && !isCurrencyCode(currency)) {
    errors.push(`Currency ${currency} is not supported`)
  }

  if (
    fr.harvestDocMinDays != null &&
    fr.harvestDocMaxDays != null &&
    Number(fr.harvestDocMinDays) > Number(fr.harvestDocMaxDays)
  ) {
    errors.push('Harvest DOC min cannot exceed max')
  }
  if (
    sr.minInitialAbwG != null &&
    sr.maxInitialAbwG != null &&
    Number(sr.minInitialAbwG) > Number(sr.maxInitialAbwG)
  ) {
    errors.push('Min initial ABW cannot exceed max')
  }
  if (
    sr.minTopupAbwG != null &&
    sr.maxTopupAbwG != null &&
    Number(sr.minTopupAbwG) > Number(sr.maxTopupAbwG)
  ) {
    errors.push('Min top-up ABW cannot exceed max')
  }
  if (errors.length) throw new Error(errors.join('; '))
}

export type UnitType =
  | 'cage'
  | 'pond'
  | 'tank'
  | 'raceway'
  | 'hatchery_tank'
  | 'incubator'
  | 'hapa'

/** A unit's type; rows written before unit types existed are cages. */
export function unitTypeOf(unit: { unitType?: UnitType | null } | null | undefined): UnitType {
  return unit?.unitType ?? 'cage'
}

/** Units whose stocking density is measured per m² of surface, not per m³. */
export const AREA_BASED_UNITS: ReadonlySet<UnitType> = new Set(['pond'])

/** Units measured by water volume in tanks (RAS, flow-through). */
export const TANK_UNITS: ReadonlySet<UnitType> = new Set([
  'tank',
  'raceway',
  'hatchery_tank',
  'incubator',
])

export type DensityBasis = {
  /** 'area' (fish/m²) or 'volume' (fish/m³). */
  measure: 'area' | 'volume'
  /** The m² or m³ the density divides by, or null when the unit has none. */
  size: number | null
  /** Where size came from, e.g. "net volume". */
  sizeLabel: string
  max: number | null
  unit: string
}

/**
 * How a unit's stocking density is measured (FARM-002, CAGE-001, POND-001,
 * RAS-001): ponds and hapas per m² of surface (areaM2); cages per m³ inside
 * the net (netVolumeM3, else volumeM3, else legacy size); tanks, raceways and
 * RAS per m³ of water (volumeM3, else size). The limit is the unit's own
 * maxDensity, else the farm rule for its type.
 */
export function densityBasis(unit: any, farmRules: EffectiveSettings['farmRules']): DensityBasis {
  const type = unitTypeOf(unit)
  const own = unit?.maxDensity > 0 ? Number(unit.maxDensity) : null
  if (AREA_BASED_UNITS.has(type)) {
    const area = unit?.areaM2 > 0 ? Number(unit.areaM2) : null
    return {
      measure: 'area',
      size: area,
      sizeLabel: 'surface area',
      max: own ?? (farmRules.maxDensityFishPerM2 || null),
      unit: 'fish/m²',
    }
  }
  if (type === 'cage') {
    const net = unit?.netVolumeM3 > 0 ? Number(unit.netVolumeM3) : null
    const vol = unit?.volumeM3 > 0 ? Number(unit.volumeM3) : unit?.size > 0 ? Number(unit.size) : null
    return {
      measure: 'volume',
      size: net ?? vol,
      sizeLabel: net ? 'net volume' : 'volume',
      max: own ?? (farmRules.maxDensityFishPerM3 || null),
      unit: 'fish/m³',
    }
  }
  const vol = unit?.volumeM3 > 0 ? Number(unit.volumeM3) : unit?.size > 0 ? Number(unit.size) : null
  const tankMax = TANK_UNITS.has(type)
    ? farmRules.maxDensityTankFishPerM3 || farmRules.maxDensityFishPerM3
    : farmRules.maxDensityFishPerM3
  return {
    measure: 'volume',
    size: vol,
    sizeLabel: 'water volume',
    max: own ?? (tankMax || null),
    unit: 'fish/m³',
  }
}

export type DensityStatus = {
  density: number | null
  max: number | null
  unit: string
  measure: 'area' | 'volume'
  sizeLabel: string
  /** density ÷ max × 100. */
  pctOfMax: number | null
  level: 'ok' | 'warn' | 'over' | 'unknown'
}

/** Density of `fishCount` in a unit, against its limit and the warning band. */
export function densityStatus(
  unit: any,
  fishCount: number,
  farmRules: EffectiveSettings['farmRules'],
): DensityStatus {
  const b = densityBasis(unit, farmRules)
  if (!b.size) {
    return { density: null, max: b.max, unit: b.unit, measure: b.measure, sizeLabel: b.sizeLabel, pctOfMax: null, level: 'unknown' }
  }
  const density = fishCount / b.size
  const pct = b.max ? (density / b.max) * 100 : null
  const warnAt = farmRules.densityWarnPct > 0 ? farmRules.densityWarnPct : 90
  const level = pct == null ? 'unknown' : pct > 100 ? 'over' : pct >= warnAt ? 'warn' : 'ok'
  return {
    density: Math.round(density * 100) / 100,
    max: b.max,
    unit: b.unit,
    measure: b.measure,
    sizeLabel: b.sizeLabel,
    pctOfMax: pct == null ? null : Math.round(pct * 10) / 10,
    level,
  }
}

/**
 * Stocking density over the unit's limit, or null when within limits or
 * when the unit has no area/volume to check against. See densityBasis.
 */
export function densityExcess(
  unit: any,
  fishCount: number,
  farmRules: EffectiveSettings['farmRules'],
): { density: number; max: number; unit: string } | null {
  const b = densityBasis(unit, farmRules)
  if (!b.max || !b.size) return null
  const density = fishCount / b.size
  return density > b.max ? { density, max: b.max, unit: b.unit } : null
}

export type StockingProblem =
  | { code: 'stockStatus'; params: { status: string; allowed: string } }
  | { code: 'stockAbwRange'; params: { abw: number; min: number; max: number } }
  | { code: 'stockCapacity'; params: { fish: number; capacity: number } }
  | { code: 'stockDensity'; params: { density: string; unit: string; max: number } }

/** The first stocking rule a request breaks, or null (bulk import shows it per row). */
export function stockingProblem(opts: {
  cage: any
  fishCount: number
  abw: number
  rules: EffectiveSettings['stockingRules']
  farmRules: EffectiveSettings['farmRules']
}): StockingProblem | null {
  const { cage, fishCount, abw, rules, farmRules } = opts
  const statuses = rules.allowStockOnlyEmptyStatuses || []
  if (cage?.status && statuses.length && !statuses.includes(cage.status)) {
    return { code: 'stockStatus', params: { status: cage.status, allowed: statuses.join(', ') } }
  }
  if (abw < rules.minInitialAbwG || abw > rules.maxInitialAbwG) {
    return { code: 'stockAbwRange', params: { abw, min: rules.minInitialAbwG, max: rules.maxInitialAbwG } }
  }
  if (rules.enforceCageCapacity && cage?.capacity != null && fishCount > cage.capacity) {
    return { code: 'stockCapacity', params: { fish: fishCount, capacity: cage.capacity } }
  }
  const over = densityExcess(cage, fishCount, farmRules)
  if (over) {
    return { code: 'stockDensity', params: { density: over.density.toFixed(1), unit: over.unit, max: over.max } }
  }
  return null
}

export function assertStockingAllowed(opts: {
  cage: any
  fishCount: number
  abw: number
  rules: EffectiveSettings['stockingRules']
  farmRules: EffectiveSettings['farmRules']
}) {
  const problem = stockingProblem(opts)
  if (!problem) return
  switch (problem.code) {
    case 'stockStatus':
      throw new Error(
        `Cage status "${problem.params.status}" cannot be stocked. Allowed: ${problem.params.allowed}`,
      )
    case 'stockAbwRange':
      throw new Error(
        `Initial ABW must be between ${problem.params.min}g and ${problem.params.max}g (got ${problem.params.abw}g). Use grams, not kg — or widen the range in Company Settings → Stocking rules.`,
      )
    case 'stockCapacity':
      throw new Error(`Fish count ${problem.params.fish} exceeds cage capacity ${problem.params.capacity}`)
    case 'stockDensity':
      throw new Error(`Density ${problem.params.density} ${problem.params.unit} exceeds max ${problem.params.max}`)
  }
}

export function assertTopupAllowed(opts: {
  cage: any
  addedFish: number
  abw: number
  rules: EffectiveSettings['stockingRules']
  farmRules: EffectiveSettings['farmRules']
}) {
  const { cage, addedFish, abw, rules, farmRules } = opts
  const minAbw = rules.minTopupAbwG ?? DEFAULT_SETTINGS.stockingRules.minTopupAbwG
  const maxAbw = rules.maxTopupAbwG ?? DEFAULT_SETTINGS.stockingRules.maxTopupAbwG
  if (abw < minAbw || abw > maxAbw) {
    throw new Error(
      `Top-up ABW must be between ${minAbw}g and ${maxAbw}g`,
    )
  }
  const nextCount = (cage?.currentCount || 0) + addedFish
  if (rules.enforceCageCapacity && cage?.capacity != null && nextCount > cage.capacity) {
    throw new Error(
      `Top-up would exceed cage capacity (${nextCount} > ${cage.capacity})`,
    )
  }
  const over = densityExcess(cage, nextCount, farmRules)
  if (over) {
    throw new Error(`Top-up density would exceed max ${over.max} ${over.unit}`)
  }
}

export function harvestWarnings(opts: {
  docDays?: number | null
  abw?: number | null
  fcr?: number | null
  farmRules: EffectiveSettings['farmRules']
}): string[] {
  const warnings: string[] = []
  const { docDays, abw, fcr, farmRules } = opts
  if (docDays != null) {
    if (docDays < farmRules.harvestDocMinDays) {
      warnings.push(
        `DOC ${docDays}d is below recommended min ${farmRules.harvestDocMinDays}d`,
      )
    }
    if (docDays > farmRules.harvestDocMaxDays) {
      warnings.push(
        `DOC ${docDays}d is above recommended max ${farmRules.harvestDocMaxDays}d`,
      )
    }
  }
  if (abw != null && farmRules.targetHarvestAbwG) {
    const delta = Math.abs(abw - farmRules.targetHarvestAbwG)
    if (delta / farmRules.targetHarvestAbwG > 0.2) {
      warnings.push(
        `ABW ${abw}g is more than 20% off target ${farmRules.targetHarvestAbwG}g`,
      )
    }
  }
  if (fcr != null && fcr > farmRules.maxFcrAlert) {
    warnings.push(`FCR ${fcr} exceeds alert threshold ${farmRules.maxFcrAlert}`)
  }
  return warnings
}

export function dailyMortalityPct(mortality: number, currentCount?: number | null) {
  if (!currentCount || currentCount <= 0) return 0
  return (mortality / currentCount) * 100
}

export function cumulativeMortalityPct(
  initialCount?: number | null,
  currentCount?: number | null,
) {
  if (!initialCount || initialCount <= 0) return 0
  const lost = initialCount - (currentCount ?? initialCount)
  return (Math.max(0, lost) / initialCount) * 100
}
