import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import { assertOwns, listForCompany, listForCompanyAndLocation, writeCompanyId, logAudit } from './lib/tenancy'
import { applyStockChange, bagsFromKg } from './lib/feedLedger'
import {
  mergeSettings,
  dailyMortalityPct,
  cumulativeMortalityPct,
} from './lib/farmRules'

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
  },
) {
  if (!args.feedTypeId || !(args.feedAmount > 0)) return

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
      : await ctx.db
          .query('dailyRecords')
          .withIndex('by_date', (q) => {
            if (dateFrom && dateTo) return q.gte('date', dateFrom).lte('date', dateTo)
            if (dateFrom) return q.gte('date', dateFrom)
            if (dateTo) return q.lte('date', dateTo)
            return q
          })
          .order('desc')
          .take(limit)

    rows = await listForCompanyAndLocation(user, rows, args.locationId)
    return rows.map(toClient).sort((a, b) => b.date.localeCompare(a.date))
  },
})

/**
 * Lines already logged on one date (for the batch form: mark cages done,
 * and "same as yesterday"). Bounded by the by_date index.
 */
export const listForDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const user = await requireUser(ctx)
    const rows = await ctx.db
      .query('dailyRecords')
      .withIndex('by_date', (q) => q.eq('date', date))
      .take(500)
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
}

/** Insert one daily record: mortality count/alerts, feed ledger deduction, audit. */
async function insertDailyRecord(
  ctx: MutationCtx,
  user: Doc<'users'>,
  args: DailyRecordInput,
): Promise<Id<'dailyRecords'>> {
  const cage = await ctx.db.get(args.cageId)
  assertOwns(user, cage, 'Cage')

  if (args.feedAmount > 0 && !args.feedTypeId) {
    throw new Error('feedTypeId is required when feedAmount > 0')
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

  // Mortality threshold alerts
  if (args.mortality > 0 && user.companyId) {
    const company = await ctx.db.get(user.companyId)
    const rules = mergeSettings(company?.settings)
    const dailyPct = dailyMortalityPct(args.mortality, cage.currentCount)
    const nextCount =
      cage.currentCount != null
        ? Math.max(0, cage.currentCount - args.mortality)
        : cage.currentCount
    const cumPct = cumulativeMortalityPct(cage.initialCount, nextCount)
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
        await ctx.db.query('users').collect()
      ).filter(
        (u) =>
          u.companyId === user.companyId &&
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

  await deductDailyFeed(ctx, user, {
    dailyRecordId: id,
    feedTypeId: args.feedTypeId,
    cageId: args.cageId,
    feedAmount: args.feedAmount,
    date: args.date,
    allowNegative: args.allowNegative,
    overrideReason: args.overrideReason,
  })

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
export const createBatch = mutation({
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
  },
  handler: async (ctx, { date, records, allowNegative, overrideReason }) => {
    const user = await requireUser(ctx)
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
        })
        ids.push(id)
      } catch (err: any) {
        throw new Error(`${line} (${cage.name}): ${err?.message || err}`)
      }
    }
    return ids
  },
})

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
  },
  handler: async (ctx, { id, patch: rawPatch, allowNegative, overrideReason }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Daily record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    const patch = { ...rawPatch }
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

    // A corrected death count moves the cage's live fish count by the difference.
    if (patch.mortality !== undefined && patch.mortality !== existing.mortality) {
      const cage = await ctx.db.get(existing.cageId)
      if (cage && cage.currentCount != null) {
        const diff = patch.mortality - (existing.mortality || 0)
        await ctx.db.patch(existing.cageId, {
          currentCount: Math.max(0, cage.currentCount - diff),
          updatedAt: Date.now(),
        })
      }
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
      })
    }

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
    // Give back the fish this record had counted as dead.
    if (existing.mortality > 0) {
      const cage = await ctx.db.get(existing.cageId)
      if (cage && cage.currentCount != null) {
        await ctx.db.patch(existing.cageId, {
          currentCount: cage.currentCount + existing.mortality,
          updatedAt: Date.now(),
        })
      }
    }
    await ctx.db.delete(id)
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
  },
  handler: async (ctx, { records, allowNegative, overrideReason }) => {
    const user = await requireUser(ctx)
    const ids = []
    for (const record of records) {
      if (record.feedAmount > 0 && !record.feedTypeId) {
        throw new Error(
          `feedTypeId is required when feedAmount > 0 (${record.date})`,
        )
      }
      const cage = await ctx.db.get(record.cageId)
      assertOwns(user, cage, 'Cage')
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

      await deductDailyFeed(ctx, user, {
        dailyRecordId: id,
        feedTypeId: record.feedTypeId,
        cageId: record.cageId,
        feedAmount: record.feedAmount,
        date: record.date,
        allowNegative,
        overrideReason,
      })
      ids.push(id)
    }
    return ids
  },
})
