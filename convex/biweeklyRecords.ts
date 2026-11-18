import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { query, mutation } from './_generated/server'
import { idempotentMutation } from './lib/idempotency'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser, requireRole } from './lib/authz'
import { syncCageAbw } from './lib/growth'
import { tagBiweekly } from './lib/productionDualWrite'
import { assertOwns, listForCompany, listForCompanyAndLocation, writeCompanyId, logAudit } from './lib/tenancy'
import { scopedPageInRange, scopedRowsInRange } from './lib/scope'
import { userError } from './lib/errors'
import { emitDomainEvent } from './lib/events'

function toClient(r: any) {
  return {
    id: r._id,
    _id: r._id,
    cage_id: r.cageId,
    date: r.date,
    batch_code: r.batchCode,
    average_body_weight: r.averageBodyWeight,
    total_fish_count: r.totalFishCount,
    total_weight: r.totalWeight,
    dissolved_oxygen: r.dissolvedOxygen,
    temperature_c: r.temperatureC,
    secchi_cm: r.secchiCm,
    location_id: r.locationId,
    company_id: r.companyId,
    created_by: r.createdBy,
    updated_by: r.updatedBy,
    updated_at: r.updatedAt,
    created_at: r._creationTime,
  }
}

export const list = query({
  args: {
    cageId: v.optional(v.id('cages')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let rows = args.cageId
      ? await ctx.db
          .query('biweeklyRecords')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await scopedRowsInRange(ctx, user, 'biweeklyRecords', {
          from: args.dateFrom,
          to: args.dateTo,
          locationId: args.locationId,
        })

    rows = await listForCompanyAndLocation(user, rows, args.locationId)
    if (args.dateFrom) rows = rows.filter((r) => r.date >= args.dateFrom!)
    if (args.dateTo) rows = rows.filter((r) => r.date <= args.dateTo!)
    return rows.map(toClient).sort((a, b) => b.date.localeCompare(a.date))
  },
})

/**
 * Paginated growth samples, newest date first (PLAT-001), via
 * `by_company_and_date`. A site filter is applied per page.
 */
export const listPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const result = await scopedPageInRange(ctx, user, 'biweeklyRecords', args.paginationOpts, {
      from: args.dateFrom,
      to: args.dateTo,
    })
    const rows = args.locationId
      ? result.page.filter((r) => r.locationId === args.locationId)
      : result.page
    return { ...result, page: rows.map(toClient) }
  },
})


export const get = query({
  args: { id: v.id('biweeklyRecords') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const record = await ctx.db.get(id)
    if (!record) return null
    const allowed = await listForCompany(user, [record])
    if (!allowed.length) return null
    return toClient(record)
  },
})

/**
 * Whether another of this company's biweekly records already uses the batch
 * code. Codes are unique per company, not globally (doc 07 V15): a global
 * check told one tenant which codes another had used.
 */
async function batchCodeTaken(
  ctx: MutationCtx,
  companyId: Id<'companies'> | undefined,
  batchCode: string,
  exceptId?: Id<'biweeklyRecords'>,
) {
  const rows = await ctx.db
    .query('biweeklyRecords')
    .withIndex('by_company_and_batchCode', (q) =>
      q.eq('companyId', companyId).eq('batchCode', batchCode),
    )
    .take(2)
  return rows.some((r) => r._id !== exceptId)
}

export const create = mutation({
  args: {
    cageId: v.id('cages'),
    date: v.string(),
    batchCode: v.string(),
    averageBodyWeight: v.number(),
    totalFishCount: v.number(),
    totalWeight: v.number(),
    dissolvedOxygen: v.optional(v.number()),
    temperatureC: v.optional(v.number()),
    secchiCm: v.optional(v.number()),
    samples: v.optional(
      v.array(
        v.object({
          samplingNumber: v.number(),
          fishCount: v.number(),
          totalWeight: v.number(),
          averageBodyWeight: v.number(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const cage = await ctx.db.get(args.cageId)
    assertOwns(user, cage, 'Cage')
    const companyId = await writeCompanyId(user)

    if (await batchCodeTaken(ctx, companyId, args.batchCode)) {
      throw new Error('Batch code already exists')
    }

    const now = Date.now()
    const { samples, ...recordData } = args

    const id = await ctx.db.insert('biweeklyRecords', {
      ...recordData,
      locationId: cage.locationId,
      companyId,
      createdBy: user._id,
      updatedAt: now,
    })

    // Create sampling records if provided
    if (samples && samples.length > 0) {
      for (const sample of samples) {
        await ctx.db.insert('biweeklySampling', {
          biweeklyRecordId: id,
          samplingNumber: sample.samplingNumber,
          fishCount: sample.fishCount,
          totalWeight: sample.totalWeight,
          averageBodyWeight: sample.averageBodyWeight,
          createdBy: user._id,
          updatedAt: now,
        })
      }
    }

    await tagBiweekly(ctx, (await ctx.db.get(id))!, user._id)
    // The latest sample becomes the cage's current fish weight.
    await syncCageAbw(ctx, args.cageId)

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'biweeklyRecords',
      recordId: id,
      newValues: args,
    })
    await emitSamplingRecorded(ctx, user, args.date, [id])
    return id
  },
})

/** A batch code unused by this company: BW<yymmdd><4 random digits>. */
async function freshBatchCode(
  ctx: MutationCtx,
  companyId: Id<'companies'> | undefined,
  date: string,
  used: Set<string>,
) {
  const day = date.replace(/-/g, '').slice(2, 8)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `BW${day}${Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0')}`
    if (!used.has(code) && !(await batchCodeTaken(ctx, companyId, code))) return code
  }
  throw userError('CONFLICT', 'Could not create a batch code. Try again.')
}

/**
 * Field sampling for many cages in one save (MOBILE-005). One line per cage:
 * the fish counted and their total weight in grams; ABW is computed here.
 * All lines save or none do. Batch codes are generated when not given.
 */
/** Accepts `clientMutationId` so outbox retries never write twice (MOBILE-002). */
export const createBatch = idempotentMutation('biweeklyRecords.createBatch', {
  args: {
    date: v.string(),
    records: v.array(
      v.object({
        cageId: v.id('cages'),
        totalFishCount: v.number(),
        totalWeight: v.number(),
        batchCode: v.optional(v.string()),
        dissolvedOxygen: v.optional(v.number()),
        temperatureC: v.optional(v.number()),
        secchiCm: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    return await saveSamplingBatch(ctx, user, args)
  },
})

export type SamplingBatchLine = {
  cageId: Id<'cages'>
  totalFishCount: number
  totalWeight: number
  batchCode?: string
  dissolvedOxygen?: number
  temperatureC?: number
  secchiCm?: number
}

/**
 * createBatch's body, shared with the public API (POST /api/v1/sampling).
 * Emits one `sampling.recorded` event.
 */
export async function saveSamplingBatch(
  ctx: MutationCtx,
  user: Doc<'users'>,
  { date, records }: { date: string; records: SamplingBatchLine[] },
): Promise<Id<'biweeklyRecords'>[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw userError('VALIDATION', 'Choose a valid sampling date')
    }
    if (!records.length) throw userError('VALIDATION', 'Add at least one cage line')
    if (records.length > 100) {
      throw userError('VALIDATION', 'A batch can hold at most 100 lines')
    }
    const companyId = await writeCompanyId(user)
    const seen = new Set<Id<'cages'>>()
    const usedCodes = new Set<string>()
    const ids: Id<'biweeklyRecords'>[] = []
    const now = Date.now()

    for (const [i, rec] of records.entries()) {
      const line = `Line ${i + 1}`
      const cage = await ctx.db.get(rec.cageId)
      assertOwns(user, cage, `${line}: cage`)
      if (seen.has(rec.cageId)) {
        throw userError('VALIDATION', `${line} (${cage.name}): cage appears more than once`)
      }
      seen.add(rec.cageId)
      if (!Number.isInteger(rec.totalFishCount) || rec.totalFishCount <= 0) {
        throw userError('VALIDATION', `${line} (${cage.name}): fish counted must be a whole number above 0`)
      }
      if (!(rec.totalWeight > 0)) {
        throw userError('VALIDATION', `${line} (${cage.name}): total weight must be above 0`)
      }
      let batchCode = rec.batchCode?.trim()
      if (batchCode) {
        if (usedCodes.has(batchCode) || (await batchCodeTaken(ctx, companyId, batchCode))) {
          throw userError('DUPLICATE', `${line} (${cage.name}): batch code ${batchCode} already exists`)
        }
      } else {
        batchCode = await freshBatchCode(ctx, companyId, date, usedCodes)
      }
      usedCodes.add(batchCode)
      const averageBodyWeight =
        Math.round((rec.totalWeight / rec.totalFishCount) * 100) / 100

      const id = await ctx.db.insert('biweeklyRecords', {
        cageId: rec.cageId,
        date,
        batchCode,
        averageBodyWeight,
        totalFishCount: rec.totalFishCount,
        totalWeight: rec.totalWeight,
        dissolvedOxygen: rec.dissolvedOxygen,
        temperatureC: rec.temperatureC,
        secchiCm: rec.secchiCm,
        locationId: cage.locationId,
        companyId,
        createdBy: user._id,
        updatedAt: now,
      })
      await ctx.db.insert('biweeklySampling', {
        biweeklyRecordId: id,
        samplingNumber: 1,
        fishCount: rec.totalFishCount,
        totalWeight: rec.totalWeight,
        averageBodyWeight,
        createdBy: user._id,
        updatedAt: now,
      })
      ids.push(id)
    }
    for (const cageId of seen) {
      await syncCageAbw(ctx, cageId)
    }
    await logAudit(ctx, {
      actionType: 'create_batch',
      tableName: 'biweeklyRecords',
      newValues: { date, count: ids.length },
    })
    await emitSamplingRecorded(ctx, user, date, ids)
    return ids
}

/** One `sampling.recorded` event per save operation (doc 07 §4). */
export async function emitSamplingRecorded(
  ctx: MutationCtx,
  user: Doc<'users'>,
  date: string,
  ids: Id<'biweeklyRecords'>[],
) {
  if (!ids.length) return
  const first = await ctx.db.get(ids[0])
  const companyId = first?.companyId ?? user.companyId
  if (!companyId || !first) return
  const cage = await ctx.db.get(first.cageId)
  await emitDomainEvent(ctx, 'sampling.recorded', {
    companyId,
    subject: { table: 'biweeklyRecords', id: String(first._id) },
    locationId: first.locationId,
    actorUserId: user._id,
    businessDate: date,
    data: {
      lines: ids.length,
      // Single-cage saves carry the cage and its ABW for simple consumers.
      cageId: ids.length === 1 ? String(first.cageId) : null,
      cageName: ids.length === 1 ? (cage?.name ?? null) : null,
      averageBodyWeightG: ids.length === 1 ? first.averageBodyWeight : null,
      recordIds: ids.slice(0, 20).join(','),
    },
  })
}

export const createMany = mutation({
  args: {
    records: v.array(
      v.object({
        cageId: v.id('cages'),
        date: v.string(),
        batchCode: v.string(),
        averageBodyWeight: v.number(),
        totalFishCount: v.number(),
        totalWeight: v.number(),
      }),
    ),
  },
  handler: async (ctx, { records }) => {
    const user = await requireUser(ctx)
    // Bulk import bypasses per-record review (doc 07 V9): admin only.
    requireRole(user, 'admin')
    const companyId = await writeCompanyId(user)
    const ids = []
    for (const record of records) {
      const cage = await ctx.db.get(record.cageId)
      assertOwns(user, cage, 'Cage')
      if (await batchCodeTaken(ctx, companyId, record.batchCode)) continue

      const now = Date.now()
      const id = await ctx.db.insert('biweeklyRecords', {
        ...record,
        locationId: cage.locationId,
        companyId,
        createdBy: user._id,
        updatedAt: now,
      })
      await tagBiweekly(ctx, (await ctx.db.get(id))!, user._id)
      ids.push(id)
    }
    for (const cageId of new Set(records.map((r) => r.cageId))) {
      await syncCageAbw(ctx, cageId)
    }
    await logAudit(ctx, {
      actionType: 'create_many',
      tableName: 'biweeklyRecords',
      newValues: { count: ids.length },
    })
    return ids
  },
})

export const update = mutation({
  args: {
    id: v.id('biweeklyRecords'),
    patch: v.object({
      date: v.optional(v.string()),
      batchCode: v.optional(v.string()),
      averageBodyWeight: v.optional(v.number()),
      totalFishCount: v.optional(v.number()),
      totalWeight: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Biweekly record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    // Check batch code uniqueness if being updated
    if (
      patch.batchCode &&
      patch.batchCode !== existing.batchCode &&
      (await batchCodeTaken(ctx, existing.companyId, patch.batchCode, id))
    ) {
      throw new Error('Batch code already exists')
    }

    await ctx.db.patch(id, {
      ...patch,
      updatedBy: user._id,
      updatedAt: Date.now(),
    })
    await syncCageAbw(ctx, existing.cageId)
    await tagBiweekly(ctx, (await ctx.db.get(id))!, user._id)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'biweeklyRecords',
      recordId: id,
      previousValues: existing,
      newValues: patch,
    })
    return id
  },
})

export const remove = mutation({
  args: { id: v.id('biweeklyRecords') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Biweekly record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    // Delete associated sampling records
    const samples = await ctx.db
      .query('biweeklySampling')
      .withIndex('by_record', (q) => q.eq('biweeklyRecordId', id))
      .collect()
    for (const sample of samples) {
      await ctx.db.delete(sample._id)
    }

    await ctx.db.delete(id)
    await syncCageAbw(ctx, existing.cageId)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'biweeklyRecords',
      recordId: id,
      previousValues: existing,
    })
  },
})