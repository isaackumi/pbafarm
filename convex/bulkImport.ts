/**
 * Bulk import (Paper 53): the check behind the "Check rows" table and the
 * import itself. Both run the same rules (lib/bulkImport) against the
 * site's real cages, feed stock, cage history and records already on file;
 * the import inserts only rows that pass (OK and warnings) through the
 * existing bulk inserts, so their permission checks, idempotency and audit
 * still apply.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireMember, requirePermission, type MemberContext } from './lib/permissions'
import { scopedRows } from './lib/scope'
import { userError } from './lib/errors'
import { isBusinessDate, todayFor } from './lib/dates'
import { mergeSettings, stockingProblem, unitTypeOf } from './lib/farmRules'
import { effectiveThresholds } from './lib/waterQuality'
import { overridesFor } from './waterQuality'
import { cageBin } from './lib/feedLedger'
import { insertDailyMany } from './dailyRecords'
import { insertBiweeklyMany } from './biweeklyRecords'
import { createStockingAs } from './stocking'
import { logAudit } from './lib/tenancy'
import {
  IMPORT_CHUNK,
  MAX_IMPORT_ROWS,
  MORTALITY_LOOKBACK_DAYS,
  addDaysIso,
  checkBiweeklyRows,
  checkDailyRows,
  checkStockingRows,
  rowSpan,
  type CageLite,
  type ImportKind,
  type ImportRowInput,
  type RowResult,
} from './lib/bulkImport'

const kindValidator = v.union(v.literal('daily'), v.literal('biweekly'), v.literal('stocking'))

const rowInput = v.object({
  line: v.number(),
  date: v.optional(v.string()),
  cage: v.optional(v.string()),
  feed: v.optional(v.string()),
  feedType: v.optional(v.string()),
  feedPrice: v.optional(v.string()),
  mortality: v.optional(v.string()),
  doMgl: v.optional(v.string()),
  tempC: v.optional(v.string()),
  notes: v.optional(v.string()),
  batch: v.optional(v.string()),
  abw: v.optional(v.string()),
  fishCount: v.optional(v.string()),
  totalWeight: v.optional(v.string()),
  biomass: v.optional(v.string()),
  source: v.optional(v.string()),
  species: v.optional(v.string()),
})

const rowResult = v.object({
  line: v.number(),
  status: v.union(v.literal('ok'), v.literal('warning'), v.literal('error')),
  field: v.optional(v.string()),
  reason: v.optional(
    v.object({
      code: v.string(),
      params: v.optional(v.record(v.string(), v.union(v.string(), v.number()))),
    }),
  ),
  cageId: v.optional(v.id('cages')),
})

type Ctx = QueryCtx | MutationCtx

/** The member's import access: production.import, the site in scope, and stocking requests for stocking rows. */
async function importMember(ctx: Ctx, kind: ImportKind, locationId: Id<'farmLocations'> | undefined) {
  const m = await requireMember(ctx, { permission: 'production.import', locationId })
  if (kind === 'stocking') requirePermission(m, 'production.stocking.request')
  return m
}

function assertRowCount(rows: unknown[]) {
  if (rows.length > MAX_IMPORT_ROWS) {
    throw userError('VALIDATION', `An import holds at most ${MAX_IMPORT_ROWS} rows`, {
      reason: 'TOO_MANY_ROWS',
    })
  }
}

/** Runs the kind's rules over the rows against the database. */
async function evaluate(
  ctx: Ctx,
  m: MemberContext,
  args: { kind: ImportKind; locationId?: Id<'farmLocations'>; today: string; rows: ImportRowInput[] },
): Promise<RowResult<any>[]> {
  const { user } = m
  if (!isBusinessDate(args.today)) throw userError('VALIDATION', 'today must be YYYY-MM-DD')
  const site = args.locationId ? await ctx.db.get(args.locationId) : null
  const cageDocs = (await scopedRows(ctx, user, 'cages', { locationId: args.locationId })).filter(
    (c) => !c.archivedAt,
  )
  const cageById = new Map(cageDocs.map((c) => [String(c._id), c]))
  const cages: CageLite[] = cageDocs.map((c) => ({ id: String(c._id), name: c.name, status: c.status }))
  const base = { cages, today: args.today, siteName: site?.name ?? null }
  const span = rowSpan(args.rows, cages)
  const company = user.companyId ? await ctx.db.get(user.companyId) : null
  const settings = mergeSettings(company?.settings)

  if (args.kind === 'daily') {
    const feedDocs = (await scopedRows(ctx, user, 'feedTypes')).filter((f) => !f.deletedAt)
    const history = new Map<string, { date: string; mortality: number }[]>()
    if (span.from && span.to) {
      const from = addDaysIso(span.from, -MORTALITY_LOOKBACK_DAYS)
      for (const cageId of span.cageIds) {
        const rows = await ctx.db
          .query('dailyRecords')
          .withIndex('by_cage_date', (q) =>
            q.eq('cageId', cageId as Id<'cages'>).gte('date', from).lte('date', span.to!),
          )
          .take(2000)
        history.set(
          cageId,
          rows.map((r) => ({ date: r.date, mortality: Number(r.mortality) || 0 })),
        )
      }
    }
    const overrides = user.companyId ? await overridesFor(ctx, user.companyId) : []
    const bins = new Map<string, number>()
    const cageIdByName = new Map(cages.map((c) => [c.name.trim().toLowerCase(), c.id]))
    const feedIdByName = new Map(feedDocs.map((f) => [f.name.trim().toLowerCase(), f._id]))
    for (const r of args.rows) {
      const cageId = cageIdByName.get(String(r.cage ?? '').trim().toLowerCase())
      const feedTypeId = feedIdByName.get(String(r.feedType ?? '').trim().toLowerCase())
      const key = `${cageId}|${feedTypeId}`
      if (!cageId || !feedTypeId || bins.has(key)) continue
      const bin = await cageBin(ctx, cageId as Id<'cages'>, feedTypeId)
      bins.set(key, bin?.quantityKg ?? 0)
    }
    return checkDailyRows(args.rows, {
      ...base,
      feedTypes: feedDocs.map((f) => ({
        id: String(f._id),
        name: f.name,
        pricePerKg: f.pricePerKg,
        currentStock: f.currentStock,
      })),
      history,
      doMin: (cageId) =>
        effectiveThresholds(unitTypeOf(cageById.get(cageId)), overrides).dissolvedOxygen?.min,
      binKg: (cageId, feedTypeId) => bins.get(`${cageId}|${feedTypeId}`) ?? 0,
      allowNegativeStock: settings.feedRules.allowNegativeStock === true,
    })
  }

  if (args.kind === 'biweekly') {
    const taken = new Set<string>()
    const seen = new Set<string>()
    for (const r of args.rows) {
      const code = String(r.batch ?? '').trim()
      const cage = cages.find((c) => c.name.toLowerCase() === String(r.cage ?? '').trim().toLowerCase())
      const candidate = code || (cage && r.date ? `${cage.name}-${String(r.date).trim()}` : '')
      if (!candidate || seen.has(candidate)) continue
      seen.add(candidate)
      const hit = await ctx.db
        .query('biweeklyRecords')
        .withIndex('by_company_and_batchCode', (q) =>
          q.eq('companyId', user.companyId).eq('batchCode', candidate),
        )
        .first()
      if (hit) taken.add(candidate.toLowerCase())
    }
    return checkBiweeklyRows(args.rows, { ...base, takenBatchCodes: taken })
  }

  const stockedOn = new Map<string, Set<string>>()
  for (const cageId of span.cageIds) {
    const rows = await ctx.db
      .query('stockingHistory')
      .withIndex('by_cage', (q) => q.eq('cageId', cageId as Id<'cages'>))
      .order('desc')
      .take(200)
    stockedOn.set(
      cageId,
      new Set(rows.filter((r) => r.status !== 'rejected').map((r) => r.stockingDate)),
    )
  }
  return checkStockingRows(args.rows, {
    ...base,
    stockedOn,
    problem: (cage, fishCount, abw) =>
      stockingProblem({
        cage: cageById.get(cage.id),
        fishCount,
        abw,
        rules: settings.stockingRules,
        farmRules: settings.farmRules,
      }),
  })
}

const toClient = (r: RowResult<any>) => ({
  line: r.line,
  status: r.status,
  ...(r.field ? { field: r.field } : {}),
  ...(r.reason
    ? { reason: { code: r.reason.code, ...(r.reason.params ? { params: r.reason.params } : {}) } }
    : {}),
  ...(r.record?.cageId ? { cageId: r.record.cageId as Id<'cages'> } : {}),
})

/**
 * Check rows before import: each row's status (ok / warning / error), the
 * reason and the cell it points at. `today` is the client's business date
 * (queries have no clock).
 */
export const check = query({
  args: {
    kind: kindValidator,
    locationId: v.optional(v.id('farmLocations')),
    today: v.string(),
    rows: v.array(rowInput),
  },
  returns: v.array(rowResult),
  handler: async (ctx, args) => {
    assertRowCount(args.rows)
    const m = await importMember(ctx, args.kind, args.locationId)
    const results = await evaluate(ctx, m, args)
    return results.map(toClient)
  },
})

/**
 * Import one chunk of rows (≤ IMPORT_CHUNK). The rows are checked again
 * here and only OK and warning rows are written; errors are skipped. Rows
 * already on file are skipped by the inserts, so a retried chunk adds
 * nothing.
 */
export const importRows = mutation({
  args: {
    kind: kindValidator,
    locationId: v.optional(v.id('farmLocations')),
    rows: v.array(rowInput),
  },
  returns: v.object({ imported: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    if (args.rows.length > IMPORT_CHUNK) {
      throw userError('VALIDATION', `Send at most ${IMPORT_CHUNK} rows per call`)
    }
    const m = await importMember(ctx, args.kind, args.locationId)
    const { user } = m
    const today = await todayFor(ctx, { locationId: args.locationId, companyId: user.companyId })
    const results = await evaluate(ctx, m, { ...args, today })
    const passing = results.filter((r) => r.status !== 'error' && r.record).map((r) => r.record)

    let imported = 0
    if (args.kind === 'daily') {
      imported = (await insertDailyMany(ctx, user, passing)).length
    } else if (args.kind === 'biweekly') {
      imported = (await insertBiweeklyMany(ctx, user, passing)).length
    } else {
      for (const record of passing) {
        await createStockingAs(ctx as MutationCtx, user as Doc<'users'>, record)
        imported++
      }
      if (imported > 0) {
        await logAudit(ctx, {
          actionType: 'bulk_create',
          tableName: 'stockingHistory',
          newValues: { count: imported, skipped: args.rows.length - imported },
        })
      }
    }
    return { imported, skipped: args.rows.length - imported }
  },
})
