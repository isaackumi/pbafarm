/**
 * Cage keepers: the rules every keeper screen, reminder and draft shares.
 *
 * Effective keeper of a unit on a date = the person covering when the
 * assigned keeper has an active cover that day (a split names a person per
 * unit), else the assigned keeper. Dates are site-local `YYYY-MM-DD`; a cover
 * runs from `fromDate` up to but not including `toDate` ("back on").
 *
 * Limits (scale rule, 1,000 units / 1,000 users per organization): every read
 * here goes through an index on the organization, unit or person and is
 * capped. MAX_UNITS caps the units one board reads; organizations above it
 * see `truncated` and must filter by site.
 */
import type { QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

/** Units one board / one escalation run reads at most. */
export const MAX_UNITS = 2000
/** Open assignments read per organization (one per unit). */
export const MAX_ASSIGNMENTS = 2500
/** Covers that can be open at once in one organization. */
export const MAX_COVERS = 500
/** Moves one assign / rebalance draft item may hold. */
export const MAX_MOVES = 200
/** Keepers one nudge draft item may hold. */
export const MAX_NUDGES = 100
/** Longest cover, in days. */
export const MAX_COVER_DAYS = 90

export type KeeperSettings = {
  capacity: number
  deadline: string
  backupAfterMin: number
  managerAfterMin: number
  escalate: boolean
  ownCagesOnly: boolean
}

export const KEEPER_DEFAULTS: KeeperSettings = {
  capacity: 25,
  deadline: '10:00',
  backupAfterMin: 60,
  managerAfterMin: 120,
  escalate: true,
  ownCagesOnly: false,
}

export function mergeKeeperSettings(row: Partial<Doc<'keeperSettings'>> | null | undefined): KeeperSettings {
  const num = (x: unknown, d: number, lo: number, hi: number) =>
    typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : d
  return {
    capacity: num(row?.capacity, KEEPER_DEFAULTS.capacity, 1, 1000),
    deadline: isHhmm(row?.deadline) ? row!.deadline! : KEEPER_DEFAULTS.deadline,
    backupAfterMin: num(row?.backupAfterMin, KEEPER_DEFAULTS.backupAfterMin, 0, 720),
    managerAfterMin: num(row?.managerAfterMin, KEEPER_DEFAULTS.managerAfterMin, 0, 1440),
    escalate: row?.escalate ?? KEEPER_DEFAULTS.escalate,
    ownCagesOnly: row?.ownCagesOnly ?? KEEPER_DEFAULTS.ownCagesOnly,
  }
}

export function isHhmm(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

export async function keeperSettingsOf(ctx: QueryCtx, companyId: Id<'companies'>) {
  const row = await ctx.db
    .query('keeperSettings')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .first()
  return { row, settings: mergeKeeperSettings(row) }
}

export type CoverLite = Pick<
  Doc<'keeperCovers'>,
  '_id' | 'keeperId' | 'coverId' | 'split' | 'fromDate' | 'toDate' | 'cancelledAt'
>

export function coverActiveOn(c: CoverLite, date: string): boolean {
  return !c.cancelledAt && c.fromDate <= date && date < c.toDate
}

/** Who covers `unitId` under this cover (the split wins). */
export function coverPersonFor(c: CoverLite, unitId: Id<'cages'>): Id<'users'> {
  return c.split?.find((s) => s.unitId === unitId)?.coverId ?? c.coverId
}

export type Effective = {
  /** The person who should log the unit that day. */
  keeperId: Id<'users'>
  /** The assigned keeper (differs from keeperId while covered). */
  assignedId: Id<'users'>
  backupId?: Id<'users'>
  /** Set while the assigned keeper is away. */
  coverId?: Id<'users'>
  coverRowId?: Id<'keeperCovers'>
}

/** Effective keeper from an assignment and the covers active that day (pure). */
export function effectiveFrom(
  assignment: Pick<Doc<'cageKeepers'>, 'keeperId' | 'backupId'> | null | undefined,
  covers: CoverLite[],
  unitId: Id<'cages'>,
  date: string,
): Effective | null {
  if (!assignment) return null
  const cover = covers.find((c) => c.keeperId === assignment.keeperId && coverActiveOn(c, date))
  if (!cover) return { keeperId: assignment.keeperId, assignedId: assignment.keeperId, backupId: assignment.backupId }
  const coverId = coverPersonFor(cover, unitId)
  return {
    keeperId: coverId,
    assignedId: assignment.keeperId,
    backupId: assignment.backupId,
    coverId,
    coverRowId: cover._id,
  }
}

/** The assignment of a unit that covered `date` (history included). */
export async function assignmentOn(ctx: QueryCtx, unitId: Id<'cages'>, date: string) {
  const rows = await ctx.db
    .query('cageKeepers')
    .withIndex('by_unitId_and_active', (q) => q.eq('unitId', unitId))
    .order('desc')
    .take(100)
  return (
    rows.find((r) => r.active && r.sinceDate <= date) ??
    rows.find((r) => r.sinceDate <= date && (!r.untilDate || date < r.untilDate)) ??
    null
  )
}

export async function openAssignment(ctx: QueryCtx, unitId: Id<'cages'>) {
  return await ctx.db
    .query('cageKeepers')
    .withIndex('by_unitId_and_active', (q) => q.eq('unitId', unitId).eq('active', true))
    .first()
}

/** A keeper's covers that are open on or after `date`. */
export async function coversOfKeeper(ctx: QueryCtx, keeperId: Id<'users'>, date: string) {
  return (
    await ctx.db
      .query('keeperCovers')
      .withIndex('by_keeperId_and_toDate', (q) => q.eq('keeperId', keeperId).gt('toDate', date))
      .take(50)
  ).filter((c) => !c.cancelledAt)
}

/** The organization's covers that end after `date` (current and upcoming), not cancelled. */
export async function openCovers(ctx: QueryCtx, companyId: Id<'companies'>, date: string) {
  return (
    await ctx.db
      .query('keeperCovers')
      .withIndex('by_companyId_and_toDate', (q) => q.eq('companyId', companyId).gt('toDate', date))
      .take(MAX_COVERS)
  ).filter((c) => !c.cancelledAt)
}

/** Effective keeper of one unit on a date (two indexed reads). */
export async function effectiveKeeper(ctx: QueryCtx, unit: Doc<'cages'>, date: string): Promise<Effective | null> {
  const a = await assignmentOn(ctx, unit._id, date)
  if (!a) return null
  const covers = await coversOfKeeper(ctx, a.keeperId, date)
  return effectiveFrom(a, covers, unit._id, date)
}

/** The organization's open assignments by unit id. */
export async function openAssignments(ctx: QueryCtx, companyId: Id<'companies'>) {
  const rows = await ctx.db
    .query('cageKeepers')
    .withIndex('by_companyId_and_active', (q) => q.eq('companyId', companyId).eq('active', true))
    .take(MAX_ASSIGNMENTS)
  const byUnit = new Map<Id<'cages'>, Doc<'cageKeepers'>>()
  for (const r of rows) byUnit.set(r.unitId, r)
  return byUnit
}

/** Units the organization logs daily (stocked). Others show as idle. */
export function needsDailyLog(unit: Pick<Doc<'cages'>, 'status'>): boolean {
  return unit.status === 'active' || unit.status === 'harvesting'
}

/** "Row" of a unit for grouping: its group label, else the letters before the number (B-12 → B). */
export function rowOf(unit: Pick<Doc<'cages'>, 'name' | 'unitGroup'>): string {
  if (unit.unitGroup?.trim()) return unit.unitGroup.trim().slice(0, 40)
  const m = /^([A-Za-z]+)[\s\-_]*\d/.exec(unit.name.trim())
  return m ? m[1].toUpperCase() : ''
}

export function personName(u: Pick<Doc<'users'>, 'name' | 'email'> | null | undefined): string {
  return u?.name?.trim() || u?.email?.split('@')[0] || 'Member'
}

/** Natural sort for unit names: B-2 before B-10. */
export function byUnitName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * An active member of the organization, or null. Every keeper path that
 * takes a person id checks this before it reads or shows anything about them
 * (a user id from another organization reveals nothing, not even a name).
 */
export async function memberOf(ctx: QueryCtx, companyId: Id<'companies'>, userId: Id<'users'>) {
  const user = await ctx.db.get(userId)
  if (!user || user.active === false || user.deletedAt) return null
  const membership = await ctx.db
    .query('memberships')
    .withIndex('by_companyId_and_userId', (q) => q.eq('companyId', companyId).eq('userId', userId))
    .unique()
  if (!membership || membership.status !== 'active') return null
  return { user, membership }
}

/** The membership reaches the site (or the unit has none). */
export function reachesSite(m: Pick<Doc<'memberships'>, 'allLocations' | 'locationIds'>, locationId: Id<'farmLocations'> | undefined) {
  return !locationId || m.allLocations || (m.locationIds ?? []).includes(locationId)
}
