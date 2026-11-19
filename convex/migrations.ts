/**
 * M1 — move "unscoped" data (rows and users with no companyId) into one
 * approved company, so tenant checks can later refuse company-less access
 * (SEC-001) without locking the existing farm out.
 *
 * Run from the CLI only (both functions are internal):
 *   npx convex run migrations:preflightUnscoped
 *   npx convex run migrations:assignUnscopedToCompany '{"name":"…","code":"…","dryRun":true}'
 *   npx convex run migrations:assignUnscopedToCompany '{"name":"…","code":"…","dryRun":false}'
 *
 * Size assumption: each run handles up to BATCH unscoped rows per table (and
 * scans up to SCAN_LIMIT rows of the two tables without a by_company index).
 * Today every table is far below that. If a table has more, the result says
 * `complete: false` and running the same command again picks up the rest,
 * because each run only touches rows that still have no companyId.
 */
import { insertAuditLog } from './lib/auditChain'
import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentStocking } from './lib/growth'
import { MAX_SCOPED_LOCATIONS, legacyRoleFromKey, roleKeyFromLegacy } from './lib/memberships'
import { ORG_PROFILE_DEFAULTS } from './lib/orgProfile'
import { nextLotCode } from './lib/traceability'
import { seedTemplatesFor } from './lib/compliance'

/** Every table whose schema has an optional `companyId` (users handled separately). */
export const UNSCOPED_TABLES = [
  'farmLocations',
  'cages',
  'feedSuppliers',
  'feedTypes',
  'feedPurchases',
  'feedUsage',
  'dailyRecords',
  'biweeklyRecords',
  'harvestRecords',
  'harvestSampling',
  'feedInventory',
  'feedInventoryTransactions',
  'stockingHistory',
  'topupHistory',
  'fishTransfers',
  'auditLogs',
  'notifications',
  'customers',
  'sales',
  'healthTreatments',
] as const

type UnscopedTable = (typeof UNSCOPED_TABLES)[number]

/** Tables in the list above that have no `by_company` index. */
const NO_COMPANY_INDEX = new Set<UnscopedTable>(['harvestSampling', 'notifications'])

const BATCH = 1000
const SCAN_LIMIT = 5000

type Ctx = QueryCtx | MutationCtx

/** Unscoped rows of one table, at most BATCH; `more` when the table may hold others. */
async function unscopedRows(
  ctx: Ctx,
  table: UnscopedTable,
): Promise<{ rows: Array<{ _id: Id<any> }>; more: boolean }> {
  const db = ctx.db as any
  if (NO_COMPANY_INDEX.has(table)) {
    const scanned: Array<{ _id: Id<any>; companyId?: Id<'companies'> }> = await db
      .query(table)
      .take(SCAN_LIMIT + 1)
    const scanTruncated = scanned.length > SCAN_LIMIT
    const rows = scanned.slice(0, SCAN_LIMIT).filter((r) => !r.companyId)
    return { rows: rows.slice(0, BATCH), more: scanTruncated || rows.length > BATCH }
  }
  const rows = await db
    .query(table)
    .withIndex('by_company', (q: any) => q.eq('companyId', undefined))
    .take(BATCH + 1)
  return { rows: rows.slice(0, BATCH), more: rows.length > BATCH }
}

async function companylessUsers(ctx: Ctx) {
  // users has no companyId index; the table is tiny (5 rows today).
  const all = await ctx.db.query('users').take(SCAN_LIMIT + 1)
  const users = all.slice(0, SCAN_LIMIT).filter((u) => !u.companyId)
  return { users, more: all.length > SCAN_LIMIT }
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
}

async function countUnscoped(ctx: Ctx) {
  const tables: Record<string, number> = {}
  const incomplete: string[] = []
  let totalRows = 0
  for (const table of UNSCOPED_TABLES) {
    const { rows, more } = await unscopedRows(ctx, table)
    tables[table] = rows.length
    totalRows += rows.length
    if (more) incomplete.push(table)
  }
  const { users, more: moreUsers } = await companylessUsers(ctx)
  if (moreUsers) incomplete.push('users')

  // Users who belong to a company that is not approved (SEC-001 will block them).
  const allUsers = await ctx.db.query('users').take(SCAN_LIMIT)
  let usersInNonApprovedCompanies = 0
  for (const u of allUsers) {
    if (!u.companyId) continue
    const company = await ctx.db.get(u.companyId)
    if (!company || company.status !== 'approved') usersInNonApprovedCompanies++
  }

  return {
    tables,
    totalRows,
    users: {
      companyless: users.length,
      companylessSuperAdmins: users.filter((u) => u.role === 'super_admin').length,
      companylessInactive: users.filter((u) => u.active === false).length,
      ids: users.map((u) => u._id),
    },
    usersInNonApprovedCompanies,
    /** False when some table holds more than one batch; re-run to finish. */
    complete: incomplete.length === 0,
    incomplete,
  }
}

const channelValues = v.union(
  v.literal('email'),
  v.literal('in_app'),
  v.literal('sms'),
  v.literal('whatsapp'),
)

const usersRow = v.object({
  companyless: v.number(),
  companylessSuperAdmins: v.number(),
  companylessInactive: v.number(),
  ids: v.array(v.id('users')),
})

const companyValues = v.union(
  v.object({
    action: v.literal('reuse'),
    companyId: v.id('companies'),
    name: v.string(),
    code: v.string(),
  }),
  v.object({ action: v.literal('create'), companyId: v.null(), name: v.string(), code: v.string() }),
)

/** Read-only M1 pre-flight: what has no companyId today. */
export const preflightUnscoped = internalQuery({
  args: {},
  returns: v.object({
    tables: v.record(v.string(), v.number()),
    totalRows: v.number(),
    users: usersRow,
    usersInNonApprovedCompanies: v.number(),
    complete: v.boolean(),
    incomplete: v.array(v.string()),
  }),
  handler: async (ctx) => countUnscoped(ctx),
})

/**
 * Assign every company-less user and unscoped row to one approved company.
 * dryRun (default true) only reports. Idempotent: a second run finds nothing
 * left to assign and writes nothing.
 */
export const assignUnscopedToCompany = internalMutation({
  args: {
    name: v.string(),
    code: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({
      dryRun: v.boolean(),
      company: companyValues,
      wouldAssign: v.object({
        tables: v.record(v.string(), v.number()),
        totalRows: v.number(),
        users: usersRow,
      }),
      usersInNonApprovedCompanies: v.number(),
      complete: v.boolean(),
      incomplete: v.array(v.string()),
    }),
    v.object({
      dryRun: v.boolean(),
      company: companyValues,
      assigned: v.object({
        tables: v.record(v.string(), v.number()),
        totalRows: v.number(),
        users: v.number(),
        activeLocationFixed: v.number(),
      }),
      complete: v.boolean(),
      incomplete: v.array(v.string()),
    }),
    v.object({
      dryRun: v.boolean(),
      company: v.union(
        v.object({
          companyId: v.id('companies'),
          action: v.literal('reuse'),
          name: v.string(),
          code: v.string(),
        }),
        v.object({
          companyId: v.id('companies'),
          action: v.literal('create'),
          name: v.string(),
          code: v.string(),
        }),
      ),
      assigned: v.object({
        tables: v.record(v.string(), v.number()),
        totalRows: v.number(),
        users: v.number(),
        userIds: v.array(v.id('users')),
        activeLocationFixed: v.number(),
      }),
      complete: v.boolean(),
      incomplete: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false
    const name = args.name.trim()
    const code = normalizeCode(args.code)
    if (!name) throw new Error('name is required')
    if (code.length < 2) throw new Error('code must be at least 2 characters (A-Z, 0-9, -)')

    const existing = await ctx.db
      .query('companies')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first()
    if (existing && existing.status !== 'approved') {
      throw new Error(
        `Company ${code} exists with status "${existing.status}". Approve it first or use another code.`,
      )
    }

    const before = await countUnscoped(ctx)
    const companyPlan = existing
      ? { action: 'reuse' as const, companyId: existing._id, name: existing.name, code }
      : { action: 'create' as const, companyId: null, name, code }

    if (dryRun) {
      return {
        dryRun: true,
        company: companyPlan,
        wouldAssign: { tables: before.tables, totalRows: before.totalRows, users: before.users },
        usersInNonApprovedCompanies: before.usersInNonApprovedCompanies,
        complete: before.complete,
        incomplete: before.incomplete,
      }
    }

    const nothingToDo = before.totalRows === 0 && before.users.companyless === 0
    if (nothingToDo && existing) {
      return {
        dryRun: false,
        company: companyPlan,
        assigned: { tables: before.tables, totalRows: 0, users: 0, activeLocationFixed: 0 },
        complete: before.complete,
        incomplete: before.incomplete,
      }
    }

    const now = Date.now()
    const companyId: Id<'companies'> =
      existing?._id ??
      (await ctx.db.insert('companies', {
        name,
        code,
        status: 'approved',
        settings: { aiAssistantEnabled: false },
        createdAt: now,
        approvedAt: now,
      }))

    const assignedTables: Record<string, number> = {}
    let totalRows = 0
    for (const table of UNSCOPED_TABLES) {
      const { rows } = await unscopedRows(ctx, table)
      for (const row of rows) {
        await ctx.db.patch(row._id as any, { companyId } as any)
      }
      assignedTables[table] = rows.length
      totalRows += rows.length
    }

    const { users } = await companylessUsers(ctx)
    for (const u of users) {
      // Role is kept as is (super_admins stay super_admins).
      await ctx.db.patch(u._id, { companyId })
    }

    // activeLocationId must point at an active location of this company.
    const locations = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(BATCH)
    const firstActive = locations.find((l) => l.active !== false)
    let activeLocationFixed = 0
    if (firstActive) {
      for (const u of users) {
        const current: Doc<'farmLocations'> | null = u.activeLocationId
          ? await ctx.db.get(u.activeLocationId)
          : null
        if (!current || current.companyId !== companyId || current.active === false) {
          await ctx.db.patch(u._id, { activeLocationId: firstActive._id })
          activeLocationFixed++
        }
      }
    }

    const after = await countUnscoped(ctx)
    const assigned = {
      tables: assignedTables,
      totalRows,
      users: users.length,
      userIds: users.map((u) => u._id),
      activeLocationFixed,
    }
    await insertAuditLog(ctx, {
      actionType: 'migration_m1_assign_company',
      tableName: 'companies',
      recordId: companyId,
      newValues: {
        company: { ...companyPlan, companyId },
        assigned,
        remaining: { totalRows: after.totalRows, users: after.users.companyless },
      },
      companyId,
    })

    return {
      dryRun: false,
      company: { ...companyPlan, companyId },
      assigned,
      complete: after.complete && after.totalRows === 0 && after.users.companyless === 0,
      incomplete: after.incomplete,
    }
  },
})


/**
 * One-off data repairs for PROD-000. None of these run automatically: they are
 * internal functions an operator runs by hand from the Convex dashboard (or
 * `npx convex run`) after the code fix is deployed. Every one defaults to
 * `dryRun: true`, which only reports what it would change; pass
 * `dryRun: false` to write. Each written change keeps the previous value in
 * an `auditLogs` row (actionType `migration`).
 */

/**
 * M0-b: cages restocked since their last bi-weekly sample still carry the
 * previous cycle's ABW in `currentWeight` (doc 09 S7). Reset it to the
 * current stocking's ABW. Cages with a sample in the current cycle, and cages
 * that have never been sampled, are left alone.
 */
export const repairStaleCageWeight = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.object({
    dryRun: v.boolean(),
    count: v.number(),
    changes: v.array(
      v.object({
        cageId: v.string(),
        cage: v.string(),
        stockingDate: v.string(),
        lastSampleDate: v.string(),
        from: v.number(),
        to: v.number(),
      }),
    ),
  }),
  handler: async (ctx, { dryRun = true }) => {
    const changes: Array<{
      cageId: string
      cage: string
      stockingDate: string
      lastSampleDate: string
      from: number
      to: number
    }> = []

    for await (const cage of ctx.db.query('cages')) {
      if (!cage.stockingDate || cage.currentWeight == null) continue
      const samples = await ctx.db
        .query('biweeklyRecords')
        .withIndex('by_cage', (q) => q.eq('cageId', cage._id))
        .collect()
      if (!samples.length) continue
      if (samples.some((s) => s.date >= cage.stockingDate!)) continue

      const stocking = await currentStocking(ctx, cage._id)
      const target = stocking?.initialAbw ?? cage.initialAbw
      if (target == null || target === cage.currentWeight) continue

      const lastSampleDate = samples.map((s) => s.date).sort()[samples.length - 1]
      changes.push({
        cageId: cage._id,
        cage: cage.name,
        stockingDate: cage.stockingDate,
        lastSampleDate,
        from: cage.currentWeight,
        to: target,
      })
      if (dryRun) continue

      await ctx.db.patch(cage._id, { currentWeight: target, updatedAt: Date.now() })
      await insertAuditLog(ctx, {
        actionType: 'migration',
        tableName: 'cages',
        recordId: cage._id,
        previousValues: { currentWeight: cage.currentWeight },
        newValues: { currentWeight: target, migration: 'M0-b' },
        locationId: cage.locationId,
        companyId: cage.companyId,
      })
    }

    return { dryRun, count: changes.length, changes }
  },
})

/**
 * M0-c: tag the harvest records the old /harvest-sampling page wrote
 * (`harvest.createFromSampling`) with `source: 'sampling_page'`, so harvest
 * KPIs leave them out (doc 09 S12). The records are not deleted.
 *
 * Fingerprint of such a record: FCR exactly 1.5, no `cageEffect` (the page
 * never touched the cage), and a `harvestSampling` row pointing at it with the
 * same date, total weight and fish count. Review the dry-run list before
 * writing: an old real harvest that happens to match all of these would be
 * tagged too.
 *
 * The page also stored ABW in kg (weight ÷ count) where the rest of the app
 * uses grams (PROD-000g). The same pass converts those values: on the tagged
 * harvests and on any `harvestSampling` row whose ABW is exactly its kg
 * weight ÷ count. Idempotent: converted rows no longer match. Not run by
 * this change; run with `dryRun: true` first and review the counts.
 */
export const tagSamplingPageHarvests = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.object({
    dryRun: v.boolean(),
    count: v.number(),
    samplingAbwFixed: v.number(),
    changes: v.array(
      v.object({
        harvestId: v.string(),
        cageId: v.string(),
        harvestDate: v.string(),
        totalWeight: v.number(),
        estimatedCount: v.number(),
      }),
    ),
  }),
  handler: async (ctx, { dryRun = true }) => {
    const changes: Array<{
      harvestId: string
      cageId: string
      harvestDate: string
      totalWeight: number
      estimatedCount: number
    }> = []

    for await (const h of ctx.db.query('harvestRecords')) {
      if (h.source || h.cageEffect || h.fcr !== 1.5) continue
      const samples = await ctx.db
        .query('harvestSampling')
        .withIndex('by_harvest', (q) => q.eq('harvestId', h._id))
        .collect()
      const match = samples.some(
        (s) =>
          s.cageId === h.cageId &&
          s.date === h.harvestDate &&
          s.weight === h.totalWeight &&
          s.fishCount === h.estimatedCount,
      )
      if (!match) continue

      changes.push({
        harvestId: h._id,
        cageId: h.cageId,
        harvestDate: h.harvestDate,
        totalWeight: h.totalWeight,
        estimatedCount: h.estimatedCount,
      })
      if (dryRun) continue

      const abwG = kgAbwToGrams(h.averageBodyWeight, h.totalWeight, h.estimatedCount)
      await ctx.db.patch(h._id, { source: 'sampling_page', ...(abwG != null ? { averageBodyWeight: abwG } : {}) })
      await insertAuditLog(ctx, {
        actionType: 'migration',
        tableName: 'harvestRecords',
        recordId: h._id,
        previousValues: { source: null, averageBodyWeight: h.averageBodyWeight },
        newValues: { source: 'sampling_page', migration: 'M0-c', ...(abwG != null ? { averageBodyWeight: abwG } : {}) },
        locationId: h.locationId,
        companyId: h.companyId,
      })
    }

    let samplingAbwFixed = 0
    for await (const s of ctx.db.query('harvestSampling')) {
      const abwG = kgAbwToGrams(s.abw, s.weight, s.fishCount)
      if (abwG == null) continue
      samplingAbwFixed++
      if (dryRun) continue
      await ctx.db.patch(s._id, { abw: abwG })
      await insertAuditLog(ctx, {
        actionType: 'migration',
        tableName: 'harvestSampling',
        recordId: s._id,
        previousValues: { abw: s.abw },
        newValues: { abw: abwG, migration: 'M0-c' },
        locationId: s.locationId,
        companyId: s.companyId,
      })
    }

    return { dryRun, count: changes.length, samplingAbwFixed, changes }
  },
})

/** Grams for an ABW that was stored as kg (exactly weight kg ÷ count); else null. */
function kgAbwToGrams(abw: number | undefined, weightKg: number | undefined, count: number | undefined) {
  if (!abw || !weightKg || !count || count <= 0) return null
  const kg = weightKg / count
  if (Math.abs(abw - kg) > 1e-9) return null
  return Math.round(kg * 1000 * 100) / 100
}

/**
 * M2 — one membership per user with a companyId (ORG-001, D-002).
 * Role mapping (owner decision): admin (and super_admin with a company) →
 * 'admin', user → 'manager'. status 'suspended' when the account is
 * inactive; allLocations unless users.locationIds lists sites.
 *
 * Pages through users; dryRun (default true) only reports. Idempotent: users
 * who already have a row for their company are skipped. Run until isDone:
 *   npx convex run migrations:m2BackfillMemberships '{"dryRun":true}'
 *   npx convex run migrations:m2BackfillMemberships '{"dryRun":false}'
 *   (repeat with '{"dryRun":false,"cursor":"<continueCursor>"}' while isDone is false)
 *   npx convex run migrations:m2VerifyMemberships
 */
export const m2BackfillMemberships = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    created: v.number(),
    skipped: v.number(),
    rows: v.array(
      v.object({
        userId: v.id('users'),
        companyId: v.id('companies'),
        roleKey: v.string(),
        status: v.string(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { dryRun = true, cursor = null, batchSize = 200 }) => {
    const page = await ctx.db
      .query('users')
      .paginate({ numItems: Math.min(Math.max(batchSize, 1), 500), cursor })
    const created: Array<{
      userId: Id<'users'>
      companyId: Id<'companies'>
      roleKey: string
      status: string
    }> = []
    let skipped = 0
    for (const user of page.page) {
      const companyId = user.companyId
      if (!companyId) {
        skipped++
        continue
      }
      const existing = await ctx.db
        .query('memberships')
        .withIndex('by_companyId_and_userId', (q) =>
          q.eq('companyId', companyId).eq('userId', user._id),
        )
        .unique()
      if (existing) {
        skipped++
        continue
      }
      const roleKey = roleKeyFromLegacy(user.role)
      const status = user.active === false ? ('suspended' as const) : ('active' as const)
      const scoped = (user.locationIds ?? []).slice(0, MAX_SCOPED_LOCATIONS)
      created.push({ userId: user._id, companyId, roleKey, status })
      if (dryRun) continue
      const now = Date.now()
      await ctx.db.insert('memberships', {
        userId: user._id,
        companyId,
        roleKey,
        allLocations: scoped.length === 0,
        locationIds: scoped.length ? scoped : undefined,
        status,
        joinedAt: user._creationTime,
        statusChangedAt: now,
        legacy: true,
        updatedAt: now,
      })
    }
    return {
      dryRun,
      created: created.length,
      skipped,
      rows: created,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    }
  },
})

/**
 * M2 acceptance check: every user with a companyId has exactly one membership
 * for it, with the role the mapping gives. Read-only; pages like the backfill.
 */
export const m2VerifyMemberships = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ checked: v.number(), problems: v.array(v.object({ userId: v.id('users'), problem: v.string() })), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor = null }) => {
    const page = await ctx.db.query('users').paginate({ numItems: 500, cursor })
    const problems: Array<{ userId: Id<'users'>; problem: string }> = []
    let checked = 0
    for (const user of page.page) {
      const companyId = user.companyId
      if (!companyId) continue
      checked++
      const rows = await ctx.db
        .query('memberships')
        .withIndex('by_companyId_and_userId', (q) =>
          q.eq('companyId', companyId).eq('userId', user._id),
        )
        .collect()
      if (rows.length !== 1) {
        problems.push({ userId: user._id, problem: `${rows.length} memberships for active company` })
        continue
      }
      const legacy = user.role === 'admin' || user.role === 'super_admin' ? 'admin' : 'user'
      if (legacyRoleFromKey(rows[0].roleKey) !== legacy) {
        problems.push({ userId: user._id, problem: `role ${user.role} vs membership ${rows[0].roleKey}` })
      }
    }
    return { checked, problems, isDone: page.isDone, continueCursor: page.continueCursor }
  },
})

/**
 * M3 — write the organization profile defaults onto existing companies
 * (timezone 'Africa/Accra', metric, en-GH, GH). Optional: reads already
 * default them (lib/orgProfile). Only fills fields that are unset.
 *   npx convex run migrations:m3CompanyProfileDefaults '{"dryRun":true}'
 *   npx convex run migrations:m3CompanyProfileDefaults '{"dryRun":false}'
 */
export const m3CompanyProfileDefaults = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.object({
    dryRun: v.boolean(),
    count: v.number(),
    changes: v.array(
      v.object({
        companyId: v.id('companies'),
        patch: v.object({
          _id: v.optional(v.id('companies')),
          _creationTime: v.optional(v.number()),
          address: v.optional(v.string()),
          timezone: v.optional(v.string()),
          contactEmail: v.optional(v.string()),
          contactPhone: v.optional(v.string()),
          abbreviation: v.optional(v.string()),
          logoStorageId: v.optional(v.id('_storage')),
          submittedByUserId: v.optional(v.id('users')),
          rejectionReason: v.optional(v.string()),
          country: v.optional(v.string()),
          unitSystem: v.optional(v.union(v.literal('metric'), v.literal('imperial'))),
          defaultLocale: v.optional(v.string()),
          terminology: v.optional(v.record(v.string(), v.string())),
          settings: v.optional(
            v.object({
              updatedAt: v.optional(v.number()),
              updatedBy: v.optional(v.id('users')),
              locale: v.optional(v.object({ currency: v.optional(v.string()) })),
              branding: v.optional(
                v.object({
                  displayName: v.optional(v.string()),
                  accentHex: v.optional(v.string()),
                  themeMode: v.optional(
                    v.union(v.literal('light'), v.literal('dark'), v.literal('system')),
                  ),
                }),
              ),
              farmRules: v.optional(
                v.object({
                  targetHarvestAbwG: v.optional(v.number()),
                  targetFcr: v.optional(v.number()),
                  harvestDocMinDays: v.optional(v.number()),
                  harvestDocMaxDays: v.optional(v.number()),
                  maxDensityFishPerM3: v.optional(v.number()),
                  maxDensityFishPerM2: v.optional(v.number()),
                  maxDensityTankFishPerM3: v.optional(v.number()),
                  densityWarnPct: v.optional(v.number()),
                  dailyMortalityAlertPct: v.optional(v.number()),
                  cumulativeMortalityAlertPct: v.optional(v.number()),
                  maxFcrAlert: v.optional(v.number()),
                }),
              ),
              stockingRules: v.optional(
                v.object({
                  requireApprovalForFishTransfer: v.optional(v.boolean()),
                  requireDifferentApprover: v.optional(v.boolean()),
                  minInitialAbwG: v.optional(v.number()),
                  maxInitialAbwG: v.optional(v.number()),
                  minTopupAbwG: v.optional(v.number()),
                  maxTopupAbwG: v.optional(v.number()),
                  allowStockOnlyEmptyStatuses: v.optional(v.array(v.string())),
                  requireApprovalForStocking: v.boolean(),
                  requireApprovalForTopup: v.boolean(),
                  enforceCageCapacity: v.boolean(),
                }),
              ),
              feedRules: v.optional(
                v.object({
                  defaultBagSizeKg: v.optional(v.number()),
                  defaultLocation: v.optional(v.string()),
                  allowNegativeStock: v.optional(v.boolean()),
                  trackLots: v.optional(v.boolean()),
                  lowStockMultiplier: v.optional(v.number()),
                  requireBatchOnPurchase: v.optional(v.boolean()),
                }),
              ),
              defaultCountryCode: v.optional(v.string()),
              messaging: v.optional(
                v.object({
                  usePlatformDefaultSms: v.optional(v.boolean()),
                  usePlatformDefaultWhatsapp: v.optional(v.boolean()),
                  usePlatformDefaultEmail: v.optional(v.boolean()),
                }),
              ),
              approvalAlerts: v.optional(
                v.object({
                  enabled: v.optional(v.boolean()),
                  channels: v.optional(v.array(channelValues)),
                  escalateAfterHours: v.optional(v.number()),
                  escalationChannels: v.optional(v.array(channelValues)),
                }),
              ),
              security: v.optional(
                v.object({
                  updatedAt: v.optional(v.number()),
                  updatedBy: v.optional(v.id('users')),
                  allowPhoneLogin: v.optional(v.boolean()),
                  phoneLoginChannel: v.optional(v.union(v.literal('sms'), v.literal('whatsapp'))),
                  require2fa: v.optional(v.boolean()),
                  twoFactorChannel: v.optional(v.union(v.literal('sms'), v.literal('whatsapp'))),
                  phoneLoginSatisfies2fa: v.optional(v.boolean()),
                }),
              ),
              aiAssistantEnabled: v.boolean(),
            }),
          ),
          approvedAt: v.optional(v.number()),
          approvedBy: v.optional(v.id('users')),
          name: v.optional(v.string()),
          createdAt: v.optional(v.number()),
          status: v.optional(
            v.union(v.literal('pending'), v.literal('rejected'), v.literal('approved')),
          ),
          code: v.optional(v.string()),
        }),
      }),
    ),
  }),
  handler: async (ctx, { dryRun = true }) => {
    const companies = await ctx.db.query('companies').take(1000)
    const changes: Array<{ companyId: Id<'companies'>; patch: Partial<Doc<'companies'>> }> = []
    for (const c of companies) {
      const patch: Partial<Doc<'companies'>> = {}
      if (c.timezone === undefined) patch.timezone = ORG_PROFILE_DEFAULTS.timezone
      if (c.unitSystem === undefined) patch.unitSystem = ORG_PROFILE_DEFAULTS.unitSystem
      if (c.defaultLocale === undefined) patch.defaultLocale = ORG_PROFILE_DEFAULTS.defaultLocale
      if (c.country === undefined) patch.country = ORG_PROFILE_DEFAULTS.country
      if (Object.keys(patch).length === 0) continue
      changes.push({ companyId: c._id, patch })
      if (!dryRun) await ctx.db.patch(c._id, patch)
    }
    return { dryRun, count: changes.length, changes }
  },
})

/**
 * M4 — make production unit types explicit (FARM-002, D-003). Optional: every
 * reader already treats a missing unitType as 'cage'. Sets unitType 'cage' on
 * units without one and copies `size` (m³) into volumeM3 where unset. Pages
 * through cages; dryRun (default true) only reports; idempotent.
 *   npx convex run migrations:m4BackfillUnitTypes '{"dryRun":true}'
 *   npx convex run migrations:m4BackfillUnitTypes '{"dryRun":false}'
 *   (repeat with '{"dryRun":false,"cursor":"<continueCursor>"}' while isDone is false)
 */
export const m4BackfillUnitTypes = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    dryRun: v.boolean(),
    count: v.number(),
    changes: v.array(
      v.object({
        cageId: v.id('cages'),
        patch: v.object({
          _id: v.optional(v.id('cages')),
          _creationTime: v.optional(v.number()),
          companyId: v.optional(v.id('companies')),
          createdBy: v.optional(v.id('users')),
          locationId: v.optional(v.id('farmLocations')),
          statusChangedAt: v.optional(v.number()),
          species: v.optional(v.string()),
          custom: v.optional(v.record(v.string(), v.any())),
          code: v.optional(v.string()),
          notes: v.optional(v.string()),
          latitude: v.optional(v.number()),
          longitude: v.optional(v.number()),
          location: v.optional(v.string()),
          size: v.optional(v.number()),
          capacity: v.optional(v.number()),
          dimensions: v.optional(v.string()),
          material: v.optional(v.string()),
          installationDate: v.optional(v.string()),
          stockingDate: v.optional(v.string()),
          initialCount: v.optional(v.number()),
          currentCount: v.optional(v.number()),
          initialAbw: v.optional(v.number()),
          initialBiomass: v.optional(v.number()),
          initialWeight: v.optional(v.number()),
          currentWeight: v.optional(v.number()),
          growthRate: v.optional(v.number()),
          mortalityRate: v.optional(v.number()),
          lastMaintenanceDate: v.optional(v.string()),
          nextMaintenanceDate: v.optional(v.string()),
          currentBatchId: v.optional(v.id('batches')),
          unitType: v.optional(
            v.union(
              v.literal('cage'),
              v.literal('pond'),
              v.literal('tank'),
              v.literal('raceway'),
              v.literal('hatchery_tank'),
              v.literal('incubator'),
              v.literal('hapa'),
            ),
          ),
          areaM2: v.optional(v.number()),
          depthM: v.optional(v.number()),
          volumeM3: v.optional(v.number()),
          diameterM: v.optional(v.number()),
          unitGroup: v.optional(v.string()),
          unitGroupId: v.optional(v.id('unitGroups')),
          waterBodyId: v.optional(v.id('waterBodies')),
          netVolumeM3: v.optional(v.number()),
          meshSizeMm: v.optional(v.number()),
          lengthM: v.optional(v.number()),
          widthM: v.optional(v.number()),
          flowM3h: v.optional(v.number()),
          waterSource: v.optional(v.string()),
          maxDensity: v.optional(v.number()),
          archivedAt: v.optional(v.number()),
          name: v.optional(v.string()),
          status: v.optional(
            v.union(
              v.literal('active'),
              v.literal('harvested'),
              v.literal('harvesting'),
              v.literal('maintenance'),
              v.literal('fallow'),
              v.literal('empty'),
            ),
          ),
          updatedAt: v.optional(v.number()),
        }),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { dryRun = true, cursor = null }) => {
    const page = await ctx.db.query('cages').paginate({ numItems: 300, cursor })
    const changes: Array<{ cageId: Id<'cages'>; patch: Partial<Doc<'cages'>> }> = []
    for (const cage of page.page) {
      const patch: Partial<Doc<'cages'>> = {}
      if (cage.unitType === undefined) patch.unitType = 'cage'
      if (cage.volumeM3 === undefined && cage.size !== undefined && cage.size > 0) {
        patch.volumeM3 = cage.size
      }
      if (Object.keys(patch).length === 0) continue
      changes.push({ cageId: cage._id, patch })
      if (!dryRun) await ctx.db.patch(cage._id, patch)
    }
    return {
      dryRun,
      count: changes.length,
      changes,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    }
  },
})

/**
 * M18 (TRACE-004) — give every existing harvest one default lot holding its
 * whole weight, so each harvest is traceable and can be dispatched. Rows from
 * the old sampling page (`source: 'sampling_page'`), harvests without a
 * company or weight, and harvests that already have a lot are skipped.
 * Idempotent; dryRun (default true) only reports.
 *   npx convex run migrations:m18DefaultHarvestLots '{"dryRun":true}'
 *   npx convex run migrations:m18DefaultHarvestLots '{"dryRun":false}'
 *   (repeat with '{"dryRun":false,"cursor":"<continueCursor>"}' while isDone is false)
 */
export const m18DefaultHarvestLots = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    dryRun: v.boolean(),
    count: v.number(),
    skipped: v.number(),
    created: v.array(
      v.object({ harvestId: v.id('harvestRecords'), lotCode: v.string(), weightKg: v.number() }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { dryRun = true, cursor = null }) => {
    const page = await ctx.db.query('harvestRecords').paginate({ numItems: 200, cursor })
    const created: Array<{ harvestId: Id<'harvestRecords'>; lotCode: string; weightKg: number }> = []
    let skipped = 0
    for (const h of page.page) {
      const companyId = h.companyId
      if (!companyId || h.source === 'sampling_page' || !(h.totalWeight > 0)) {
        skipped++
        continue
      }
      const existing = await ctx.db
        .query('harvestLots')
        .withIndex('by_harvestId', (q) => q.eq('harvestId', h._id))
        .first()
      if (existing) {
        skipped++
        continue
      }
      const lotCode = await nextLotCode(ctx, companyId, h)
      created.push({ harvestId: h._id, lotCode, weightKg: h.totalWeight })
      if (dryRun) continue
      await ctx.db.insert('harvestLots', {
        companyId,
        locationId: h.locationId,
        harvestId: h._id,
        cageId: h.cageId,
        batchId: h.batchId,
        lotCode,
        harvestDate: h.harvestDate,
        weightKg: h.totalWeight,
        fishCount: h.estimatedCount,
        backfilled: true,
        updatedAt: Date.now(),
      })
    }
    return {
      dryRun,
      count: created.length,
      skipped,
      created,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    }
  },
})

/**
 * TRACE-006 — give every approved company the built-in compliance checklists
 * (daily biosecurity, weekly net inspection, monthly water quality review).
 * Idempotent (by template key); dryRun (default true) only reports.
 *   npx convex run migrations:seedComplianceTemplates '{"dryRun":true}'
 *   npx convex run migrations:seedComplianceTemplates '{"dryRun":false}'
 */
export const seedComplianceTemplates = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({ dryRun: v.boolean(), count: v.number(), added: v.array(v.object({ companyId: v.id('companies'), keys: v.array(v.string()) })), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { dryRun = true, cursor = null }) => {
    const page = await ctx.db.query('companies').paginate({ numItems: 100, cursor })
    const added: Array<{ companyId: Id<'companies'>; keys: string[] }> = []
    for (const company of page.page) {
      if (company.status !== 'approved') continue
      const keys = await seedTemplatesFor(ctx, company._id, { dryRun })
      if (keys.length) added.push({ companyId: company._id, keys })
    }
    return { dryRun, count: added.length, added, isDone: page.isDone, continueCursor: page.continueCursor }
  },
})
