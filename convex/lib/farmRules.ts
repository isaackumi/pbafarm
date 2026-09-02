/**
 * Farm settings defaults + enforcement helpers.
 * Missing company fields resolve to these defaults (today's hardcoded behavior).
 */

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
    dailyMortalityAlertPct: 0.5,
    cumulativeMortalityAlertPct: 10,
    targetFcr: 1.4,
    maxFcrAlert: 1.8,
  },
  stockingRules: {
    requireApprovalForStocking: true,
    requireApprovalForTopup: true,
    enforceCageCapacity: true,
    minInitialAbwG: 5,
    maxInitialAbwG: 80,
    /** Top-ups may match current culture size, not only fingerlings. */
    minTopupAbwG: 5,
    maxTopupAbwG: 800,
    allowStockOnlyEmptyStatuses: ['empty', 'fallow', 'harvested'] as string[],
  },
  feedRules: {
    defaultBagSizeKg: 25,
    defaultLocation: 'Main store',
    allowNegativeStock: false,
    trackLots: true,
    lowStockMultiplier: 1,
    requireBatchOnPurchase: false,
  },
  /** Display / money defaults for the whole farm. */
  locale: {
    currency: 'GHS' as 'GHS' | 'USD' | 'EUR',
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
    dailyMortalityAlertPct: number
    cumulativeMortalityAlertPct: number
    targetFcr: number
    maxFcrAlert: number
  }
  stockingRules: {
    requireApprovalForStocking: boolean
    requireApprovalForTopup: boolean
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
    currency: 'GHS' | 'USD' | 'EUR'
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
      currency: (['GHS', 'USD', 'EUR'].includes(s.locale?.currency)
        ? s.locale.currency
        : DEFAULT_SETTINGS.locale.currency) as 'GHS' | 'USD' | 'EUR',
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
  if (currency && !['GHS', 'USD', 'EUR'].includes(currency)) {
    errors.push('Currency must be GHS (Cedis), USD, or EUR')
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

export function assertStockingAllowed(opts: {
  cage: any
  fishCount: number
  abw: number
  rules: EffectiveSettings['stockingRules']
  farmRules: EffectiveSettings['farmRules']
}) {
  const { cage, fishCount, abw, rules, farmRules } = opts
  const statuses = rules.allowStockOnlyEmptyStatuses || []
  if (cage?.status && statuses.length && !statuses.includes(cage.status)) {
    throw new Error(
      `Cage status "${cage.status}" cannot be stocked. Allowed: ${statuses.join(', ')}`,
    )
  }
  if (abw < rules.minInitialAbwG || abw > rules.maxInitialAbwG) {
    throw new Error(
      `Initial ABW must be between ${rules.minInitialAbwG}g and ${rules.maxInitialAbwG}g`,
    )
  }
  if (rules.enforceCageCapacity && cage?.capacity != null && fishCount > cage.capacity) {
    throw new Error(
      `Fish count ${fishCount} exceeds cage capacity ${cage.capacity}`,
    )
  }
  if (
    farmRules.maxDensityFishPerM3 &&
    cage?.size &&
    cage.size > 0 &&
    fishCount / cage.size > farmRules.maxDensityFishPerM3
  ) {
    throw new Error(
      `Density ${(fishCount / cage.size).toFixed(1)} fish/m³ exceeds max ${farmRules.maxDensityFishPerM3}`,
    )
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
  if (
    farmRules.maxDensityFishPerM3 &&
    cage?.size &&
    cage.size > 0 &&
    nextCount / cage.size > farmRules.maxDensityFishPerM3
  ) {
    throw new Error(
      `Top-up density would exceed max ${farmRules.maxDensityFishPerM3} fish/m³`,
    )
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
