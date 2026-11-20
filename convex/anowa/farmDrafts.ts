/**
 * Ask Anowa drafts for farm records (owner-approved tool set, 2026-11-20):
 * a bi-weekly sample, a water reading, a harvest (with its lot), a stocking
 * request, a fish transfer, a sale (and its invoice), an approval decision,
 * a report schedule and a cycle-planner plan.
 *
 * Same contract as convex/anowa/drafts.ts: a propose tool only builds a typed
 * draft item from names the member can see (ids never come from the model);
 * nothing is written until the member confirms the card, and then only
 * through the form's own helper (createHarvestAs, createStockingAs,
 * approveStockingAs, …), so withdrawal periods, the stock ledger, approvals
 * and segregation of duties (assertDifferentApprover) are exactly the form's.
 * A helper that refuses throws and rolls the whole card back.
 *
 * These records feed ledgers, approvals and invoices, so they have no 10-minute
 * Undo: the card links to the page where they are changed.
 */
import { v, type Infer } from 'convex/values'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { can, type Permission } from '../lib/permissions'
import { addDays } from '../lib/dates'
import { round } from '../lib/kpi'
import { mergeSettings } from '../lib/farmRules'
import { PLAN_DEFAULTS, PLAN_LIMITS, planCycle, planProblems } from '../lib/cyclePlan'
import { checkTiming } from '../lib/reportSchedule'
import { isValidTimeZone } from '../automation/schedule'
import { companyZone } from '../automation/engine'
import { loadApproval } from '../approvalAlerts'
import { saveSamplingBatch } from '../biweeklyRecords'
import { recordReadingAs } from '../waterQuality'
import { createHarvestAs } from '../harvest'
import { createLotAs } from '../traceability'
import { approveStockingAs, approveTopupAs, createStockingAs, rejectStockingAs, rejectTopupAs } from '../stocking'
import { approveFishTransferAs, createFishTransferAs, rejectFishTransferAs } from '../fishTransfers'
import { createSaleAs } from '../sales'
import { issueInvoiceAs } from '../invoices'
import { createScheduleAs, MAX_RECIPIENTS } from '../reportSchedules'
import { planAssumptionsFor, savePlanAs } from '../cyclePlans'
import { canReadDataset, canSeeReport } from '../reportBuilder'
import { farmDate, inScope, matchUnit, unitsInScope } from '../bot/scope'
import type { WebMember } from './scope'

type Payload = Doc<'pendingBotActions'>['payload']
type Built = {
  ok: true
  payload: Payload
  siteId: Id<'farmLocations'> | undefined
  date: string
  summary: string
  fingerprint: string
}
type Failed = { ok: false; error: string }

/** Units read when matching a name: enough for 1,000-unit farms. */
const UNIT_MATCH_CAP = 2000
const MAX_NOTES = 500
const MAX_NAME = 80

// ─── Inputs (what the model may send) ───────────────────────────────────────

const daysAgo = v.optional(v.number())

export const samplingInput = v.object({
  kind: v.literal('sampling'),
  unit: v.string(),
  fishCounted: v.number(),
  abwG: v.optional(v.number()),
  totalWeightKg: v.optional(v.number()),
  daysAgo,
})

export const waterReadingInput = v.object({
  kind: v.literal('water_reading'),
  unit: v.string(),
  dissolvedOxygen: v.optional(v.number()),
  temperatureC: v.optional(v.number()),
  ph: v.optional(v.number()),
  ammonia: v.optional(v.number()),
  nitrite: v.optional(v.number()),
  secchiCm: v.optional(v.number()),
  notes: v.optional(v.string()),
})

export const harvestInput = v.object({
  kind: v.literal('harvest'),
  unit: v.string(),
  totalWeightKg: v.number(),
  abwG: v.optional(v.number()),
  count: v.optional(v.number()),
  complete: v.optional(v.boolean()),
  lot: v.optional(v.boolean()),
  lotCode: v.optional(v.string()),
  grade: v.optional(v.string()),
  destination: v.optional(v.string()),
  notes: v.optional(v.string()),
  daysAgo,
})

export const stockingInput = v.object({
  kind: v.literal('stocking'),
  unit: v.string(),
  fishCount: v.number(),
  abwG: v.number(),
  species: v.optional(v.string()),
  source: v.optional(v.string()),
  notes: v.optional(v.string()),
  daysAgo,
})

export const transferInput = v.object({
  kind: v.literal('fish_transfer'),
  fromUnit: v.string(),
  toUnit: v.string(),
  count: v.number(),
  abwG: v.optional(v.number()),
  notes: v.optional(v.string()),
  daysAgo,
})

export const saleInput = v.object({
  kind: v.literal('sale'),
  customer: v.string(),
  weightKg: v.number(),
  pricePerKg: v.number(),
  unit: v.optional(v.string()),
  invoice: v.optional(v.boolean()),
  dueInDays: v.optional(v.number()),
  notes: v.optional(v.string()),
  daysAgo,
})

export const approvalInput = v.object({
  kind: v.literal('approval_decision'),
  /** `ref` from the pendingApprovals read tool. */
  ref: v.string(),
  decision: v.union(v.literal('approve'), v.literal('reject')),
  reason: v.optional(v.string()),
})

export const reportScheduleInput = v.object({
  kind: v.literal('report_schedule'),
  report: v.string(),
  frequency: v.union(v.literal('daily'), v.literal('weekly'), v.literal('monthly')),
  time: v.string(),
  weekday: v.optional(v.number()),
  dayOfMonth: v.optional(v.number()),
  recipients: v.optional(v.array(v.string())),
})

export const cyclePlanInput = v.object({
  kind: v.literal('cycle_plan'),
  name: v.string(),
  units: v.array(v.string()),
  stockOn: v.optional(v.string()),
  fishPerUnit: v.number(),
  stockAbwG: v.number(),
  harvestAbwG: v.number(),
  salePricePerKg: v.number(),
  fingerlingPrice: v.number(),
  feedPricePerBag: v.number(),
  bagKg: v.optional(v.number()),
})

export const farmProposalInputs = [
  samplingInput,
  waterReadingInput,
  harvestInput,
  stockingInput,
  transferInput,
  saleInput,
  approvalInput,
  reportScheduleInput,
  cyclePlanInput,
] as const

export type FarmProposalInput =
  | Infer<typeof samplingInput>
  | Infer<typeof waterReadingInput>
  | Infer<typeof harvestInput>
  | Infer<typeof stockingInput>
  | Infer<typeof transferInput>
  | Infer<typeof saleInput>
  | Infer<typeof approvalInput>
  | Infer<typeof reportScheduleInput>
  | Infer<typeof cyclePlanInput>

export const FARM_KINDS = [
  'sampling',
  'water_reading',
  'harvest',
  'stocking',
  'fish_transfer',
  'sale',
  'approval_decision',
  'report_schedule',
  'cycle_plan',
] as const
export type FarmKind = (typeof FARM_KINDS)[number]
export const isFarmKind = (k: string): k is FarmKind => (FARM_KINDS as readonly string[]).includes(k)

/** The permission the matching form checks. Approvals depend on what is approved (see `farmPermission`). */
export const FARM_PERMISSION: Record<FarmKind, Permission> = {
  sampling: 'production.sampling.record',
  water_reading: 'production.daily.record',
  harvest: 'production.harvest.record',
  stocking: 'production.stocking.request',
  fish_transfer: 'production.transfer.request',
  sale: 'finance.sales.record',
  approval_decision: 'production.stocking.approve',
  report_schedule: 'reports.manage',
  cycle_plan: 'production.plan.manage',
}

export const FARM_REFUSAL: Record<FarmKind, string> = {
  sampling: 'Your role cannot record sampling.',
  water_reading: 'Your role cannot log water readings.',
  harvest: 'Your role cannot record harvests.',
  stocking: 'Your role cannot request stockings.',
  fish_transfer: 'Your role cannot request fish transfers.',
  sale: 'Your role cannot record sales.',
  approval_decision: 'Your role cannot approve this request.',
  report_schedule: 'Your role cannot schedule reports.',
  cycle_plan: 'Your role cannot save cycle plans.',
}

/** The permission one payload needs (a transfer decision needs the transfer approval). */
export function farmPermission(p: Payload): Permission | null {
  if (!isFarmKind(p.kind)) return null
  if (p.kind === 'approval_decision') {
    return p.approvalKind === 'transfer' ? 'production.transfer.approve' : 'production.stocking.approve'
  }
  if (p.kind === 'report_schedule' || p.kind === 'cycle_plan') return FARM_PERMISSION[p.kind]
  return FARM_PERMISSION[p.kind]
}

/** Why the member may not do this farm item: permission only (scope is `farmItemProblem`). */
export function farmRefusal(w: WebMember, p: Payload): string | null {
  const perm = farmPermission(p)
  if (!perm || !isFarmKind(p.kind)) return null
  if (!can(w.member, perm)) return FARM_REFUSAL[p.kind]
  if (p.kind === 'report_schedule' && !can(w.member, 'reports.export')) return FARM_REFUSAL.report_schedule
  return null
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const trimTo = (s: string | undefined, n: number) => s?.trim().replace(/\s+/g, ' ').slice(0, n) || undefined
const fmt = (n: number, dp = 1) => new Intl.NumberFormat('en', { maximumFractionDigits: dp }).format(n)
const money = (n: number, currency: string) => `${currency} ${fmt(n, 2)}`
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

function unitError(typed: string, candidates: string[]): Failed {
  return {
    ok: false,
    error: candidates.length ? `Which unit? Matches: ${candidates.join(', ')}` : `No unit called "${typed.slice(0, 40)}" in your sites.`,
  }
}

async function findUnit(ctx: QueryCtx, w: WebMember, typed: string): Promise<Doc<'cages'> | Failed> {
  const m = matchUnit(await unitsInScope(ctx, w, UNIT_MATCH_CAP), typed)
  return m.unit ?? unitError(typed, m.candidates)
}

/** A whole number of days back from 0 to `max`, else null. */
function backDays(n: number | undefined, max = 7): number | null {
  if (n == null) return 0
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null
}

async function dayOf(ctx: QueryCtx, w: WebMember, locationId: Id<'farmLocations'> | undefined, ago: number) {
  return addDays(await farmDate(ctx, w, locationId, Date.now()), -ago)
}

/** Active members of the organization matching a typed name (≤ 500 memberships read). */
async function membersNamed(ctx: QueryCtx, companyId: Id<'companies'>, typed: string) {
  const key = typed.trim().toLowerCase()
  const rows = await ctx.db
    .query('memberships')
    .withIndex('by_companyId_and_userId', (q) => q.eq('companyId', companyId))
    .take(500)
  const out: Doc<'users'>[] = []
  for (const r of rows) {
    if (r.status !== 'active') continue
    const u = await ctx.db.get(r.userId)
    if (u && u.active !== false && !u.deletedAt && (u.name ?? '').toLowerCase().includes(key)) out.push(u)
  }
  return out
}

// ─── Builders ───────────────────────────────────────────────────────────────

async function buildSampling(ctx: MutationCtx, w: WebMember, input: Infer<typeof samplingInput>): Promise<Built | Failed> {
  const unit = await findUnit(ctx, w, input.unit)
  if ('ok' in unit) return unit
  const counted = input.fishCounted
  if (!Number.isInteger(counted) || counted <= 0 || counted > 100_000) {
    return { ok: false, error: 'Fish counted must be a whole number above 0.' }
  }
  let totalG: number | null = null
  if (finite(input.totalWeightKg) && input.totalWeightKg > 0) totalG = input.totalWeightKg * 1000
  else if (finite(input.abwG) && input.abwG > 0) totalG = input.abwG * counted
  if (!totalG || totalG > 100_000_000) return { ok: false, error: 'Give the average body weight (g) or the total weight sampled (kg).' }
  const ago = backDays(input.daysAgo, 14)
  if (ago == null) return { ok: false, error: 'daysAgo must be a whole number from 0 to 14.' }
  if (!['active', 'harvesting'].includes(unit.status) && !(unit.currentCount && unit.currentCount > 0)) {
    return { ok: false, error: `${unit.name} has no fish to sample.` }
  }
  const date = await dayOf(ctx, w, unit.locationId, ago)
  const abwG = round(totalG / counted, 2) ?? 0
  return {
    ok: true,
    payload: {
      kind: 'sampling',
      cageId: unit._id,
      cageName: unit.name,
      fishCounted: counted,
      totalWeightG: round(totalG, 1) ?? totalG,
      abwG,
      abwBefore: unit.currentWeight ?? undefined,
    },
    siteId: unit.locationId,
    date,
    summary: `Sampling ${unit.name} on ${date}: ${counted} fish, ABW ${fmt(abwG)} g${unit.currentWeight ? ` (was ${fmt(unit.currentWeight)} g)` : ''}.`,
    fingerprint: `sampling|${unit._id}|${date}`,
  }
}

const WATER_RANGES = {
  dissolvedOxygen: [0, 30],
  temperatureC: [-5, 50],
  ph: [0, 14],
  ammonia: [0, 100],
  nitrite: [0, 100],
  secchiCm: [0, 1000],
} as const

async function buildWater(ctx: MutationCtx, w: WebMember, input: Infer<typeof waterReadingInput>): Promise<Built | Failed> {
  const unit = await findUnit(ctx, w, input.unit)
  if ('ok' in unit) return unit
  const values: Partial<Record<keyof typeof WATER_RANGES, number>> = {}
  for (const [k, [lo, hi]] of Object.entries(WATER_RANGES) as Array<[keyof typeof WATER_RANGES, readonly [number, number]]>) {
    const x = input[k]
    if (x == null) continue
    if (!finite(x) || x < lo || x > hi) return { ok: false, error: `${k} must be between ${lo} and ${hi}.` }
    values[k] = x
  }
  if (!Object.keys(values).length) return { ok: false, error: 'Give at least one value (DO, temperature, pH, ammonia, nitrite or Secchi).' }
  const date = await dayOf(ctx, w, unit.locationId, 0)
  const parts = Object.entries(values).map(([k, x]) => `${k} ${x}`)
  return {
    ok: true,
    payload: { kind: 'water_reading', cageId: unit._id, cageName: unit.name, ...values, notes: trimTo(input.notes, MAX_NOTES) },
    siteId: unit.locationId,
    date,
    summary: `Water reading for ${unit.name} now: ${parts.join(', ')}.`,
    fingerprint: `water|${unit._id}|${date}|${parts.join(',')}`,
  }
}

async function buildHarvest(ctx: MutationCtx, w: WebMember, input: Infer<typeof harvestInput>): Promise<Built | Failed> {
  const unit = await findUnit(ctx, w, input.unit)
  if ('ok' in unit) return unit
  const fish = unit.currentCount ?? 0
  if (fish <= 0) return { ok: false, error: `${unit.name} has no fish on record to harvest.` }
  const kg = input.totalWeightKg
  if (!finite(kg) || kg <= 0 || kg > 10_000_000) return { ok: false, error: 'The harvested weight (kg) must be above 0.' }
  let abw = finite(input.abwG) && input.abwG > 0 ? input.abwG : null
  let count = finite(input.count) && input.count > 0 ? Math.round(input.count) : null
  if (!abw && count) abw = (kg * 1000) / count
  if (!count && abw) count = Math.round((kg * 1000) / abw)
  if (!abw && !count && unit.currentWeight) {
    abw = unit.currentWeight
    count = Math.round((kg * 1000) / abw)
  }
  if (!abw || !count) return { ok: false, error: 'Give the average weight (g) or the number of fish harvested.' }
  if (count > fish) return { ok: false, error: `${count} fish is more than the ${fish} in ${unit.name}.` }
  const complete = input.complete ?? count >= fish
  const ago = backDays(input.daysAgo)
  if (ago == null) return { ok: false, error: 'daysAgo must be a whole number from 0 to 7.' }
  const date = await dayOf(ctx, w, unit.locationId, ago)
  const lotCode = trimTo(input.lotCode, 40)?.toUpperCase()
  const withLot = input.lot !== false || !!lotCode
  return {
    ok: true,
    payload: {
      kind: 'harvest',
      cageId: unit._id,
      cageName: unit.name,
      harvestType: complete ? 'complete' : 'partial',
      totalWeightKg: round(kg, 2) ?? kg,
      abwG: round(abw, 1) ?? abw,
      count,
      fishBefore: fish,
      withLot,
      lotCode,
      grade: trimTo(input.grade, 40),
      destination: trimTo(input.destination, MAX_NAME),
      notes: trimTo(input.notes, MAX_NOTES),
    },
    siteId: unit.locationId,
    date,
    summary: `${complete ? 'Complete' : 'Partial'} harvest of ${unit.name} on ${date}: ${fmt(kg)} kg, ${count} fish at ${fmt(abw)} g${withLot ? `, lot ${lotCode ?? '(new code)'}` : ''}.`,
    fingerprint: `harvest|${unit._id}|${date}|${kg}`,
  }
}

async function buildStocking(ctx: MutationCtx, w: WebMember, input: Infer<typeof stockingInput>): Promise<Built | Failed> {
  const unit = await findUnit(ctx, w, input.unit)
  if ('ok' in unit) return unit
  if (!Number.isInteger(input.fishCount) || input.fishCount <= 0 || input.fishCount > 10_000_000) {
    return { ok: false, error: 'The number of fish must be a whole number above 0.' }
  }
  if (!finite(input.abwG) || input.abwG <= 0 || input.abwG > 5000) return { ok: false, error: 'The stocking ABW (g) must be above 0.' }
  const ago = backDays(input.daysAgo)
  if (ago == null) return { ok: false, error: 'daysAgo must be a whole number from 0 to 7.' }
  const date = await dayOf(ctx, w, unit.locationId, ago)
  const rules = mergeSettings(w.company.settings).stockingRules
  const biomassKg = round((input.fishCount * input.abwG) / 1000, 2) ?? 0
  const needsApproval = rules.requireApprovalForStocking !== false
  return {
    ok: true,
    payload: {
      kind: 'stocking',
      cageId: unit._id,
      cageName: unit.name,
      fishCount: input.fishCount,
      abwG: input.abwG,
      biomassKg,
      species: trimTo(input.species, 40),
      sourceLocation: trimTo(input.source, MAX_NAME),
      notes: trimTo(input.notes, MAX_NOTES),
      needsApproval,
    },
    siteId: unit.locationId,
    date,
    summary: `Stocking request: ${input.fishCount} fish at ${fmt(input.abwG)} g (${fmt(biomassKg)} kg) into ${unit.name} on ${date}${needsApproval ? '; it goes to approval' : ''}.`,
    fingerprint: `stocking|${unit._id}|${date}|${input.fishCount}`,
  }
}

async function buildTransfer(ctx: MutationCtx, w: WebMember, input: Infer<typeof transferInput>): Promise<Built | Failed> {
  const all = await unitsInScope(ctx, w, UNIT_MATCH_CAP)
  const a = matchUnit(all, input.fromUnit)
  if (!a.unit) return unitError(input.fromUnit, a.candidates)
  const b = matchUnit(all, input.toUnit)
  if (!b.unit) return unitError(input.toUnit, b.candidates)
  const src = a.unit
  const dst = b.unit
  if (src._id === dst._id) return { ok: false, error: 'The source and destination must be different units.' }
  const have = src.currentCount ?? 0
  if (have <= 0) return { ok: false, error: `${src.name} has no fish to move.` }
  if (!Number.isInteger(input.count) || input.count <= 0) return { ok: false, error: 'The number of fish must be a whole number above 0.' }
  if (input.count > have) return { ok: false, error: `${input.count} fish is more than the ${have} in ${src.name}.` }
  const abw = finite(input.abwG) && input.abwG > 0 ? input.abwG : src.currentWeight
  if (!abw) return { ok: false, error: `What is the average weight (g) of the fish in ${src.name}?` }
  const ago = backDays(input.daysAgo)
  if (ago == null) return { ok: false, error: 'daysAgo must be a whole number from 0 to 7.' }
  const date = await dayOf(ctx, w, src.locationId, ago)
  const needsApproval = mergeSettings(w.company.settings).stockingRules.requireApprovalForFishTransfer !== false
  return {
    ok: true,
    payload: {
      kind: 'fish_transfer',
      sourceCageId: src._id,
      sourceName: src.name,
      destinationCageId: dst._id,
      destinationName: dst.name,
      quantity: input.count,
      abwG: round(abw, 1) ?? abw,
      sourceCount: have,
      notes: trimTo(input.notes, MAX_NOTES),
      needsApproval,
    },
    siteId: src.locationId,
    date,
    summary: `Transfer ${input.count} fish (${fmt(abw)} g) from ${src.name} to ${dst.name} on ${date}${needsApproval ? '; it goes to approval' : ''}.`,
    fingerprint: `transfer|${src._id}|${dst._id}|${date}|${input.count}`,
  }
}

async function buildSale(ctx: MutationCtx, w: WebMember, input: Infer<typeof saleInput>): Promise<Built | Failed> {
  const companyId = w.binding.companyId
  if (!finite(input.weightKg) || input.weightKg <= 0 || input.weightKg > 10_000_000) {
    return { ok: false, error: 'The weight sold (kg) must be above 0.' }
  }
  if (!finite(input.pricePerKg) || input.pricePerKg < 0 || input.pricePerKg > 10_000_000) {
    return { ok: false, error: 'The price per kg must be zero or more.' }
  }
  const typed = trimTo(input.customer, MAX_NAME)
  if (!typed) return { ok: false, error: 'Who is the buyer?' }
  const customers = (
    await ctx.db
      .query('customers')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(500)
  ).filter((c) => !c.deletedAt && c.active !== false)
  const key = typed.toLowerCase()
  const exact = customers.filter((c) => c.name.trim().toLowerCase() === key)
  const partial = exact.length ? exact : customers.filter((c) => c.name.toLowerCase().includes(key))
  if (partial.length > 1) return { ok: false, error: `Which customer? Matches: ${partial.slice(0, 8).map((c) => c.name).join(', ')}` }
  const customer = partial[0] ?? null

  let unit: Doc<'cages'> | null = null
  if (input.unit) {
    const u = await findUnit(ctx, w, input.unit)
    if ('ok' in u) return u
    unit = u
  }
  const ago = backDays(input.daysAgo, 30)
  if (ago == null) return { ok: false, error: 'daysAgo must be a whole number from 0 to 30.' }
  const siteId = unit?.locationId ?? w.site?._id
  const date = await dayOf(ctx, w, siteId, ago)
  const due = input.dueInDays
  if (due != null && !(Number.isInteger(due) && due >= 0 && due <= 365)) return { ok: false, error: 'dueInDays must be 0 to 365.' }
  const currency = mergeSettings(w.company.settings).locale.currency
  const total = Math.round(input.weightKg * input.pricePerKg * 100) / 100
  const invoice = input.invoice === true
  return {
    ok: true,
    payload: {
      kind: 'sale',
      customerId: customer?._id,
      customerName: customer?.name ?? typed,
      weightKg: input.weightKg,
      pricePerKg: input.pricePerKg,
      totalAmount: total,
      currency,
      cageId: unit?._id,
      cageName: unit?.name,
      invoice,
      dueDate: invoice && due != null ? addDays(date, due) : undefined,
      notes: trimTo(input.notes, MAX_NOTES),
    },
    siteId,
    date,
    summary: `Sale to ${customer?.name ?? `${typed} (new buyer name)`} on ${date}: ${fmt(input.weightKg)} kg at ${money(input.pricePerKg, currency)}/kg = ${money(total, currency)}${unit ? ` from ${unit.name}` : ''}${invoice ? ', with an invoice' : ''}.`,
    fingerprint: `sale|${customer?._id ?? key}|${date}|${input.weightKg}|${input.pricePerKg}`,
  }
}

type ApprovalKind = 'stocking' | 'topup' | 'transfer'

/** Which pending request a `ref` names: tried as each approval table's id. */
function approvalKindOf(ctx: QueryCtx, ref: string): ApprovalKind | null {
  if (ctx.db.normalizeId('stockingHistory', ref)) return 'stocking'
  if (ctx.db.normalizeId('topupHistory', ref)) return 'topup'
  if (ctx.db.normalizeId('fishTransfers', ref)) return 'transfer'
  return null
}

async function approvalProblem(ctx: QueryCtx, w: WebMember, kind: ApprovalKind, recordId: string): Promise<string | null> {
  const a = await loadApproval(ctx, kind, recordId)
  if (!a || a.companyId !== w.binding.companyId) return 'That request was not found.'
  if (!inScope(w, a.locationId)) return 'That site is not in your access.'
  if (!a.pending) return 'That request has already been decided.'
  return null
}

async function buildApproval(ctx: MutationCtx, w: WebMember, input: Infer<typeof approvalInput>): Promise<Built | Failed> {
  const ref = input.ref.trim().slice(0, 64)
  const kind = approvalKindOf(ctx, ref)
  if (!kind) return { ok: false, error: 'Unknown request; call pendingApprovals and use its ref.' }
  const problem = await approvalProblem(ctx, w, kind, ref)
  if (problem) return { ok: false, error: problem }
  const a = (await loadApproval(ctx, kind, ref))!
  const reason = input.decision === 'reject' ? trimTo(input.reason, MAX_NOTES) : undefined
  const date = await dayOf(ctx, w, a.locationId, 0)
  return {
    ok: true,
    payload: { kind: 'approval_decision', approvalKind: kind, recordId: ref, subject: a.subject, decision: input.decision, reason },
    siteId: a.locationId,
    date,
    summary: `${input.decision === 'approve' ? 'Approve' : 'Reject'}: ${a.subject}${reason ? ` (reason: ${reason})` : ''}.`,
    fingerprint: `approval|${ref}`,
  }
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

async function buildReportSchedule(ctx: MutationCtx, w: WebMember, input: Infer<typeof reportScheduleInput>): Promise<Built | Failed> {
  const companyId = w.binding.companyId
  const typed = input.report.trim().toLowerCase().slice(0, 80)
  if (!typed) return { ok: false, error: 'Which saved report?' }
  const reports = [
    ...(await ctx.db
      .query('savedReports')
      .withIndex('by_companyId_and_visibility', (q) => q.eq('companyId', companyId).eq('visibility', 'company'))
      .take(200)),
    ...(await ctx.db
      .query('savedReports')
      .withIndex('by_companyId_and_createdBy', (q) => q.eq('companyId', companyId).eq('createdBy', w.account._id))
      .take(200)),
  ].filter((r, i, all) => canSeeReport(w.member, r) && all.findIndex((x) => x._id === r._id) === i)
  const exact = reports.filter((r) => r.name.trim().toLowerCase() === typed)
  const hits = exact.length ? exact : reports.filter((r) => r.name.toLowerCase().includes(typed))
  if (hits.length !== 1) {
    return {
      ok: false,
      error: hits.length
        ? `Which report? Matches: ${hits.slice(0, 8).map((r) => r.name).join(', ')}`
        : reports.length
          ? `No saved report called "${input.report.slice(0, 60)}". Saved reports: ${reports.slice(0, 8).map((r) => r.name).join(', ')}`
          : 'There are no saved reports yet; build one under Reports first.',
    }
  }
  const report = hits[0]
  if (!canReadDataset(w.member, report.definition)) return { ok: false, error: 'You cannot read this report.' }
  const { tz } = await companyZone(ctx, companyId)
  const timing = {
    frequency: input.frequency,
    localTime: input.time.trim(),
    weekday: input.frequency === 'weekly' ? (input.weekday ?? 1) : undefined,
    dayOfMonth: input.frequency === 'monthly' ? (input.dayOfMonth ?? 1) : undefined,
    timezone: tz,
  }
  const problem = checkTiming(timing)
  if (problem) return { ok: false, error: problem }
  if (!isValidTimeZone(tz)) return { ok: false, error: 'The organization time zone is not set.' }
  let people: Doc<'users'>[] = [w.account]
  if (input.recipients?.length) {
    people = []
    for (const name of input.recipients.slice(0, MAX_RECIPIENTS)) {
      const hits = await membersNamed(ctx, companyId, name)
      if (hits.length !== 1) {
        return {
          ok: false,
          error: hits.length ? `Which person? Matches: ${hits.slice(0, 8).map((p) => p.name).join(', ')}` : `No active member called "${name.slice(0, 40)}".`,
        }
      }
      if (!people.some((p) => p._id === hits[0]._id)) people.push(hits[0])
    }
  }
  const when =
    input.frequency === 'weekly'
      ? `every ${WEEKDAYS[timing.weekday ?? 1]}`
      : input.frequency === 'monthly'
        ? `monthly on day ${timing.dayOfMonth}`
        : 'daily'
  const names = people.map((p) => p.name || p.email || 'Member')
  return {
    ok: true,
    payload: {
      kind: 'report_schedule',
      reportId: report._id,
      reportName: report.name,
      ...timing,
      recipientIds: people.map((p) => p._id),
      recipientNames: names,
    },
    siteId: undefined,
    date: await dayOf(ctx, w, undefined, 0),
    summary: `Email "${report.name}" ${when} at ${timing.localTime} (${tz}) to ${names.join(', ')}.`,
    fingerprint: `schedule|${report._id}|${input.frequency}|${timing.localTime}`,
  }
}

async function buildCyclePlan(ctx: MutationCtx, w: WebMember, input: Infer<typeof cyclePlanInput>): Promise<Built | Failed> {
  const name = trimTo(input.name, PLAN_LIMITS.nameLength)
  if (!name) return { ok: false, error: 'Give the plan a short name.' }
  if (!input.units.length || input.units.length > PLAN_LIMITS.maxUnits) {
    return { ok: false, error: `Name 1 to ${PLAN_LIMITS.maxUnits} units.` }
  }
  const all = await unitsInScope(ctx, w, UNIT_MATCH_CAP)
  const units: Doc<'cages'>[] = []
  for (const typed of input.units) {
    const m = matchUnit(all, typed)
    if (!m.unit) return unitError(typed, m.candidates)
    if (!units.some((u) => u._id === m.unit!._id)) units.push(m.unit)
  }
  const today = await dayOf(ctx, w, units[0].locationId, 0)
  const stockOn = input.stockOn ?? today
  const found = await planAssumptionsFor(ctx, w.member, units.map((u) => u._id), today)
  if (!found) return { ok: false, error: 'None of these units is in your sites.' }
  const inputs = {
    stockOn,
    fishPerUnit: input.fishPerUnit,
    stockAbwG: input.stockAbwG,
    harvestAbwG: input.harvestAbwG,
    feedPricePerBag: input.feedPricePerBag,
    bagKg: input.bagKg ?? PLAN_DEFAULTS.bagKg,
    salePricePerKg: input.salePricePerKg,
    fingerlingPrice: input.fingerlingPrice,
  }
  const problems = planProblems({ ...inputs, units: units.length }, found.assumptions)
  if (problems.length) return { ok: false, error: `Check: ${problems.join(', ')}` }
  const r = planCycle({ ...inputs, units: units.length }, found.assumptions)
  const currency = mergeSettings(w.company.settings).locale.currency
  return {
    ok: true,
    payload: {
      kind: 'cycle_plan',
      name,
      unitIds: units.map((u) => u._id),
      unitNames: units.slice(0, 50).map((u) => u.name),
      inputs,
      assumptions: found.assumptions,
      harvestOn: r.reached ? r.harvestDate : null,
      harvestKg: Math.round(r.harvestKg),
      margin: Math.round(r.margin),
      cashNeeded: Math.round(r.cashNeeded),
    },
    siteId: found.locationId ?? undefined,
    date: today,
    summary: `Cycle plan "${name}" for ${units.length} unit${units.length === 1 ? '' : 's'} stocked ${stockOn}: ${r.reached ? `harvest about ${r.harvestDate}` : 'target weight not reached within two years'}, ${fmt(r.harvestKg, 0)} kg, margin ${money(Math.round(r.margin), currency)}, cash needed ${money(Math.round(r.cashNeeded), currency)}. Assumptions: survival ${found.assumptions.survivalPct}%, FCR ${found.assumptions.fcr} (${found.assumptions.sources.fcr}).`,
    fingerprint: `plan|${name.toLowerCase()}`,
  }
}

export async function buildFarmProposal(ctx: MutationCtx, w: WebMember, input: FarmProposalInput): Promise<Built | Failed> {
  switch (input.kind) {
    case 'sampling':
      return await buildSampling(ctx, w, input)
    case 'water_reading':
      return await buildWater(ctx, w, input)
    case 'harvest':
      return await buildHarvest(ctx, w, input)
    case 'stocking':
      return await buildStocking(ctx, w, input)
    case 'fish_transfer':
      return await buildTransfer(ctx, w, input)
    case 'sale':
      return await buildSale(ctx, w, input)
    case 'approval_decision':
      return await buildApproval(ctx, w, input)
    case 'report_schedule':
      return await buildReportSchedule(ctx, w, input)
    case 'cycle_plan':
      return await buildCyclePlan(ctx, w, input)
  }
}

// ─── Re-check and commit ────────────────────────────────────────────────────

async function unitProblem(ctx: QueryCtx, w: WebMember, cageId: Id<'cages'>): Promise<string | null> {
  const cage = await ctx.db.get(cageId)
  if (!cage || cage.companyId !== w.binding.companyId || cage.archivedAt || !inScope(w, cage.locationId)) {
    return 'That unit is not in your access.'
  }
  return null
}

/** Scope and state checks of a farm item, at read and at confirm (permission is checked by the caller). */
export async function farmItemProblem(ctx: QueryCtx, w: WebMember, row: Doc<'pendingBotActions'>): Promise<string | null> {
  const p = row.payload
  const refusal = farmRefusal(w, p)
  if (refusal) return refusal
  switch (p.kind) {
    case 'sampling':
    case 'water_reading':
    case 'harvest':
    case 'stocking':
      return await unitProblem(ctx, w, p.cageId)
    case 'fish_transfer':
      return (await unitProblem(ctx, w, p.sourceCageId)) ?? (await unitProblem(ctx, w, p.destinationCageId))
    case 'sale':
      return p.cageId ? await unitProblem(ctx, w, p.cageId) : null
    case 'approval_decision': {
      if (row.status !== 'pending') return null
      const problem = await approvalProblem(ctx, w, p.approvalKind, p.recordId)
      if (problem) return problem
      const a = await loadApproval(ctx, p.approvalKind, p.recordId)
      // Segregation of duties (PERM-005), shown on the card before the helper refuses it.
      if (p.decision === 'approve' && a?.requesterId === w.account._id && w.company.settings?.stockingRules?.requireDifferentApprover === true) {
        return 'Someone other than the requester must approve this.'
      }
      return null
    }
    case 'report_schedule': {
      const report = await ctx.db.get(p.reportId)
      if (!report || !canSeeReport(w.member, report) || !canReadDataset(w.member, report.definition)) return 'You cannot read this report.'
      return null
    }
    case 'cycle_plan':
      for (const id of p.unitIds) {
        const problem = await unitProblem(ctx, w, id)
        if (problem) return problem
      }
      return null
    default:
      return null
  }
}

/**
 * Write one confirmed farm item through the form's helper, as the scoped
 * actor (`wctx` carries the "via Anowa" audit channel). Returns "table:id"
 * of what it created. Throws when the helper refuses (the card rolls back).
 */
export async function commitFarm(wctx: MutationCtx, w: WebMember, row: Doc<'pendingBotActions'>): Promise<string> {
  const p = row.payload
  const actor = w.actor
  switch (p.kind) {
    case 'sampling': {
      const [id] = await saveSamplingBatch(wctx, actor, {
        date: row.date,
        records: [{ cageId: p.cageId, totalFishCount: p.fishCounted, totalWeight: p.totalWeightG }],
      })
      return `biweeklyRecords:${id}`
    }
    case 'water_reading': {
      const { id } = await recordReadingAs(wctx, actor, {
        unitId: p.cageId,
        dissolvedOxygen: p.dissolvedOxygen,
        temperatureC: p.temperatureC,
        ph: p.ph,
        ammonia: p.ammonia,
        nitrite: p.nitrite,
        secchiCm: p.secchiCm,
        notes: p.notes,
      })
      return `waterQualityReadings:${id}`
    }
    case 'harvest': {
      const { id } = await createHarvestAs(wctx, actor, {
        cageId: p.cageId,
        harvestDate: row.date,
        averageBodyWeight: p.abwG,
        totalWeight: p.totalWeightKg,
        estimatedCount: p.count,
        harvestType: p.harvestType,
        status: 'completed',
        notes: p.notes,
      })
      if (p.withLot) {
        await createLotAs(wctx, actor, {
          harvestId: id,
          lotCode: p.lotCode,
          weightKg: p.totalWeightKg,
          fishCount: p.count,
          grade: p.grade,
          destination: p.destination,
        })
      }
      return `harvestRecords:${id}`
    }
    case 'stocking': {
      const id = await createStockingAs(wctx, actor, {
        cageId: p.cageId,
        stockingDate: row.date,
        fishCount: p.fishCount,
        initialAbw: p.abwG,
        initialBiomass: p.biomassKg,
        species: p.species,
        sourceLocation: p.sourceLocation,
        notes: p.notes,
      })
      return `stockingHistory:${id}`
    }
    case 'fish_transfer': {
      const id = await createFishTransferAs(wctx, actor, {
        sourceCageId: p.sourceCageId,
        destinationCageId: p.destinationCageId,
        transferDate: row.date,
        quantity: p.quantity,
        abw: p.abwG,
        notes: p.notes,
      })
      return `fishTransfers:${id}`
    }
    case 'sale': {
      const id = await createSaleAs(wctx, actor, {
        customerId: p.customerId,
        customerName: p.customerId ? undefined : p.customerName,
        saleDate: row.date,
        weightKg: p.weightKg,
        pricePerKg: p.pricePerKg,
        cageId: p.cageId,
        harvestId: p.harvestId,
        notes: p.notes,
        locationId: row.siteId,
      })
      if (p.invoice) await issueInvoiceAs(wctx, actor, { saleId: id, issueDate: row.date, dueDate: p.dueDate })
      return `sales:${id}`
    }
    case 'approval_decision': {
      if (p.approvalKind === 'stocking') {
        const id = wctx.db.normalizeId('stockingHistory', p.recordId)!
        if (p.decision === 'approve') await approveStockingAs(wctx, actor, id)
        else await rejectStockingAs(wctx, actor, id, p.reason)
        return `stockingHistory:${id}`
      }
      if (p.approvalKind === 'topup') {
        const id = wctx.db.normalizeId('topupHistory', p.recordId)!
        if (p.decision === 'approve') await approveTopupAs(wctx, actor, id)
        else await rejectTopupAs(wctx, actor, id, p.reason)
        return `topupHistory:${id}`
      }
      const id = wctx.db.normalizeId('fishTransfers', p.recordId)!
      if (p.decision === 'approve') await approveFishTransferAs(wctx, actor, id)
      else await rejectFishTransferAs(wctx, actor, id, p.reason)
      return `fishTransfers:${id}`
    }
    case 'report_schedule': {
      const id = await createScheduleAs(wctx, w.member, {
        reportId: p.reportId,
        frequency: p.frequency,
        localTime: p.localTime,
        weekday: p.weekday,
        dayOfMonth: p.dayOfMonth,
        timezone: p.timezone,
        recipientIds: p.recipientIds,
        enabled: true,
      })
      return `reportSchedules:${id}`
    }
    case 'cycle_plan': {
      const id = await savePlanAs(wctx, w.member, { name: p.name, unitIds: p.unitIds, inputs: p.inputs, assumptions: p.assumptions })
      return `cyclePlans:${id}`
    }
    default:
      throw new Error(`Not a farm draft: ${p.kind}`)
  }
}
