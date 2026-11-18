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
