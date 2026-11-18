import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { query, mutation } from './_generated/server'
import { idempotentMutation } from './lib/idempotency'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import { assertOwns, listForCompany, listForCompanyAndLocation, writeCompanyId, logAudit } from './lib/tenancy'
import { applyStockChange, bagsFromKg, assertFeedNotAlreadyRecorded } from './lib/feedLedger'
import { inCurrentCycle } from './lib/cycles'
import { emitDomainEvent } from './lib/events'
import { mirrorRecordReading } from './waterQuality'
import { isBusinessDate, todayFor } from './lib/dates'
import { shadowDailyRecord, shadowReverse } from './lib/productionDualWrite'
import { scopedRowsInRange, tenantScope } from './lib/scope'
import {
  mergeSettings,
  dailyMortalityPct,
  cumulativeMortalityPct,
} from './lib/farmRules'
import { refreshUnitDays } from './lib/rollups'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Whether the company's "High mortality" automation rule replaces the inline alert. */
async function mortalityRuleEnabled(ctx: MutationCtx, companyId: Id<'companies'>) {
  const rules = await ctx.db
    .query('automationRules')
    .withIndex('by_company_and_templateKey', (q) =>
      q.eq('companyId', companyId).eq('templateKey', 'high_mortality'),
    )
    .take(10)
  return rules.some((r) => r.enabled)
}

function toClient(r: any) {
  return {
    id: r._id,
    _id: r._id,
    cage_id: r.cageId,
    date: r.date,
    feed_amount: r.feedAmount,
    feed_type_id: r.feedTypeId,
    feed_type: r.feedType,
    feed_price: r.feedPrice,
    feed_cost: r.feedCost,
    mortality: r.mortality,
    mortality_cause: r.mortalityCause,
    notes: r.notes,
    dissolved_oxygen: r.dissolvedOxygen,
    temperature_c: r.temperatureC,
    secchi_cm: r.secchiCm,
    location_id: r.locationId,
    created_by: r.createdBy,
    created_at: r._creationTime,
  }
}

async function deductDailyFeed(
  ctx: any,
  user: any,
  args: {
    dailyRecordId: string
    feedTypeId: any
    cageId: any
    feedAmount: number
    date: string
    allowNegative?: boolean
    overrideReason?: string
    /** Admin reason to record feed already issued to this cage on this date. */
    feedOverlapReason?: string
    /** The record already held feed for this cage and date (an edit). */
    skipOverlapCheck?: boolean
  },
) {
  if (!args.feedTypeId || !(args.feedAmount > 0)) return

  if (!args.skipOverlapCheck) {
    await assertFeedNotAlreadyRecorded(ctx, {
      user,
      cageId: args.cageId,
      date: args.date,
      writing: 'daily',
      overrideReason: args.feedOverlapReason,
    })
  }

  const feedType = await ctx.db.get(args.feedTypeId)
  if (!feedType) throw new Error('Feed type not found')

  const cage = await ctx.db.get(args.cageId)
  const bags = bagsFromKg(args.feedAmount, feedType.bagSizeKg)
  const usageId = await ctx.db.insert('feedUsage', {
    feedTypeId: args.feedTypeId,
    cageId: args.cageId,
    quantity: args.feedAmount,
    bags,
    usageDate: args.date,
    source: 'daily',
    notes: `Daily record ${args.date}`,
    locationId: cage?.locationId,
    companyId: feedType.companyId ?? user.companyId,
    updatedAt: Date.now(),
  })

  await applyStockChange(ctx, {
    user,
    feedTypeId: args.feedTypeId,
    deltaKg: -args.feedAmount,
    bags,
    transactionType: 'daily_usage',
    referenceId: String(args.dailyRecordId),
    notes: `Daily feed ${args.date} (usage ${usageId})`,
    allowNegative: args.allowNegative,
    overrideReason: args.overrideReason,
    locationId: cage?.locationId,
  })
}

/**
 * Undo whatever stock this daily record still holds. Works out the net
 * movement per feed type from the ledger (usage is negative, reversals
 * positive), so it stays correct after any number of edits.
 */
async function reverseDailyFeed(ctx: any, user: any, dailyRecord: any) {
  const ref = String(dailyRecord._id)
  const prior = await ctx.db
    .query('feedInventoryTransactions')
    .withIndex('by_reference', (q: any) => q.eq('referenceId', ref))
    .collect()

  // The usage rows that drive feed reports: one per cage per day from daily entry.
  const usage = await ctx.db
    .query('feedUsage')
    .withIndex('by_cage', (q: any) => q.eq('cageId', dailyRecord.cageId))
    .collect()
  for (const u of usage) {
    if (u.source === 'daily' && u.usageDate === dailyRecord.date) {
      await ctx.db.delete(u._id)
    }
  }

  if (!prior.length) {
    // Legacy record written before the ledger: restore by amount.
    if (dailyRecord.feedTypeId && dailyRecord.feedAmount > 0) {
      await applyStockChange(ctx, {
        user,
        feedTypeId: dailyRecord.feedTypeId,
        deltaKg: dailyRecord.feedAmount,
        transactionType: 'reversal',
        referenceId: ref,
        notes: 'Reversal of daily feed (legacy)',
        locationId: dailyRecord.locationId,
      })
    }
    return
  }

  const net = new Map<string, { feedTypeId: any; kg: number; bags: number }>()
  for (const t of prior) {
    const k = String(t.feedTypeId)
    const cur = net.get(k) ?? { feedTypeId: t.feedTypeId, kg: 0, bags: 0 }
    cur.kg += Number(t.quantityKg) || 0
    cur.bags += (Number(t.bags) || 0) * Math.sign(Number(t.quantityKg) || 0)
    net.set(k, cur)
  }
  for (const { feedTypeId, kg, bags } of net.values()) {
    const outstanding = Math.round(kg * 1000) / 1000
    if (outstanding >= 0) continue
    await applyStockChange(ctx, {
      user,
      feedTypeId,
      deltaKg: -outstanding,
      bags: Math.abs(bags) || undefined,
      transactionType: 'reversal',
      referenceId: ref,
      notes: `Reversal of daily feed ${dailyRecord.date}`,
      locationId: dailyRecord.locationId,
    })
  }
}

export const list = query({
  args: {
    cageId: v.optional(v.id('cages')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const limit = Math.min(Math.max(args.limit ?? 5000, 1), 5000)
    const { dateFrom, dateTo } = args
    // The company's own window (by_company_and_date): another tenant's rows
    // can no longer push this company's records out of the `limit`.
    let rows = args.cageId
      ? await ctx.db
          .query('dailyRecords')
          .withIndex('by_cage_date', (q) => {
            const c = q.eq('cageId', args.cageId!)
            if (dateFrom && dateTo) return c.gte('date', dateFrom).lte('date', dateTo)
            if (dateFrom) return c.gte('date', dateFrom)
            if (dateTo) return c.lte('date', dateTo)
            return c
          })
          .order('desc')
          .take(limit)
      : await scopedRowsInRange(ctx, user, 'dailyRecords', {
          from: dateFrom,
          to: dateTo,
          locationId: args.locationId,
          limit,
        })

    rows = await listForCompanyAndLocation(user, rows, args.locationId)
    return rows.map(toClient).sort((a, b) => b.date.localeCompare(a.date))
  },
})

/**
 * Paginated daily records, newest date first (PLAT-001). Same filters as
 * `list`; use with `usePaginatedQuery`. `cageId` reads `by_cage_date`,
 * otherwise `by_company_and_date` (or `by_company_location` for one site).
 */
export const listPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    cageId: v.optional(v.id('cages')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const { dateFrom, dateTo } = args
    const scope = tenantScope(user)
    const empty = { page: [], isDone: true, continueCursor: '' }
    if (scope.kind === 'none') return empty

    let result
    if (args.cageId) {
      const cage = await ctx.db.get(args.cageId)
      if (!cage || !(await listForCompany(user, [cage])).length) return empty
      result = await ctx.db
        .query('dailyRecords')
        .withIndex('by_cage_date', (q) => {
          const c = q.eq('cageId', args.cageId!)
          if (dateFrom && dateTo) return c.gte('date', dateFrom).lte('date', dateTo)
          if (dateFrom) return c.gte('date', dateFrom)
          if (dateTo) return c.lte('date', dateTo)
          return c
        })
        .order('desc')
        .paginate(args.paginationOpts)
    } else if (scope.kind === 'company') {
      result = await ctx.db
        .query('dailyRecords')
        .withIndex('by_company_and_date', (q) => {
          const c = q.eq('companyId', scope.companyId)
          if (dateFrom && dateTo) return c.gte('date', dateFrom).lte('date', dateTo)
          if (dateFrom) return c.gte('date', dateFrom)
          if (dateTo) return c.lte('date', dateTo)
          return c
        })
        .order('desc')
        .paginate(args.paginationOpts)
    } else {
      // Company-less super_admin: platform view through by_date.
      result = await ctx.db
        .query('dailyRecords')
        .withIndex('by_date', (q) => {
          if (dateFrom && dateTo) return q.gte('date', dateFrom).lte('date', dateTo)
          if (dateFrom) return q.gte('date', dateFrom)
          if (dateTo) return q.lte('date', dateTo)
          return q
        })
        .order('desc')
        .paginate(args.paginationOpts)
    }
    // A site filter on a page keeps the cursor of the company read; pages can
    // come back short, which load-more handles.
    const rows = args.locationId
      ? result.page.filter((r) => r.locationId === args.locationId)
      : result.page
    return { ...result, page: rows.map(toClient) }
  },
})

/**
 * Lines already logged on one date (for the batch form: mark cages done,
 * and "same as yesterday"). Reads only the company's rows for that date
 * (by_company_and_date), so no other tenant's volume can hide a done cage.
 */
export const listForDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const user = await requireUser(ctx)
    const rows = await scopedRowsInRange(ctx, user, 'dailyRecords', {
      from: date,
      to: date,
    })
    const mine = await listForCompany(user, rows)
    return mine.map((r) => ({
      cage_id: r.cageId,
      feed_type_id: r.feedTypeId ?? null,
      feed_amount: r.feedAmount,
      mortality: r.mortality,
    }))
  },
})

export const get = query({
  args: { id: v.id('dailyRecords') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const record = await ctx.db.get(id)
    if (!record) return null
    const allowed = await listForCompany(user, [record])
    if (!allowed.length) return null
    return toClient(record)
  },
})

type DailyRecordInput = {
  cageId: Id<'cages'>
  date: string
  feedAmount: number
  feedTypeId?: Id<'feedTypes'>
  feedType?: string
  feedPrice: number
  feedCost: number
  mortality: number
  mortalityCause?: string
  notes?: string
  dissolvedOxygen?: number
  temperatureC?: number
  secchiCm?: number
  allowNegative?: boolean
  overrideReason?: string
  feedOverlapReason?: string
}

/** Insert one daily record: mortality count/alerts, feed ledger deduction, audit. */
export async function insertDailyRecord(
  ctx: MutationCtx,
  user: Doc<'users'>,
  args: DailyRecordInput,
): Promise<Id<'dailyRecords'>> {
  const cage = await ctx.db.get(args.cageId)
  assertOwns(user, cage, 'Cage')

  if (args.feedAmount > 0 && !args.feedTypeId) {
    throw new Error('feedTypeId is required when feedAmount > 0')
  }
  if (args.feedTypeId) {
    assertOwns(user, await ctx.db.get(args.feedTypeId), 'Feed type')
  }

  // The date is the site's local calendar day (FARM-001, D-012): a real date,
  // not after today in the site's time zone.
  if (!isBusinessDate(args.date)) throw new Error('Date must be a real date (YYYY-MM-DD)')
  const today = await todayFor(ctx, { locationId: cage.locationId, companyId: cage.companyId })
  if (args.date > today) {
    throw new Error(`Date ${args.date} is in the future for this site (today is ${today})`)
  }

  const existing = await ctx.db
    .query('dailyRecords')
    .withIndex('by_cage_date', (q) =>
      q.eq('cageId', args.cageId).eq('date', args.date),
    )
    .first()
  if (existing) throw new Error('Daily record already exists for this cage and date')

  const {
    allowNegative,
    overrideReason,
    feedOverlapReason,
    dissolvedOxygen,
    temperatureC,
    secchiCm,
    mortalityCause,
    ...recordFields
  } = args

  const id = await ctx.db.insert('dailyRecords', {
    ...recordFields,
    mortalityCause:
      args.mortality > 0
        ? mortalityCause?.trim() || 'unknown'
        : mortalityCause?.trim() || undefined,
    dissolvedOxygen,
    temperatureC,
    secchiCm,
    locationId: cage.locationId,
    companyId: (await writeCompanyId(user)) ?? cage.companyId,
    createdBy: user._id,
  })

  if (args.mortality && cage.currentCount != null) {
    await ctx.db.patch(args.cageId, {
      currentCount: Math.max(0, cage.currentCount - args.mortality),
      updatedAt: Date.now(),
    })
  }
  await shadowDailyRecord(ctx, (await ctx.db.get(id))!, user._id, false)
  // Water values also go to the water-quality log (Phase 6 dual-write).
  await mirrorRecordReading(ctx, 'daily_record', id, await ctx.db.get(id))

  const dailyPct = dailyMortalityPct(args.mortality, cage.currentCount)
  const nextCount =
    cage.currentCount != null
      ? Math.max(0, cage.currentCount - args.mortality)
      : cage.currentCount
  const cumPct = cumulativeMortalityPct(cage.initialCount, nextCount)

  // Mortality threshold alerts. A company that enabled the "High mortality"
  // automation rule gets them from the engine instead (AUTO-002).
  if (
    args.mortality > 0 &&
    user.companyId &&
    !(await mortalityRuleEnabled(ctx, user.companyId))
  ) {
    const company = await ctx.db.get(user.companyId)
    const rules = mergeSettings(company?.settings)
    const alerts: string[] = []
    if (dailyPct >= rules.farmRules.dailyMortalityAlertPct) {
      alerts.push(
        `Daily mortality ${dailyPct.toFixed(2)}% on cage ${cage.name} (threshold ${rules.farmRules.dailyMortalityAlertPct}%)`,
      )
    }
    if (cumPct >= rules.farmRules.cumulativeMortalityAlertPct) {
      alerts.push(
        `Cumulative mortality ${cumPct.toFixed(1)}% on cage ${cage.name} (threshold ${rules.farmRules.cumulativeMortalityAlertPct}%)`,
      )
    }
    if (alerts.length) {
      const admins = (
        await ctx.db
          .query('users')
          .withIndex('by_companyId', (q) => q.eq('companyId', user.companyId))
          .collect()
      ).filter(
        (u) =>
          (u.role === 'admin' || u.role === 'super_admin') &&
          u.active !== false,
      )

      for (const admin of admins) {
        await ctx.db.insert('notifications', {
          userId: admin._id,
          title: 'Mortality alert',
          message: alerts.join(' · '),
          type: 'warning',
          read: false,
          link: '/daily-entry',
          companyId: user.companyId,
        })
      }
    }
  }

  await emitDomainEvent(
    ctx,
    'daily.recorded',
    {
      dailyRecordId: id,
      cageId: args.cageId,
      cageName: cage.name,
      date: args.date,
      mortality: args.mortality,
      mortalityCause: args.mortality > 0 ? mortalityCause?.trim() || 'unknown' : undefined,
      dailyMortalityPct: round2(dailyPct),
      cumulativeMortalityPct: round2(cumPct),
      feedAmount: args.feedAmount,
      dissolvedOxygen,
      temperatureC,
      secchiCm,
    },
    { companyId: user.companyId ?? cage.companyId, locationId: cage.locationId },
  )

  await deductDailyFeed(ctx, user, {
    dailyRecordId: id,
    feedTypeId: args.feedTypeId,
    cageId: args.cageId,
    feedAmount: args.feedAmount,
    date: args.date,
    allowNegative,
    overrideReason,
    feedOverlapReason,
  })

  await refreshUnitDays(ctx, [{ unitId: args.cageId, date: args.date }])
  await logAudit(ctx, {
    actionType: 'create',
    tableName: 'daily_records',
    recordId: id,
    newValues: args,
  })
  return id
}

export const create = mutation({
  args: {
    cageId: v.id('cages'),
    date: v.string(),
    feedAmount: v.number(),
    feedTypeId: v.optional(v.id('feedTypes')),
    feedType: v.optional(v.string()),
    feedPrice: v.number(),
    feedCost: v.number(),
    mortality: v.number(),
    mortalityCause: v.optional(v.string()),
    notes: v.optional(v.string()),
    dissolvedOxygen: v.optional(v.number()),
    temperatureC: v.optional(v.number()),
    secchiCm: v.optional(v.number()),
    allowNegative: v.optional(v.boolean()),
    overrideReason: v.optional(v.string()),
    /** Admin only: save feed already issued to this cage on this date. */
    feedOverlapReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    return await insertDailyRecord(ctx, user, args)
  },
})

/**
 * Save several cages' daily records for one date in a single transaction.
 * Any failure (duplicate, insufficient stock, missing cage) rolls back every line.
 */
/** Accepts `clientMutationId` so outbox retries never write twice (MOBILE-002). */
export const createBatch = idempotentMutation('dailyRecords.createBatch', {
  args: {
    date: v.string(),
    records: v.array(
      v.object({
        cageId: v.id('cages'),
        feedAmount: v.number(),
        feedTypeId: v.optional(v.id('feedTypes')),
        mortality: v.number(),
        mortalityCause: v.optional(v.string()),
        notes: v.optional(v.string()),
        dissolvedOxygen: v.optional(v.number()),
        temperatureC: v.optional(v.number()),
      }),
    ),
    allowNegative: v.optional(v.boolean()),
    overrideReason: v.optional(v.string()),
    /** Admin only: save feed already issued to this cage on this date. */
    feedOverlapReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    return await saveDailyBatch(ctx, user, args)
  },
})

export type DailyBatchLine = {
  cageId: Id<'cages'>
  feedAmount: number
  feedTypeId?: Id<'feedTypes'>
  mortality: number
  mortalityCause?: string
  notes?: string
  dissolvedOxygen?: number
  temperatureC?: number
}

/**
 * createBatch's body, shared with the public API (POST /api/v1/daily-records).
 * Prices come from the feed type; each line emits `daily.recorded`.
 */
export async function saveDailyBatch(
  ctx: MutationCtx,
  user: Doc<'users'>,
  {
    date,
    records,
    allowNegative,
    overrideReason,
    feedOverlapReason,
  }: {
    date: string
    records: DailyBatchLine[]
    allowNegative?: boolean
    overrideReason?: string
    feedOverlapReason?: string
  },
): Promise<Id<'dailyRecords'>[]> {
    if (!records.length) throw new Error('Add at least one cage line')
    if (records.length > 100) throw new Error('A batch can hold at most 100 lines')

    const seen = new Set<string>()
    const ids: Id<'dailyRecords'>[] = []
    for (const [i, rec] of records.entries()) {
      const line = `Line ${i + 1}`
      const cage = await ctx.db.get(rec.cageId)
      if (!cage) throw new Error(`${line}: cage not found`)
      const allowed = await listForCompany(user, [cage])
      if (!allowed.length) throw new Error(`${line}: access denied for cage ${cage.name}`)
      if (seen.has(rec.cageId)) {
        throw new Error(`${line}: cage ${cage.name} appears more than once`)
      }
      seen.add(rec.cageId)
      if (!(rec.feedAmount >= 0) || !(rec.mortality >= 0)) {
        throw new Error(`${line} (${cage.name}): feed and mortality cannot be negative`)
      }
      if (rec.feedAmount > 0 && !rec.feedTypeId) {
        throw new Error(`${line} (${cage.name}): choose a feed type`)
      }

      let feedPrice = 0
      let feedTypeName: string | undefined
      if (rec.feedTypeId) {
        const feedType = await ctx.db.get(rec.feedTypeId)
        if (!feedType || feedType.deletedAt) {
          throw new Error(`${line} (${cage.name}): feed type not found`)
        }
        try {
          assertOwns(user, feedType, 'Feed type')
        } catch {
          throw new Error(`${line} (${cage.name}): feed type not found`)
        }
        feedPrice = feedType.pricePerKg ?? 0
        feedTypeName = feedType.name
      }

      try {
        const id = await insertDailyRecord(ctx, user, {
          cageId: rec.cageId,
          date,
          feedAmount: rec.feedAmount,
          feedTypeId: rec.feedTypeId,
          feedType: feedTypeName,
          feedPrice,
          feedCost: rec.feedAmount * feedPrice,
          mortality: rec.mortality,
          mortalityCause: rec.mortalityCause,
          notes: rec.notes?.trim() || undefined,
          dissolvedOxygen: rec.dissolvedOxygen,
          temperatureC: rec.temperatureC,
          allowNegative,
          overrideReason,
          feedOverlapReason,
        })
        ids.push(id)
      } catch (err: any) {
        throw new Error(`${line} (${cage.name}): ${err?.message || err}`)
      }
    }
    return ids
}

export const update = mutation({
  args: {
    id: v.id('dailyRecords'),
    patch: v.object({
      date: v.optional(v.string()),
      feedAmount: v.optional(v.number()),
      feedTypeId: v.optional(v.id('feedTypes')),
      feedType: v.optional(v.string()),
      feedPrice: v.optional(v.number()),
      feedCost: v.optional(v.number()),
      mortality: v.optional(v.number()),
      mortalityCause: v.optional(v.string()),
      notes: v.optional(v.string()),
      dissolvedOxygen: v.optional(v.number()),
      temperatureC: v.optional(v.number()),
      secchiCm: v.optional(v.number()),
    }),
    allowNegative: v.optional(v.boolean()),
    overrideReason: v.optional(v.string()),
    /** Admin only: save feed already issued to this cage on this date. */
    feedOverlapReason: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { id, patch: rawPatch, allowNegative, overrideReason, feedOverlapReason },
  ) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Daily record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    const patch = { ...rawPatch }
    if (patch.feedTypeId !== undefined) {
      assertOwns(user, await ctx.db.get(patch.feedTypeId), 'Feed type')
    }
    if (patch.mortality !== undefined && !(patch.mortality >= 0 && Number.isInteger(patch.mortality))) {
      throw new Error('Mortality must be a whole number, 0 or more')
    }
    if (patch.feedAmount !== undefined && !(patch.feedAmount >= 0)) {
      throw new Error('Feed cannot be negative')
    }
    if (patch.date !== undefined && patch.date !== existing.date) {
      const clash = await ctx.db
        .query('dailyRecords')
        .withIndex('by_cage_date', (q) =>
          q.eq('cageId', existing.cageId).eq('date', patch.date!),
        )
        .first()
      if (clash) throw new Error(`This cage already has a record for ${patch.date}`)
    }

    const feedTouched =
      patch.feedAmount !== undefined ||
      patch.feedTypeId !== undefined ||
      patch.date !== undefined

    // Keep price and cost consistent with the feed actually recorded.
    if (patch.feedAmount !== undefined || patch.feedTypeId !== undefined) {
      const feedTypeId = patch.feedTypeId ?? existing.feedTypeId
      const feedType = feedTypeId ? await ctx.db.get(feedTypeId) : null
      const price = feedType?.pricePerKg ?? existing.feedPrice ?? 0
      const amount = patch.feedAmount ?? existing.feedAmount
      patch.feedPrice = price
      patch.feedCost = amount * price
      if (feedType) patch.feedType = feedType.name
    }

    if (feedTouched) {
      await reverseDailyFeed(ctx, user, existing)
    }

    await ctx.db.patch(id, patch)
    await mirrorRecordReading(ctx, 'daily_record', id, await ctx.db.get(id))

    // Deaths only move the live fish count for records in the cage's current
    // cycle; a record from an earlier cycle is corrected on its own.
    const mortalityTouched =
      (patch.mortality !== undefined && patch.mortality !== existing.mortality) ||
      (patch.date !== undefined && patch.date !== existing.date)
    if (mortalityTouched) {
      const cage = await ctx.db.get(existing.cageId)
      if (cage && cage.currentCount != null) {
        const oldIn = await inCurrentCycle(ctx, cage, existing.date)
        const newIn = await inCurrentCycle(ctx, cage, patch.date ?? existing.date)
        const delta =
          (newIn ? (patch.mortality ?? existing.mortality ?? 0) : 0) -
          (oldIn ? existing.mortality || 0 : 0)
        if (delta !== 0) {
          await ctx.db.patch(existing.cageId, {
            currentCount: Math.max(0, cage.currentCount - delta),
            updatedAt: Date.now(),
          })
        }
      }
      await shadowDailyRecord(ctx, (await ctx.db.get(id))!, user._id, true)
    }

    if (feedTouched) {
      const updated = await ctx.db.get(id)
      if (!updated) throw new Error('Daily record missing after update')
      if (updated.feedAmount > 0 && !updated.feedTypeId) {
        throw new Error('feedTypeId is required when feedAmount > 0')
      }
      await deductDailyFeed(ctx, user, {
        dailyRecordId: id,
        feedTypeId: updated.feedTypeId,
        cageId: updated.cageId,
        feedAmount: updated.feedAmount,
        date: updated.date,
        allowNegative,
        overrideReason,
        feedOverlapReason,
        // Re-posting feed this record already held for the same cage and day
        // is not a second recording.
        skipOverlapCheck: existing.feedAmount > 0 && updated.date === existing.date,
      })
    }

    await refreshUnitDays(ctx, [
      { unitId: existing.cageId, date: existing.date },
      { unitId: existing.cageId, date: patch.date ?? existing.date },
    ])
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'daily_records',
      recordId: id,
      previousValues: existing,
      newValues: patch,
    })
    return id
  },
})

export const remove = mutation({
  args: { id: v.id('dailyRecords') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Daily record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    await reverseDailyFeed(ctx, user, existing)
    // Give back the fish this record had counted as dead (current cycle only).
    if (existing.mortality > 0) {
      const cage = await ctx.db.get(existing.cageId)
      if (cage && cage.currentCount != null && (await inCurrentCycle(ctx, cage, existing.date))) {
        await ctx.db.patch(existing.cageId, {
          currentCount: cage.currentCount + existing.mortality,
          updatedAt: Date.now(),
        })
      }
    }
    await shadowReverse(
      ctx,
      await ctx.db.get(existing.cageId),
      { sourceTable: 'dailyRecords', sourceId: id },
      'Daily record deleted',
      user._id,
    )
    await ctx.db.delete(id)
    await mirrorRecordReading(ctx, 'daily_record', id, null)
    await refreshUnitDays(ctx, [{ unitId: existing.cageId, date: existing.date }])
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'daily_records',
      recordId: id,
      previousValues: existing,
    })
  },
})

export const createMany = mutation({
  args: {
    records: v.array(
      v.object({
        cageId: v.id('cages'),
        date: v.string(),
        feedAmount: v.number(),
        feedTypeId: v.optional(v.id('feedTypes')),
        feedType: v.optional(v.string()),
        feedPrice: v.number(),
        feedCost: v.number(),
        mortality: v.number(),
        notes: v.optional(v.string()),
      }),
    ),
    allowNegative: v.optional(v.boolean()),
    overrideReason: v.optional(v.string()),
    /** Admin only: save feed already issued to this cage on this date. */
    feedOverlapReason: v.optional(v.string()),
  },
  handler: async (ctx, { records, allowNegative, overrideReason, feedOverlapReason }) => {
    const user = await requireUser(ctx)
    // Bulk import takes caller-supplied price and cost (doc 07 V9): admin only.
    requireRole(user, 'admin')
    const ids = []
    for (const record of records) {
      if (record.feedAmount > 0 && !record.feedTypeId) {
        throw new Error(
          `feedTypeId is required when feedAmount > 0 (${record.date})`,
        )
      }
      const cage = await ctx.db.get(record.cageId)
      assertOwns(user, cage, 'Cage')
      if (record.feedTypeId) {
        assertOwns(user, await ctx.db.get(record.feedTypeId), 'Feed type')
      }
      const existing = await ctx.db
        .query('dailyRecords')
        .withIndex('by_cage_date', (q) =>
          q.eq('cageId', record.cageId).eq('date', record.date),
        )
        .first()
      if (existing) continue

      const id = await ctx.db.insert('dailyRecords', {
        ...record,
        locationId: cage.locationId,
        companyId: (await writeCompanyId(user)) ?? cage.companyId,
        createdBy: user._id,
      })

      if (record.mortality && cage.currentCount != null) {
        await ctx.db.patch(record.cageId, {
          currentCount: Math.max(0, cage.currentCount - record.mortality),
          updatedAt: Date.now(),
        })
      }
      await shadowDailyRecord(ctx, (await ctx.db.get(id))!, user._id, false)
      await mirrorRecordReading(ctx, 'daily_record', id, await ctx.db.get(id))

      await deductDailyFeed(ctx, user, {
        dailyRecordId: id,
        feedTypeId: record.feedTypeId,
        cageId: record.cageId,
        feedAmount: record.feedAmount,
        date: record.date,
        allowNegative,
        overrideReason,
        feedOverlapReason,
      })
      await refreshUnitDays(ctx, [{ unitId: record.cageId, date: record.date }])
      ids.push(id)
    }
    if (ids.length > 0) {
      await logAudit(ctx, {
        actionType: 'bulk_create',
        tableName: 'dailyRecords',
        newValues: { count: ids.length, skipped: records.length - ids.length, ids },
      })
    }
    return ids
  },
})
