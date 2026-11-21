/**
 * Pure helpers of the Home screen (Paper 01): the standing-biomass trend,
 * period deltas from the occupancy snapshots, the "Needs attention" rows and
 * the farm-activity feed. No database access, so vitest covers them directly
 * and convex/home.ts only reads rows and calls these.
 */
import { addDays } from './dates'
import { periodMortalityPct, pooledFcr } from './kpi'

export type Snapshot = {
  date: string
  count: number
  biomassKg: number
  feedKg: number
  gainKg: number
  mortality: number
}

/** One occupancy (batchStats row) reduced to what the Home needs. */
export type Occupancy = {
  openedOn: string | null
  closedOn: string | null
  open: boolean
  /** Oldest first. */
  weekly: Snapshot[]
}

export const BIOMASS_RANGES = ['30d', '90d', 'cycle'] as const
export type BiomassRange = (typeof BIOMASS_RANGES)[number]

/** Last snapshot dated on or before `date`, or null (not stocked yet, or closed before). */
export function snapshotOn(o: Occupancy, date: string): Snapshot | null {
  if (o.openedOn && date < o.openedOn) return null
  if (o.closedOn && date > o.closedOn) return null
  let found: Snapshot | null = null
  for (const s of o.weekly) {
    if (s.date <= date) found = s
    else break
  }
  return found
}

/** First day of the range: 30 or 90 days back, or the oldest open occupancy's stocking ("cycle"). */
export function rangeStart(range: BiomassRange, asOf: string, occupancies: Occupancy[]): string {
  if (range === '30d') return addDays(asOf, -30)
  if (range === '90d') return addDays(asOf, -90)
  return cycleStart(occupancies) ?? addDays(asOf, -90)
}

/** Oldest stocking date among the open occupancies (the current cycle), or null. */
export function cycleStart(occupancies: Occupancy[]): string | null {
  let first: string | null = null
  for (const o of occupancies) {
    if (!o.open || !o.openedOn) continue
    if (!first || o.openedOn < first) first = o.openedOn
  }
  return first
}

/** "Day N of cycle": days since the cycle started, the start day counting as day 1. */
export function cycleDay(occupancies: Occupancy[], asOf: string): number | null {
  const start = cycleStart(occupancies)
  if (!start || start > asOf) return null
  const ms = Date.parse(`${asOf}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)
  return Math.round(ms / 86_400_000) + 1
}

/** Standing biomass of all occupancies at the end of `date`, kg. */
export function biomassOn(occupancies: Occupancy[], date: string): number {
  let kg = 0
  for (const o of occupancies) kg += snapshotOn(o, date)?.biomassKg ?? 0
  return kg
}

/**
 * Biomass per snapshot date in [from, to]: the occupancies' snapshot dates
 * (each Sunday and their as-of day) plus `from` and `to`, each summed over
 * every occupancy standing that day.
 */
export function biomassSeries(occupancies: Occupancy[], from: string, to: string) {
  const dates = new Set<string>([from, to])
  for (const o of occupancies) {
    for (const s of o.weekly) if (s.date >= from && s.date <= to) dates.add(s.date)
  }
  return [...dates]
    .sort()
    .map((date) => ({ date, kg: Math.round(biomassOn(occupancies, date) * 10) / 10 }))
}

/** % change from `before` to `now`; null when there is nothing to compare with. */
export function pctChange(now: number, before: number): number | null {
  if (!(before > 0)) return null
  return ((now - before) / before) * 100
}

/** Deaths between two dates (snapshot difference) and the fish standing at the end. */
function mortalityWindow(occupancies: Occupancy[], from: string, to: string) {
  let deaths = 0
  let live = 0
  for (const o of occupancies) {
    const end = snapshotOn(o, to)
    if (!end) continue
    const start = snapshotOn(o, from)
    deaths += Math.max(0, end.mortality - (start?.mortality ?? 0))
    live += Math.max(0, end.count)
  }
  return periodMortalityPct(deaths, live)
}

/** FCR pooled over the occupancies standing on `date` (feed and gain to date). */
function fcrOn(occupancies: Occupancy[], date: string): number | null {
  const rows = []
  for (const o of occupancies) {
    const s = snapshotOn(o, date)
    if (s) rows.push({ feedKg: s.feedKg, gainKg: s.gainKg })
  }
  return pooledFcr(rows)
}

/**
 * KPI strip figures with their change over the previous 30 days: FCR now vs
 * 30 days ago, and the 30-day mortality vs the 30 days before.
 */
export function kpiDeltas(occupancies: Occupancy[], asOf: string) {
  const d30 = addDays(asOf, -30)
  const d60 = addDays(asOf, -60)
  const fcr = fcrOn(occupancies, asOf)
  const fcrBefore = fcrOn(occupancies, d30)
  const mortality = mortalityWindow(occupancies, d30, asOf)
  const mortalityBefore = mortalityWindow(occupancies, d60, d30)
  return {
    fcr,
    fcrDelta: fcr != null && fcrBefore != null ? fcr - fcrBefore : null,
    mortalityPct: mortality,
    mortalityDelta: mortality != null && mortalityBefore != null ? mortality - mortalityBefore : null,
  }
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

export type AttentionKind = 'water' | 'density' | 'entry'
export type AttentionTone = 'alert' | 'warn'

/** The early-warning rule (lib/earlyWarning) a problem came from, or density. */
export type AttentionReason =
  | 'low_oxygen'
  | 'temperature_out_of_range'
  | 'missing_entries'
  | 'mortality_spike'
  | 'feed_drop'
  | 'fcr_deterioration'
  | 'growth_stall'
  | 'density'

/** Which action button a problem gets (Paper 01: Log water / Plan transfer / Log entry). */
export function attentionKind(reason: AttentionReason): AttentionKind {
  if (reason === 'low_oxygen' || reason === 'temperature_out_of_range') return 'water'
  if (reason === 'density' || reason === 'growth_stall') return 'density'
  return 'entry'
}

export type AttentionItem = {
  unitId: string
  reason: AttentionReason
  tone: AttentionTone
  /** Higher first: critical alerts, then density over the limit, then warnings. */
  rank: number
}

/** One row per unit, its most urgent problem first; units ordered by that problem. */
export function pickAttention<T extends AttentionItem>(items: T[]): T[] {
  const best = new Map<string, T>()
  for (const i of items) {
    const prev = best.get(i.unitId)
    if (!prev || i.rank > prev.rank) best.set(i.unitId, i)
  }
  return [...best.values()].sort((a, b) => b.rank - a.rank)
}

// ---------------------------------------------------------------------------
// Farm activity
// ---------------------------------------------------------------------------

export const ACTIVITY_TYPES = ['stocking', 'transfer', 'harvest', 'feed'] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export type ActivityRow = {
  id: string
  type: ActivityType
  date: string
  unit: string
  batch: string | null
  fish: number | null
  biomassKg: number | null
  status: 'pending_approval' | 'approved' | 'rejected' | 'completed' | 'in_progress' | 'reversed'
  /** Sort key within a day: newest first. */
  createdAt: number
}

/** Newest first; matches `search` (case-insensitive) on unit or batch. */
export function mergeActivity(rows: ActivityRow[], search: string | undefined, limit: number): ActivityRow[] {
  const q = (search ?? '').trim().toLowerCase()
  return rows
    .filter((r) => !q || r.unit.toLowerCase().includes(q) || (r.batch ?? '').toLowerCase().includes(q))
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)))
    .slice(0, limit)
}
