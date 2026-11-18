/**
 * Legacy data resolution (ORG-007, INV-002). Operator-run only: every
 * function is internal and nothing calls them automatically.
 *
 * M10 — narrow step after M1 (R04 §4). `m10VerifyNarrowReady` is the
 * read-only verification query: it says whether every tenant table is free of
 * rows without `companyId`, so `companyId` can be made required. The schema
 * change itself is NOT part of this module; see docs/ops/legacy-data-migrations.md
 * for the follow-up checklist.
 *   npx convex run legacyData:m10VerifyNarrowReady
 *
 * M16 (transfer part) — convert legacy one-row `transfer` ledger rows into the
 * two-legged shape (`transfer_out` at the source, `transfer_in` at the
 * destination, shared `transferId`) written since INV-002. The ledger row
 * never stored its source site, but the audit row written with it
 * (`actionType: 'transfer'`, `tableName: 'feedInventory'`, `recordId` = row
 * id) kept the request arguments, including `fromLocationId` and
 * `toLocationId`. Rows whose audit row is missing or disagrees with the
 * ledger row are left as `transfer` and reported as `unresolved`; the
 * per-site tally already ignores them (that is the "legacy_unsigned" state of
 * R04 M16). Lots are not touched: the old code already moved them.
 *   npx convex run legacyData:m16ConvertLegacyTransfers '{"dryRun":true}'
 *   npx convex run legacyData:m16ConvertLegacyTransfers '{"dryRun":false,"cursor":"<continueCursor>"}'
 * Batch/cursor: one page of `feedInventoryTransactions` per call; repeat with
 * `continueCursor` until `isDone`. Idempotent: converted rows are no longer
 * `transfer`, so a re-run (or a re-run of a page) finds nothing to do.
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { insertAuditLog } from './lib/auditChain'
import { UNSCOPED_TABLES } from './migrations'

/** Tables in UNSCOPED_TABLES without a `by_company` index (scanned instead). */
const NO_COMPANY_INDEX = new Set<string>(['harvestSampling', 'notifications'])
const SCAN_LIMIT = 5000
/** Audit rows of `tableName: 'feedInventory'` read per M16 batch. */
const AUDIT_SCAN_LIMIT = 5000
const DEFAULT_BATCH = 200
const MAX_BATCH = 500

type Ctx = QueryCtx | MutationCtx

const tableCheck = v.object({
  table: v.string(),
  /** Exact count when scanned; 1 means "at least one" for indexed checks. */
  unscoped: v.number(),
  method: v.union(v.literal('index'), v.literal('scan')),
  /** The scan stopped at SCAN_LIMIT rows: the table is not fully checked. */
  truncated: v.boolean(),
})

/**
 * M10 verification: zero rows without companyId on every tenant table.
 * `ready` is true only when no table has one and every scan was complete.
 */
export const m10VerifyNarrowReady = internalQuery({
  args: {},
  returns: v.object({
    ready: v.boolean(),
    tables: v.array(tableCheck),
    blockers: v.array(v.string()),
    users: v.object({
      companyless: v.number(),
      companylessNonSuperAdmins: v.number(),
      truncated: v.boolean(),
    }),
    narrowTables: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const db = ctx.db as any
    const tables: Array<{ table: string; unscoped: number; method: 'index' | 'scan'; truncated: boolean }> = []
    for (const table of UNSCOPED_TABLES) {
      if (NO_COMPANY_INDEX.has(table)) {
        const rows: Array<{ companyId?: Id<'companies'> }> = await db.query(table).take(SCAN_LIMIT + 1)
        const truncated = rows.length > SCAN_LIMIT
        const unscoped = rows.slice(0, SCAN_LIMIT).filter((r) => !r.companyId).length
        tables.push({ table, unscoped, method: 'scan', truncated })
      } else {
        const first = await db
          .query(table)
          .withIndex('by_company', (q: any) => q.eq('companyId', undefined))
          .first()
        tables.push({ table, unscoped: first ? 1 : 0, method: 'index', truncated: false })
      }
    }
    const blockers = tables
      .filter((t) => t.unscoped > 0 || t.truncated)
      .map((t) => (t.truncated ? `${t.table}: scan truncated at ${SCAN_LIMIT} rows` : `${t.table}: rows without companyId`))

    // users.companyId stays optional (platform super_admins have none);
    // company-less members are reported, not blocking.
    const users = await ctx.db.query('users').take(SCAN_LIMIT + 1)
    const companyless = users.slice(0, SCAN_LIMIT).filter((u) => !u.companyId)
    return {
      ready: blockers.length === 0,
      tables,
      blockers,
      users: {
        companyless: companyless.length,
        companylessNonSuperAdmins: companyless.filter((u) => u.role !== 'super_admin').length,
        truncated: users.length > SCAN_LIMIT,
      },
      narrowTables: [...UNSCOPED_TABLES],
    }
  },
})

type LegacyTransferAudit = {
  fromLocationId?: Id<'farmLocations'>
  toLocationId?: Id<'farmLocations'>
  fromLabel?: string
  toLabel?: string
  quantityKg?: number
}

/** Legacy transfer audit rows by ledger row id (one bounded scan per batch). */
async function legacyTransferAudits(ctx: Ctx): Promise<{ byRecord: Map<string, LegacyTransferAudit>; truncated: boolean }> {
  const rows = await ctx.db
    .query('auditLogs')
    .withIndex('by_table', (q) => q.eq('tableName', 'feedInventory'))
    .take(AUDIT_SCAN_LIMIT + 1)
  const byRecord = new Map<string, LegacyTransferAudit>()
  for (const row of rows.slice(0, AUDIT_SCAN_LIMIT)) {
    if (row.actionType !== 'transfer' || !row.recordId) continue
    const nv = (row.newValues ?? {}) as Record<string, unknown>
    byRecord.set(row.recordId, {
      fromLocationId: typeof nv.fromLocationId === 'string' ? (nv.fromLocationId as Id<'farmLocations'>) : undefined,
      toLocationId: typeof nv.toLocationId === 'string' ? (nv.toLocationId as Id<'farmLocations'>) : undefined,
      fromLabel: typeof nv.fromLocation === 'string' ? nv.fromLocation : undefined,
      toLabel: typeof nv.toLocation === 'string' ? nv.toLocation : undefined,
      quantityKg: typeof nv.quantityKg === 'number' ? nv.quantityKg : undefined,
    })
  }
  return { byRecord, truncated: rows.length > AUDIT_SCAN_LIMIT }
}

type Plan =
  | {
      ok: true
      row: Doc<'feedInventoryTransactions'>
      fromLocationId?: Id<'farmLocations'>
      toLocationId?: Id<'farmLocations'>
    }
  | { ok: false; row: Doc<'feedInventoryTransactions'>; reason: string }

function planConversion(row: Doc<'feedInventoryTransactions'>, audit: LegacyTransferAudit | undefined): Plan {
  if (!audit) return { ok: false, row, reason: 'no audit row: source site unknown' }
  const qty = Math.abs(row.quantityKg)
  if (audit.quantityKg != null && Math.abs(audit.quantityKg - qty) > 1e-6) {
    return { ok: false, row, reason: `audit quantity ${audit.quantityKg} kg differs from ledger ${qty} kg` }
  }
  // The old writer stored `toLocationId || fromLocationId` on the row.
  const expected = audit.toLocationId ?? audit.fromLocationId
  if (expected !== row.locationId) {
    return { ok: false, row, reason: 'audit sites do not match the ledger row' }
  }
  if (audit.fromLocationId && audit.fromLocationId === audit.toLocationId) {
    return { ok: false, row, reason: 'source and destination are the same site' }
  }
  return { ok: true, row, fromLocationId: audit.fromLocationId, toLocationId: audit.toLocationId }
}

const conversion = v.object({
  transactionId: v.id('feedInventoryTransactions'),
  feedTypeId: v.id('feedTypes'),
  quantityKg: v.number(),
  fromLocationId: v.union(v.id('farmLocations'), v.null()),
  toLocationId: v.union(v.id('farmLocations'), v.null()),
  outId: v.union(v.id('feedInventoryTransactions'), v.null()),
})

export const m16ConvertLegacyTransfers = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    scanned: v.number(),
    converted: v.array(conversion),
    unresolved: v.array(
      v.object({ transactionId: v.id('feedInventoryTransactions'), reason: v.string(), notes: v.union(v.string(), v.null()) }),
    ),
    auditScanTruncated: v.boolean(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false
    const numItems = Math.min(Math.max(1, Math.floor(args.batchSize ?? DEFAULT_BATCH)), MAX_BATCH)
    const page = await ctx.db.query('feedInventoryTransactions').paginate({ numItems, cursor: args.cursor ?? null })
    const legacy = page.page.filter((r) => r.transactionType === 'transfer')
    const { byRecord, truncated } = legacy.length
      ? await legacyTransferAudits(ctx)
      : { byRecord: new Map<string, LegacyTransferAudit>(), truncated: false }

    const converted: Array<{
      transactionId: Id<'feedInventoryTransactions'>
      feedTypeId: Id<'feedTypes'>
      quantityKg: number
      fromLocationId: Id<'farmLocations'> | null
      toLocationId: Id<'farmLocations'> | null
      outId: Id<'feedInventoryTransactions'> | null
    }> = []
    const unresolved: Array<{ transactionId: Id<'feedInventoryTransactions'>; reason: string; notes: string | null }> = []

    for (const row of legacy) {
      const plan = planConversion(row, byRecord.get(row._id))
      if (!plan.ok) {
        unresolved.push({ transactionId: row._id, reason: plan.reason, notes: row.notes ?? null })
        continue
      }
      const qty = Math.abs(row.quantityKg)
      let outId: Id<'feedInventoryTransactions'> | null = null
      if (!dryRun) {
        const transferId = String(row._id)
        outId = await ctx.db.insert('feedInventoryTransactions', {
          feedTypeId: row.feedTypeId,
          transactionType: 'transfer_out',
          quantityKg: -qty,
          bags: row.bags,
          transactionDate: row.transactionDate,
          transferId,
          batchNumber: row.batchNumber,
          expiryDate: row.expiryDate,
          notes: row.notes,
          locationId: plan.fromLocationId,
          companyId: row.companyId,
          createdBy: row.createdBy,
        })
        await ctx.db.patch(row._id, {
          transactionType: 'transfer_in',
          quantityKg: qty,
          transferId,
          locationId: plan.toLocationId,
        })
        await insertAuditLog(ctx, {
          actionType: 'migration',
          tableName: 'feedInventoryTransactions',
          recordId: row._id,
          previousValues: { transactionType: 'transfer', quantityKg: row.quantityKg, locationId: row.locationId },
          newValues: {
            migration: 'M16',
            transactionType: 'transfer_in',
            transferId,
            outId,
            fromLocationId: plan.fromLocationId,
            toLocationId: plan.toLocationId,
          },
          locationId: plan.toLocationId,
          companyId: row.companyId,
        })
      }
      converted.push({
        transactionId: row._id,
        feedTypeId: row.feedTypeId,
        quantityKg: qty,
        fromLocationId: plan.fromLocationId ?? null,
        toLocationId: plan.toLocationId ?? null,
        outId,
      })
    }

    return {
      dryRun,
      scanned: page.page.length,
      converted,
      unresolved,
      auditScanTruncated: truncated,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    }
  },
})
