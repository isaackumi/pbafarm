/**
 * Hatchery (Phase 5, HAT-001, HAT-002): broodstock registry, spawnings with
 * egg collection, incubation lots and hatches.
 *
 * A hatch opens a larval batch (origin 'hatchery') through the production
 * engine at a hatchery unit, carrying the spawning and its broodstock, so a
 * fingerling's lineage reaches back from any grow-out harvest. Larval
 * rearing, grading and fingerling dispatch are in convex/nursery.ts.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import {
  broodstockKind,
  broodstockOrigin,
  broodstockSex,
  broodstockStatus,
} from './schema'
import { userError } from './lib/errors'
import { idempotentMutation } from './lib/idempotency'
import { logAudit } from './lib/tenancy'
import { emitDomainEvent } from './lib/events'
import * as engine from './lib/productionEngine'
import { requireHatchery, ownDoc, type HatcheryMember } from './lib/hatcheryAccess'
import {
  eggsPerKgFemale,
  fertilizationPct,
  flowsOf,
  fryPerKgFemale,
  hatchRatePct,
  nurserySurvivalPct,
  round,
} from './lib/kpi'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Broodstock per spawning (both sexes) and per hatched batch. */
export const MAX_SPAWNING_BROODSTOCK = 50
const LIST_LIMIT = 500
/** Default ABW of newly hatched larvae, g (yolk-sac larvae weigh 1–3 mg). */
export const DEFAULT_LARVA_ABW_G = 0.002

/** Units eggs can be incubated in. Undefined unitType is a cage. */
const INCUBATION_UNITS = new Set(['incubator', 'hatchery_tank', 'tank'])

type Ctx = QueryCtx | MutationCtx

function assertDate(d: string | undefined, label: string) {
  if (!d || !DATE_RE.test(d)) throw userError('VALIDATION', `Choose ${label}`)
}

function cleanText(s: string | undefined) {
  const t = s?.trim()
  return t ? t : undefined
}

async function ownUnit(ctx: Ctx, m: HatcheryMember, id: Id<'cages'>) {
  return ownDoc(m, await ctx.db.get(id), 'Unit')
}

const unitTypeOf = (u: Doc<'cages'>) => u.unitType ?? 'cage'

async function codeTaken(ctx: Ctx, companyId: Id<'companies'>, code: string, except?: Id<'broodstock'>) {
  const rows = await ctx.db
    .query('broodstock')
    .withIndex('by_companyId_and_code', (q) => q.eq('companyId', companyId).eq('code', code))
    .take(2)
  return rows.some((r) => r._id !== except)
}

function validateBroodstockNumbers(a: { count?: number; weightG?: number; lengthCm?: number }) {
  if (a.count !== undefined && !(Number.isInteger(a.count) && a.count > 0)) {
    throw userError('VALIDATION', 'Count must be a whole number above zero')
  }
  if (a.weightG !== undefined && !(a.weightG > 0)) throw userError('VALIDATION', 'Weight must be above zero')
  if (a.lengthCm !== undefined && !(a.lengthCm > 0)) throw userError('VALIDATION', 'Length must be above zero')
}

// ---------------------------------------------------------------------------
// Broodstock (HAT-001)
// ---------------------------------------------------------------------------

function broodstockRow(b: Doc<'broodstock'>, unitName: string | null) {
  return {
    id: b._id,
    code: b.code,
    kind: b.kind,
    pit_tag: b.pitTag ?? null,
    species: b.speciesCode ?? null,
    strain: b.strain ?? null,
    sex: b.sex,
    count: b.count,
    weight_g: b.weightG ?? null,
    total_kg: b.weightG ? round((b.weightG * b.count) / 1000, 2) : null,
    length_cm: b.lengthCm ?? null,
    origin: b.origin,
    origin_note: b.originNote ?? null,
    origin_batch_id: b.originBatchId ?? null,
    acquired_on: b.acquiredOn ?? null,
    status: b.status,
    conditioning_started_on: b.conditioningStartedOn ?? null,
    last_spawned_on: b.lastSpawnedOn ?? null,
    spawn_count: b.spawnCount ?? 0,
    notes: b.notes ?? null,
    unit_id: b.unitId ?? null,
    unit_name: unitName,
    location_id: b.locationId ?? null,
  }
}

async function unitNames(ctx: Ctx, ids: Array<Id<'cages'> | undefined>) {
  const names = new Map<string, string>()
  for (const id of ids) {
    if (!id || names.has(String(id))) continue
    names.set(String(id), (await ctx.db.get(id))?.name ?? '—')
  }
  return (id?: Id<'cages'>) => (id ? names.get(String(id)) ?? null : null)
}

const sexValues = v.union(
  v.literal('mixed'),
  v.literal('female'),
  v.literal('male'),
  v.literal('unknown'),
)

const originValues = v.union(
  v.literal('hatchery'),
  v.literal('other'),
  v.literal('wild'),
  v.literal('farm'),
  v.literal('purchased'),
)

const statusValues = v.union(
  v.literal('retired'),
  v.literal('ready'),
  v.literal('conditioning'),
  v.literal('spent'),
  v.literal('resting'),
  v.literal('dead'),
)

const spawningRow = v.object({
  id: v.id('spawningEvents'),
  spawn_date: v.string(),
  method: v.union(v.literal('natural'), v.literal('induced'), v.literal('stripped')),
  hormone: v.union(v.string(), v.null()),
  hormone_dose: v.union(v.string(), v.null()),
  unit_id: v.union(v.id('cages'), v.null()),
  unit_name: v.union(v.string(), v.null()),
  species: v.union(v.string(), v.null()),
  female_ids: v.array(v.id('broodstock')),
  male_ids: v.array(v.id('broodstock')),
  female_codes: v.array(v.string()),
  male_codes: v.array(v.string()),
  female_weight_kg: v.union(v.number(), v.null()),
  eggs_collected: v.union(v.number(), v.null()),
  egg_weight_g: v.union(v.number(), v.null()),
  fertilization_pct: v.union(v.number(), v.null()),
  collected_on: v.union(v.string(), v.null()),
  status: v.union(
    v.literal('failed'),
    v.literal('spawned'),
    v.literal('incubating'),
    v.literal('hatched'),
  ),
  notes: v.union(v.string(), v.null()),
  eggs_incubated: v.number(),
  larvae: v.number(),
  hatch_pct: v.union(v.number(), v.null()),
  eggs_per_kg_female: v.union(v.number(), v.null()),
  fry_per_kg_female: v.union(v.number(), v.null()),
  lots: v.array(
    v.object({
      id: v.id('incubationLots'),
      spawning_event_id: v.id('spawningEvents'),
      unit_id: v.id('cages'),
      unit_name: v.union(v.string(), v.null()),
      started_on: v.string(),
      eggs: v.number(),
      temperature_c: v.union(v.number(), v.null()),
      status: v.union(v.literal('failed'), v.literal('incubating'), v.literal('hatched')),
      hatched_on: v.union(v.string(), v.null()),
      larvae_count: v.union(v.number(), v.null()),
      hatch_pct: v.union(v.number(), v.null()),
      larval_unit_id: v.union(v.id('cages'), v.null()),
      batch_id: v.union(v.id('batches'), v.null()),
      batch_number: v.union(v.string(), v.null()),
      notes: v.union(v.string(), v.null()),
    }),
  ),
})

export const listBroodstock = query({
  args: { status: v.optional(broodstockStatus), unitId: v.optional(v.id('cages')) },
  returns: v.array(
    v.object({
      id: v.id('broodstock'),
      code: v.string(),
      kind: v.union(v.literal('individual'), v.literal('group')),
      pit_tag: v.union(v.string(), v.null()),
      species: v.union(v.string(), v.null()),
      strain: v.union(v.string(), v.null()),
      sex: sexValues,
      count: v.number(),
      weight_g: v.union(v.number(), v.null()),
      total_kg: v.union(v.number(), v.null()),
      length_cm: v.union(v.number(), v.null()),
      origin: originValues,
      origin_note: v.union(v.string(), v.null()),
      origin_batch_id: v.union(v.id('batches'), v.null()),
      acquired_on: v.union(v.string(), v.null()),
      status: statusValues,
      conditioning_started_on: v.union(v.string(), v.null()),
      last_spawned_on: v.union(v.string(), v.null()),
      spawn_count: v.number(),
      notes: v.union(v.string(), v.null()),
      unit_id: v.union(v.id('cages'), v.null()),
      unit_name: v.union(v.string(), v.null()),
      location_id: v.union(v.id('farmLocations'), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.view')
    let rows: Doc<'broodstock'>[]
    if (args.unitId) {
      rows = (
        await ctx.db
          .query('broodstock')
          .withIndex('by_unitId', (q) => q.eq('unitId', args.unitId))
          .take(LIST_LIMIT)
      ).filter((b) => b.companyId === m.companyId && (!args.status || b.status === args.status))
    } else if (args.status) {
      rows = await ctx.db
        .query('broodstock')
        .withIndex('by_companyId_and_status', (q) => q.eq('companyId', m.companyId).eq('status', args.status!))
        .take(LIST_LIMIT)
    } else {
      rows = await ctx.db
        .query('broodstock')
        .withIndex('by_companyId_and_code', (q) => q.eq('companyId', m.companyId))
        .take(LIST_LIMIT)
    }
    const name = await unitNames(ctx, rows.map((r) => r.unitId))
    return rows.map((b) => broodstockRow(b, name(b.unitId)))
  },
})

export const getBroodstock = query({
  args: { id: v.id('broodstock') },
  returns: v.object({
    spawnings: v.array(spawningRow),
    id: v.id('broodstock'),
    code: v.string(),
    kind: v.union(v.literal('individual'), v.literal('group')),
    pit_tag: v.union(v.string(), v.null()),
    species: v.union(v.string(), v.null()),
    strain: v.union(v.string(), v.null()),
    sex: sexValues,
    count: v.number(),
    weight_g: v.union(v.number(), v.null()),
    total_kg: v.union(v.number(), v.null()),
    length_cm: v.union(v.number(), v.null()),
    origin: originValues,
    origin_note: v.union(v.string(), v.null()),
    origin_batch_id: v.union(v.id('batches'), v.null()),
    acquired_on: v.union(v.string(), v.null()),
    status: statusValues,
    conditioning_started_on: v.union(v.string(), v.null()),
    last_spawned_on: v.union(v.string(), v.null()),
    spawn_count: v.number(),
    notes: v.union(v.string(), v.null()),
    unit_id: v.union(v.id('cages'), v.null()),
    unit_name: v.union(v.string(), v.null()),
    location_id: v.union(v.id('farmLocations'), v.null()),
  }),
  handler: async (ctx, { id }) => {
    const m = await requireHatchery(ctx, 'hatchery.view')
    const b = ownDoc(m, await ctx.db.get(id), 'Broodstock')
    const name = await unitNames(ctx, [b.unitId])
    const spawns = (
      await ctx.db
        .query('spawningEvents')
        .withIndex('by_companyId_and_spawnDate', (q) => q.eq('companyId', m.companyId))
        .order('desc')
        .take(LIST_LIMIT)
    ).filter((s) => s.femaleIds.includes(id) || s.maleIds.includes(id))
    const spawnings = []
    for (const s of spawns) spawnings.push(await spawningSummary(ctx, s))
    return { ...broodstockRow(b, name(b.unitId)), spawnings }
  },
})

const broodstockFields = {
  unitId: v.optional(v.id('cages')),
  pitTag: v.optional(v.string()),
  speciesCode: v.optional(v.string()),
  strain: v.optional(v.string()),
  weightG: v.optional(v.number()),
  lengthCm: v.optional(v.number()),
  originNote: v.optional(v.string()),
  originBatchId: v.optional(v.id('batches')),
  acquiredOn: v.optional(v.string()),
  conditioningStartedOn: v.optional(v.string()),
  notes: v.optional(v.string()),
}

export const createBroodstock = mutation({
  args: {
    ...broodstockFields,
    kind: broodstockKind,
    code: v.string(),
    sex: broodstockSex,
    count: v.optional(v.number()),
    origin: broodstockOrigin,
    status: v.optional(broodstockStatus),
  },
  returns: v.id('broodstock'),
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.broodstock.manage')
    const code = args.code.trim()
    if (!code) throw userError('VALIDATION', 'Enter a tag or group name')
    if (await codeTaken(ctx, m.companyId, code)) {
      throw userError('DUPLICATE', `Broodstock ${code} already exists`)
    }
    const count = args.kind === 'individual' ? 1 : args.count ?? 0
    if (args.kind === 'individual' && args.count !== undefined && args.count !== 1) {
      throw userError('VALIDATION', 'An individual is one fish; record a group for several')
    }
    if (args.kind === 'individual' && args.sex === 'mixed') {
      throw userError('VALIDATION', 'An individual fish cannot be of mixed sex')
    }
    validateBroodstockNumbers({ count, weightG: args.weightG, lengthCm: args.lengthCm })
    for (const d of [args.acquiredOn, args.conditioningStartedOn]) if (d) assertDate(d, 'a valid date')
    const unit = args.unitId ? await ownUnit(ctx, m, args.unitId) : null
    if (args.originBatchId) ownDoc(m, await ctx.db.get(args.originBatchId), 'Batch')
    const status = args.status ?? (args.conditioningStartedOn ? 'conditioning' : 'ready')
    const id = await ctx.db.insert('broodstock', {
      companyId: m.companyId,
      locationId: unit?.locationId,
      unitId: args.unitId,
      kind: args.kind,
      code,
      pitTag: cleanText(args.pitTag),
      speciesCode: cleanText(args.speciesCode),
      strain: cleanText(args.strain),
      sex: args.sex,
      count,
      weightG: args.weightG,
      lengthCm: args.lengthCm,
      origin: args.origin,
      originNote: cleanText(args.originNote),
      originBatchId: args.originBatchId,
      acquiredOn: args.acquiredOn,
      status,
      conditioningStartedOn: args.conditioningStartedOn,
      notes: cleanText(args.notes),
      createdBy: m.user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'broodstock',
      recordId: id,
      newValues: { ...args, code, count, status },
      locationId: unit?.locationId,
    })
    return id
  },
})

export const updateBroodstock = mutation({
  args: {
    ...broodstockFields,
    id: v.id('broodstock'),
    code: v.optional(v.string()),
    sex: v.optional(broodstockSex),
    count: v.optional(v.number()),
    status: v.optional(broodstockStatus),
  },
  returns: v.id('broodstock'),
  handler: async (ctx, { id, ...args }) => {
    const m = await requireHatchery(ctx, 'hatchery.broodstock.manage')
    const b = ownDoc(m, await ctx.db.get(id), 'Broodstock')
    const patch: Partial<Doc<'broodstock'>> = {}
    if (args.code !== undefined) {
      const code = args.code.trim()
      if (!code) throw userError('VALIDATION', 'Enter a tag or group name')
      if (code !== b.code && (await codeTaken(ctx, m.companyId, code, id))) {
        throw userError('DUPLICATE', `Broodstock ${code} already exists`)
      }
      patch.code = code
    }
    if (args.count !== undefined && b.kind === 'individual' && args.count !== 1) {
      throw userError('VALIDATION', 'An individual is one fish')
    }
    if (args.sex === 'mixed' && b.kind === 'individual') {
      throw userError('VALIDATION', 'An individual fish cannot be of mixed sex')
    }
    validateBroodstockNumbers(args)
    for (const d of [args.acquiredOn, args.conditioningStartedOn]) if (d) assertDate(d, 'a valid date')
    if (args.unitId !== undefined) {
      const unit = await ownUnit(ctx, m, args.unitId)
      patch.unitId = unit._id
      patch.locationId = unit.locationId
    }
    if (args.originBatchId) ownDoc(m, await ctx.db.get(args.originBatchId), 'Batch')
    for (const k of ['pitTag', 'speciesCode', 'strain', 'originNote', 'notes'] as const) {
      if (args[k] !== undefined) patch[k] = cleanText(args[k])
    }
    for (const k of [
      'sex',
      'count',
      'weightG',
      'lengthCm',
      'originBatchId',
      'acquiredOn',
      'conditioningStartedOn',
      'status',
    ] as const) {
      if (args[k] !== undefined) (patch as Record<string, unknown>)[k] = args[k]
    }
    if (args.status === 'conditioning' && !args.conditioningStartedOn && b.status !== 'conditioning') {
      patch.conditioningStartedOn = new Date().toISOString().slice(0, 10)
    }
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'broodstock',
      recordId: id,
      previousValues: b,
      newValues: patch,
      locationId: patch.locationId ?? b.locationId,
    })
    return id
  },
})

// ---------------------------------------------------------------------------
// Spawning and egg collection (HAT-002)
// ---------------------------------------------------------------------------

async function lotsOf(ctx: Ctx, spawningEventId: Id<'spawningEvents'>) {
  return await ctx.db
    .query('incubationLots')
    .withIndex('by_spawningEventId', (q) => q.eq('spawningEventId', spawningEventId))
    .take(100)
}

function lotRow(l: Doc<'incubationLots'>, unitName: string | null, batchNumber: string | null) {
  return {
    id: l._id,
    spawning_event_id: l.spawningEventId,
    unit_id: l.unitId,
    unit_name: unitName,
    started_on: l.startedOn,
    eggs: l.eggs,
    temperature_c: l.temperatureC ?? null,
    status: l.status,
    hatched_on: l.hatchedOn ?? null,
    larvae_count: l.larvaeCount ?? null,
    hatch_pct: l.hatchPct ?? null,
    larval_unit_id: l.larvalUnitId ?? null,
    batch_id: l.batchId ?? null,
    batch_number: batchNumber,
    notes: l.notes ?? null,
  }
}

async function spawningSummary(ctx: Ctx, s: Doc<'spawningEvents'>) {
  const lots = await lotsOf(ctx, s._id)
  const name = await unitNames(ctx, [s.unitId, ...lots.map((l) => l.unitId)])
  const lotRows = []
  for (const l of lots) {
    const batch = l.batchId ? await ctx.db.get(l.batchId) : null
    lotRows.push(lotRow(l, name(l.unitId), batch?.batchNumber ?? null))
  }
  const codes = async (ids: Id<'broodstock'>[]) => {
    const out: string[] = []
    for (const id of ids) out.push((await ctx.db.get(id))?.code ?? '—')
    return out
  }
  const eggsIncubated = lots.reduce((t, l) => t + l.eggs, 0)
  const hatchedLots = lots.filter((l) => l.status === 'hatched')
  const larvae = hatchedLots.reduce((t, l) => t + (l.larvaeCount ?? 0), 0)
  const eggsHatchedLots = hatchedLots.reduce((t, l) => t + l.eggs, 0)
  return {
    id: s._id,
    spawn_date: s.spawnDate,
    method: s.method,
    hormone: s.hormone ?? null,
    hormone_dose: s.hormoneDose ?? null,
    unit_id: s.unitId ?? null,
    unit_name: name(s.unitId),
    species: s.speciesCode ?? null,
    female_ids: s.femaleIds,
    male_ids: s.maleIds,
    female_codes: await codes(s.femaleIds),
    male_codes: await codes(s.maleIds),
    female_weight_kg: s.femaleWeightKg ?? null,
    eggs_collected: s.eggsCollected ?? null,
    egg_weight_g: s.eggWeightG ?? null,
    fertilization_pct: s.fertilizationPct ?? null,
    collected_on: s.collectedOn ?? null,
    status: s.status,
    notes: s.notes ?? null,
    eggs_incubated: eggsIncubated,
    larvae,
    hatch_pct: round(hatchRatePct(larvae, eggsHatchedLots), 1),
    eggs_per_kg_female: round(eggsPerKgFemale(s.eggsCollected, s.femaleWeightKg), 0),
    fry_per_kg_female: round(fryPerKgFemale(hatchedLots.length ? larvae : null, s.femaleWeightKg), 0),
    lots: lotRows,
  }
}

export const listSpawnings = query({
  args: { from: v.optional(v.string()), to: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(spawningRow),
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.view')
    const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 100)), 200)
    const rows = await ctx.db
      .query('spawningEvents')
      .withIndex('by_companyId_and_spawnDate', (q) => {
        const base = q.eq('companyId', m.companyId)
        if (args.from && args.to) return base.gte('spawnDate', args.from).lte('spawnDate', args.to)
        if (args.from) return base.gte('spawnDate', args.from)
        if (args.to) return base.lte('spawnDate', args.to)
        return base
      })
      .order('desc')
      .take(limit)
    const out = []
    for (const s of rows) out.push(await spawningSummary(ctx, s))
    return out
  },
})

export const getSpawning = query({
  args: { id: v.id('spawningEvents') },
  returns: spawningRow,
  handler: async (ctx, { id }) => {
    const m = await requireHatchery(ctx, 'hatchery.view')
    return await spawningSummary(ctx, ownDoc(m, await ctx.db.get(id), 'Spawning'))
  },
})

function validateEggs(a: { eggsCollected?: number; eggWeightG?: number; fertilizationPct?: number }) {
  if (a.eggsCollected !== undefined && !(Number.isInteger(a.eggsCollected) && a.eggsCollected >= 0)) {
    throw userError('VALIDATION', 'Eggs collected must be a whole number')
  }
  if (a.eggWeightG !== undefined && !(a.eggWeightG >= 0)) throw userError('VALIDATION', 'Egg weight must be 0 or more')
  if (a.fertilizationPct !== undefined && !(a.fertilizationPct >= 0 && a.fertilizationPct <= 100)) {
    throw userError('VALIDATION', 'Fertilization must be between 0 and 100 %')
  }
}

export const recordSpawning = idempotentMutation('hatchery.recordSpawning', {
  args: {
    spawnDate: v.string(),
    method: v.union(v.literal('natural'), v.literal('induced'), v.literal('stripped')),
    hormone: v.optional(v.string()),
    hormoneDose: v.optional(v.string()),
    femaleIds: v.array(v.id('broodstock')),
    maleIds: v.array(v.id('broodstock')),
    unitId: v.optional(v.id('cages')),
    eggsCollected: v.optional(v.number()),
    eggWeightG: v.optional(v.number()),
    fertilizationPct: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.spawning.record')
    assertDate(args.spawnDate, 'a spawning date')
    const femaleIds = [...new Set(args.femaleIds)]
    const maleIds = [...new Set(args.maleIds)]
    if (!femaleIds.length) throw userError('VALIDATION', 'Choose at least one female or group')
    if (femaleIds.length + maleIds.length > MAX_SPAWNING_BROODSTOCK) {
      throw userError('VALIDATION', `At most ${MAX_SPAWNING_BROODSTOCK} broodstock per spawning`)
    }
    if (femaleIds.some((id) => maleIds.includes(id))) {
      throw userError('VALIDATION', 'A fish cannot be both a female and a male of the spawning')
    }
    if (args.method === 'induced' && !cleanText(args.hormone)) {
      throw userError('VALIDATION', 'Name the hormone used for an induced spawning')
    }
    validateEggs(args)
    const unit = args.unitId ? await ownUnit(ctx, m, args.unitId) : null

    const load = async (ids: Id<'broodstock'>[], role: 'female' | 'male') => {
      const out: Doc<'broodstock'>[] = []
      for (const id of ids) {
        const b = ownDoc(m, await ctx.db.get(id), 'Broodstock')
        if (b.status === 'dead' || b.status === 'retired') {
          throw userError('CONFLICT', `${b.code} is ${b.status} and cannot spawn`)
        }
        const other = role === 'female' ? 'male' : 'female'
        if (b.sex === other) throw userError('VALIDATION', `${b.code} is ${b.sex}, not ${role}`)
        out.push(b)
      }
      return out
    }
    const females = await load(femaleIds, 'female')
    const males = await load(maleIds, 'male')
    const species = [...new Set([...females, ...males].map((b) => b.speciesCode).filter(Boolean))]
    if (species.length > 1) throw userError('VALIDATION', `Broodstock of different species: ${species.join(', ')}`)
    // Female weight for fry per kg: known only when every female has a weight.
    const femaleWeightKg = females.every((b) => b.weightG)
      ? round(females.reduce((t, b) => t + (b.weightG! * (b.sex === 'mixed' ? b.count / 2 : b.count)) / 1000, 0), 3) ??
        undefined
      : undefined

    const id = await ctx.db.insert('spawningEvents', {
      companyId: m.companyId,
      locationId: unit?.locationId ?? females[0].locationId,
      unitId: args.unitId,
      spawnDate: args.spawnDate,
      method: args.method,
      hormone: cleanText(args.hormone),
      hormoneDose: cleanText(args.hormoneDose),
      femaleIds,
      maleIds,
      femaleWeightKg,
      speciesCode: species[0],
      eggsCollected: args.eggsCollected,
      eggWeightG: args.eggWeightG,
      fertilizationPct: args.fertilizationPct,
      collectedOn: args.eggsCollected !== undefined ? args.spawnDate : undefined,
      status: 'spawned',
      notes: cleanText(args.notes),
      createdBy: m.user._id,
      updatedAt: Date.now(),
    })
    for (const b of [...females, ...males]) {
      await ctx.db.patch(b._id, {
        status: 'spent',
        lastSpawnedOn: !b.lastSpawnedOn || args.spawnDate > b.lastSpawnedOn ? args.spawnDate : b.lastSpawnedOn,
        spawnCount: (b.spawnCount ?? 0) + 1,
        updatedAt: Date.now(),
      })
    }
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'spawningEvents',
      recordId: id,
      newValues: { ...args, femaleWeightKg },
      locationId: unit?.locationId ?? females[0].locationId,
    })
    await emitDomainEvent(
      ctx,
      'hatchery.spawning',
      {
        spawningEventId: id,
        spawnDate: args.spawnDate,
        method: args.method,
        females: femaleIds.length,
        males: maleIds.length,
        eggsCollected: args.eggsCollected,
      },
      { companyId: m.companyId, locationId: unit?.locationId ?? females[0].locationId },
    )
    return id
  },
})

/** Egg collection after the spawning: count, weight, fertilization. */
export const recordEggCollection = idempotentMutation('hatchery.recordEggCollection', {
  args: {
    spawningEventId: v.id('spawningEvents'),
    collectedOn: v.string(),
    eggsCollected: v.number(),
    eggWeightG: v.optional(v.number()),
    fertilizationPct: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.spawning.record')
    const s = ownDoc(m, await ctx.db.get(args.spawningEventId), 'Spawning')
    assertDate(args.collectedOn, 'a collection date')
    if (args.collectedOn < s.spawnDate) throw userError('VALIDATION', 'Eggs cannot be collected before the spawning')
    validateEggs(args)
    const incubated = (await lotsOf(ctx, s._id)).reduce((t, l) => t + l.eggs, 0)
    if (args.eggsCollected < incubated) {
      throw userError('CONFLICT', `${incubated.toLocaleString()} eggs are already in incubation`)
    }
    const patch = {
      collectedOn: args.collectedOn,
      eggsCollected: args.eggsCollected,
      eggWeightG: args.eggWeightG,
      fertilizationPct: args.fertilizationPct,
      updatedAt: Date.now(),
    }
    await ctx.db.patch(s._id, patch)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'spawningEvents',
      recordId: s._id,
      previousValues: { eggsCollected: s.eggsCollected, eggWeightG: s.eggWeightG, fertilizationPct: s.fertilizationPct },
      newValues: patch,
      locationId: s.locationId,
    })
    return s._id
  },
})

// ---------------------------------------------------------------------------
// Incubation and hatching (HAT-002)
// ---------------------------------------------------------------------------

export const startIncubation = idempotentMutation('hatchery.startIncubation', {
  args: {
    spawningEventId: v.id('spawningEvents'),
    unitId: v.id('cages'),
    startedOn: v.string(),
    eggs: v.number(),
    temperatureC: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.spawning.record')
    const s = ownDoc(m, await ctx.db.get(args.spawningEventId), 'Spawning')
    if (s.status === 'failed') throw userError('CONFLICT', 'This spawning was marked failed')
    assertDate(args.startedOn, 'an incubation date')
    if (args.startedOn < s.spawnDate) throw userError('VALIDATION', 'Incubation cannot start before the spawning')
    if (!(Number.isInteger(args.eggs) && args.eggs > 0)) {
      throw userError('VALIDATION', 'Eggs must be a whole number above zero')
    }
    const unit = await ownUnit(ctx, m, args.unitId)
    if (!INCUBATION_UNITS.has(unitTypeOf(unit))) {
      throw userError('VALIDATION', `${unit.name} is a ${unitTypeOf(unit).replace('_', ' ')}; incubate in an incubator, hatchery tank or tank`)
    }
    const lots = await lotsOf(ctx, s._id)
    const incubated = lots.reduce((t, l) => t + l.eggs, 0)
    if (s.eggsCollected !== undefined && incubated + args.eggs > s.eggsCollected) {
      throw userError(
        'CONFLICT',
        `Only ${(s.eggsCollected - incubated).toLocaleString()} of the ${s.eggsCollected.toLocaleString()} eggs collected are left to incubate`,
      )
    }
    const id = await ctx.db.insert('incubationLots', {
      companyId: m.companyId,
      locationId: unit.locationId,
      spawningEventId: s._id,
      unitId: unit._id,
      startedOn: args.startedOn,
      eggs: args.eggs,
      temperatureC: args.temperatureC,
      status: 'incubating',
      notes: cleanText(args.notes),
      createdBy: m.user._id,
      updatedAt: Date.now(),
    })
    if (s.status === 'spawned') await ctx.db.patch(s._id, { status: 'incubating', updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'incubationLots',
      recordId: id,
      newValues: args,
      locationId: unit.locationId,
    })
    return id
  },
})

/** Spawning status follows its lots: hatched when any hatched and none incubate; failed when all failed. */
async function syncSpawningStatus(ctx: MutationCtx, spawningEventId: Id<'spawningEvents'>) {
  const s = await ctx.db.get(spawningEventId)
  if (!s) return
  const lots = await lotsOf(ctx, spawningEventId)
  let status: Doc<'spawningEvents'>['status'] = 'spawned'
  if (lots.some((l) => l.status === 'incubating')) status = 'incubating'
  else if (lots.some((l) => l.status === 'hatched')) status = 'hatched'
  else if (lots.length) status = 'failed'
  if (status !== s.status) await ctx.db.patch(s._id, { status, updatedAt: Date.now() })
}

function batchSlug(u: Doc<'cages'>) {
  return (u.code || u.name || 'TANK').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 10) || 'TANK'
}

/**
 * Hatch an incubation lot: the larvae open a batch (origin 'hatchery') in the
 * larval unit through the engine, in the same transaction. The unit must not
 * hold another batch (engine I4).
 */
export const recordHatch = idempotentMutation('hatchery.recordHatch', {
  args: {
    lotId: v.id('incubationLots'),
    hatchedOn: v.string(),
    larvaeCount: v.number(),
    larvalUnitId: v.optional(v.id('cages')),
    abwG: v.optional(v.number()),
    batchNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.spawning.record')
    const lot = ownDoc(m, await ctx.db.get(args.lotId), 'Incubation lot')
    if (lot.status !== 'incubating') throw userError('CONFLICT', `This lot is already ${lot.status}`)
    assertDate(args.hatchedOn, 'a hatch date')
    if (args.hatchedOn < lot.startedOn) throw userError('VALIDATION', 'Hatching cannot be before incubation started')
    if (!(Number.isInteger(args.larvaeCount) && args.larvaeCount > 0)) {
      throw userError('VALIDATION', 'Larvae must be a whole number above zero; mark the lot failed if none hatched')
    }
    if (args.abwG !== undefined && !(args.abwG > 0)) throw userError('VALIDATION', 'Larval weight must be above zero')
    const s = ownDoc(m, await ctx.db.get(lot.spawningEventId), 'Spawning')
    const unit = await ownUnit(ctx, m, args.larvalUnitId ?? lot.unitId)
    const opts = { companyId: m.companyId, userId: m.user._id }
    const broodstockIds = [...s.femaleIds, ...s.maleIds].slice(0, MAX_SPAWNING_BROODSTOCK)
    const batchId = await engine.openBatch(ctx, opts, {
      batchNumber: cleanText(args.batchNumber) ?? `HAT-${batchSlug(unit)}-${args.hatchedOn.replace(/-/g, '')}`,
      origin: 'hatchery',
      openedOn: args.hatchedOn,
      speciesCode: s.speciesCode,
      homeLocationId: unit.locationId,
    })
    await ctx.db.patch(batchId, { spawningEventId: s._id, broodstockIds })
    const abwG = args.abwG ?? DEFAULT_LARVA_ABW_G
    const result = await engine.stockIn(
      ctx,
      opts,
      { sourceTable: 'incubationLots', sourceId: lot._id },
      { unitId: unit._id, batchId, qty: args.larvaeCount, abwG, date: args.hatchedOn, reason: 'Hatch' },
    )
    const hatchPct = round(hatchRatePct(args.larvaeCount, lot.eggs), 1) ?? undefined
    await ctx.db.patch(lot._id, {
      status: 'hatched',
      hatchedOn: args.hatchedOn,
      larvaeCount: args.larvaeCount,
      hatchPct,
      larvalUnitId: unit._id,
      batchId,
      notes: cleanText(args.notes) ?? lot.notes,
      updatedAt: Date.now(),
    })
    await syncSpawningStatus(ctx, s._id)
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'incubationLots',
      recordId: lot._id,
      newValues: { ...args, batchId, hatchPct },
      locationId: unit.locationId,
    })
    const batch = await ctx.db.get(batchId)
    await emitDomainEvent(
      ctx,
      'hatchery.hatch',
      {
        lotId: lot._id,
        spawningEventId: s._id,
        batchId,
        batchNumber: batch?.batchNumber,
        larvae: args.larvaeCount,
        hatchPct,
        cageId: unit._id,
        unitNames: unit.name,
        hatchedOn: args.hatchedOn,
      },
      { companyId: m.companyId, locationId: unit.locationId },
    )
    return { lotId: lot._id, batchId, batchNumber: batch?.batchNumber ?? null, hatchPct: hatchPct ?? null, warnings: result.warnings }
  },
})

export const markLotFailed = mutation({
  args: { lotId: v.id('incubationLots'), date: v.string(), reason: v.string() },
  returns: v.id('incubationLots'),
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.spawning.record')
    const lot = ownDoc(m, await ctx.db.get(args.lotId), 'Incubation lot')
    if (lot.status !== 'incubating') throw userError('CONFLICT', `This lot is already ${lot.status}`)
    assertDate(args.date, 'a date')
    const reason = cleanText(args.reason)
    if (!reason) throw userError('VALIDATION', 'Give a reason')
    await ctx.db.patch(lot._id, {
      status: 'failed',
      hatchedOn: args.date,
      larvaeCount: 0,
      hatchPct: 0,
      notes: reason,
      updatedAt: Date.now(),
    })
    await syncSpawningStatus(ctx, lot.spawningEventId)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'incubationLots',
      recordId: lot._id,
      previousValues: { status: lot.status },
      newValues: { status: 'failed', reason },
      locationId: lot.locationId,
    })
    return lot._id
  },
})

/**
 * Undo a hatch recorded in error: the stock-in is reversed (engine), the lot
 * goes back to incubating and the empty batch closes. Refused once the larvae
 * have other events (logs, grading, transfers): reverse those first.
 */
export const reverseHatch = mutation({
  args: { lotId: v.id('incubationLots'), reason: v.string() },
  returns: v.object({ reversed: v.number() }),
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.correct')
    const lot = ownDoc(m, await ctx.db.get(args.lotId), 'Incubation lot')
    if (lot.status !== 'hatched' || !lot.batchId) throw userError('CONFLICT', 'This lot has no hatch to reverse')
    const reason = cleanText(args.reason)
    if (!reason) throw userError('VALIDATION', 'Give a reason')
    const live = engine.activeEvents(await engine.eventsForBatch(ctx, lot.batchId))
    if (live.some((e) => e.sourceTable !== 'incubationLots' || e.sourceId !== lot._id)) {
      throw userError('CONFLICT', 'These larvae already have later records. Reverse those first.')
    }
    const result = await engine.reverseOperation(
      ctx,
      { companyId: m.companyId, userId: m.user._id },
      { sourceTable: 'incubationLots', sourceId: lot._id },
      reason,
    )
    await ctx.db.patch(lot._id, {
      status: 'incubating',
      hatchedOn: undefined,
      larvaeCount: undefined,
      hatchPct: undefined,
      larvalUnitId: undefined,
      batchId: undefined,
      updatedAt: Date.now(),
    })
    await syncSpawningStatus(ctx, lot.spawningEventId)
    await logAudit(ctx, {
      actionType: 'reverse',
      tableName: 'incubationLots',
      recordId: lot._id,
      previousValues: { batchId: lot.batchId, larvaeCount: lot.larvaeCount },
      newValues: { reason },
      locationId: lot.locationId,
    })
    return { reversed: result.reversed }
  },
})

/** Lots on the incubation board: incubating now, plus the latest hatched or failed. */
export const incubationBoard = query({
  args: {},
  returns: v.array(
    v.object({
      spawn_date: v.union(v.string(), v.null()),
      species: v.union(v.string(), v.null()),
      fertilization_pct: v.union(v.number(), v.null()),
      id: v.id('incubationLots'),
      spawning_event_id: v.id('spawningEvents'),
      unit_id: v.id('cages'),
      unit_name: v.union(v.string(), v.null()),
      started_on: v.string(),
      eggs: v.number(),
      temperature_c: v.union(v.number(), v.null()),
      status: v.union(v.literal('failed'), v.literal('incubating'), v.literal('hatched')),
      hatched_on: v.union(v.string(), v.null()),
      larvae_count: v.union(v.number(), v.null()),
      hatch_pct: v.union(v.number(), v.null()),
      larval_unit_id: v.union(v.id('cages'), v.null()),
      batch_id: v.union(v.id('batches'), v.null()),
      batch_number: v.union(v.string(), v.null()),
      notes: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const m = await requireHatchery(ctx, 'hatchery.view')
    const byStatus = (status: Doc<'incubationLots'>['status'], n: number) =>
      ctx.db
        .query('incubationLots')
        .withIndex('by_companyId_and_status', (q) => q.eq('companyId', m.companyId).eq('status', status))
        .order('desc')
        .take(n)
    const lots = [...(await byStatus('incubating', 200)), ...(await byStatus('hatched', 30)), ...(await byStatus('failed', 10))]
    const name = await unitNames(ctx, lots.map((l) => l.unitId))
    const out = []
    for (const l of lots) {
      const s = await ctx.db.get(l.spawningEventId)
      const batch = l.batchId ? await ctx.db.get(l.batchId) : null
      out.push({
        ...lotRow(l, name(l.unitId), batch?.batchNumber ?? null),
        spawn_date: s?.spawnDate ?? null,
        species: s?.speciesCode ?? null,
        fertilization_pct: s?.fertilizationPct ?? null,
      })
    }
    return out
  },
})

/**
 * Hatchery KPIs over spawnings in a date range: eggs, fertilization, hatch
 * rate, fry per kg female, and larval survival of the batches hatched.
 */
export const kpis = query({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  returns: v.object({
    spawnings: v.number(),
    eggs_collected: v.number(),
    fertilization_pct: v.union(v.number(), v.null()),
    hatch_rate_pct: v.union(v.number(), v.null()),
    larvae_hatched: v.number(),
    fry_per_kg_female: v.union(v.number(), v.null()),
    larval_survival_pct: v.union(v.number(), v.null()),
    eggs_incubating: v.number(),
    lots_incubating: v.number(),
    broodstock_by_status: v.record(v.string(), v.number()),
    broodstock_total: v.number(),
  }),
  handler: async (ctx, args) => {
    const m = await requireHatchery(ctx, 'hatchery.view')
    const spawns = await ctx.db
      .query('spawningEvents')
      .withIndex('by_companyId_and_spawnDate', (q) => {
        const base = q.eq('companyId', m.companyId)
        if (args.from && args.to) return base.gte('spawnDate', args.from).lte('spawnDate', args.to)
        if (args.from) return base.gte('spawnDate', args.from)
        if (args.to) return base.lte('spawnDate', args.to)
        return base
      })
      .order('desc')
      .take(LIST_LIMIT)
    let eggs = 0
    let fertileEggs = 0
    let eggsWithFert = 0
    let eggsHatchedLots = 0
    let larvae = 0
    let femaleKg = 0
    let larvaeFromWeighed = 0
    const batchIds: Id<'batches'>[] = []
    for (const s of spawns) {
      eggs += s.eggsCollected ?? 0
      if (s.eggsCollected && s.fertilizationPct != null) {
        eggsWithFert += s.eggsCollected
        fertileEggs += (s.eggsCollected * s.fertilizationPct) / 100
      }
      const hatched = (await lotsOf(ctx, s._id)).filter((l) => l.status === 'hatched')
      const n = hatched.reduce((t, l) => t + (l.larvaeCount ?? 0), 0)
      eggsHatchedLots += hatched.reduce((t, l) => t + l.eggs, 0)
      larvae += n
      if (s.femaleWeightKg && hatched.length) {
        femaleKg += s.femaleWeightKg
        larvaeFromWeighed += n
      }
      for (const l of hatched) if (l.batchId) batchIds.push(l.batchId)
    }
    // Survival of the hatched batches and their fingerling children.
    let stocked = 0
    let accounted = 0
    for (const id of batchIds.slice(0, 100)) {
      const f = flowsOf(await engine.eventsForBatch(ctx, id))
      if (nurserySurvivalPct(f) == null) continue
      stocked += f.stockedCount + f.inCount
      accounted += f.count + f.harvestedCount + f.outCount
    }
    const broodstock = await ctx.db
      .query('broodstock')
      .withIndex('by_companyId_and_code', (q) => q.eq('companyId', m.companyId))
      .take(LIST_LIMIT)
    const byStatus: Record<string, number> = {}
    for (const b of broodstock) byStatus[b.status] = (byStatus[b.status] ?? 0) + b.count
    const incubating = await ctx.db
      .query('incubationLots')
      .withIndex('by_companyId_and_status', (q) => q.eq('companyId', m.companyId).eq('status', 'incubating'))
      .take(200)
    return {
      spawnings: spawns.length,
      eggs_collected: eggs,
      fertilization_pct: round(fertilizationPct(fertileEggs, eggsWithFert), 1),
      hatch_rate_pct: round(hatchRatePct(larvae, eggsHatchedLots), 1),
      larvae_hatched: larvae,
      fry_per_kg_female: round(fryPerKgFemale(larvaeFromWeighed, femaleKg), 0),
      larval_survival_pct: round(stocked > 0 ? (accounted / stocked) * 100 : null, 1),
      eggs_incubating: incubating.reduce((t, l) => t + l.eggs, 0),
      lots_incubating: incubating.length,
      broodstock_by_status: byStatus,
      broodstock_total: broodstock.reduce((t, b) => t + b.count, 0),
    }
  },
})

/** Where a hatched batch came from: spawning and broodstock (for batch and trace pages). */
export const batchOrigin = query({
  args: { batchId: v.id('batches') },
  returns: v.union(
    v.object({
      hatched_batch_id: v.id('batches'),
      hatched_batch_number: v.string(),
      generations: v.number(),
      spawning: spawningRow,
    }),
    v.null(),
  ),
  handler: async (ctx, { batchId }) => {
    const m = await requireHatchery(ctx, 'hatchery.view')
    // Walk up the parents (bounded) to the nearest hatched ancestor.
    let frontier: Id<'batches'>[] = [ownDoc(m, await ctx.db.get(batchId), 'Batch')._id]
    const seen = new Set<string>()
    for (let depth = 0; depth <= 10 && frontier.length; depth++) {
      const next: Id<'batches'>[] = []
      for (const id of frontier) {
        if (seen.has(String(id))) continue
        seen.add(String(id))
        const b = await ctx.db.get(id)
        if (!b || b.companyId !== m.companyId) continue
        if (b.origin === 'hatchery' && b.spawningEventId) {
          const s = await ctx.db.get(b.spawningEventId)
          if (!s || s.companyId !== m.companyId) continue
          return {
            hatched_batch_id: b._id,
            hatched_batch_number: b.batchNumber,
            generations: depth,
            spawning: await spawningSummary(ctx, s),
          }
        }
        next.push(...(b.parentBatchIds ?? []))
      }
      frontier = next
    }
    return null
  },
})
