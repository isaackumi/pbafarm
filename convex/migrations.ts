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
import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentStocking } from './lib/growth'
import { MAX_SCOPED_LOCATIONS, legacyRoleFromKey, roleKeyFromLegacy } from './lib/memberships'
import { ORG_PROFILE_DEFAULTS } from './lib/orgProfile'

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

/** Read-only M1 pre-flight: what has no companyId today. */
export const preflightUnscoped = internalQuery({
  args: {},
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
    await ctx.db.insert('auditLogs', {
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
      await ctx.db.insert('auditLogs', {
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
 */
export const tagSamplingPageHarvests = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
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

      await ctx.db.patch(h._id, { source: 'sampling_page' })
      await ctx.db.insert('auditLogs', {
        actionType: 'migration',
        tableName: 'harvestRecords',
        recordId: h._id,
        previousValues: { source: null },
        newValues: { source: 'sampling_page', migration: 'M0-c' },
        locationId: h.locationId,
        companyId: h.companyId,
      })
    }

    return { dryRun, count: changes.length, changes }
  },
})

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
