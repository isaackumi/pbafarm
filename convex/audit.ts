import { v } from 'convex/values'
import { paginationResultValidator, paginationOptsValidator } from 'convex/server'
import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import type { MutationCtx } from './_generated/server'
import { GENESIS_HASH, chainHead, checkLink } from './lib/auditChain'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { listForCompany } from './lib/tenancy'
import { tenantScope } from './lib/scope'
import { requireMember } from './lib/permissions'

type AuditFilters = {
  tableName?: string
  userId?: Id<'users'>
  actionType?: string
  recordId?: string
  dateFrom?: number
  dateTo?: number
}

/** Most audit rows a single filtered read examines before it stops. */
const AUDIT_SCAN_LIMIT = 5000

/**
 * Newest-first audit query for the caller's scope, using the tightest index:
 * company + table (`by_company_and_tableName`), the user (`by_user`), or the
 * company (`by_company`). Date filters are ranges on `_creationTime`, the
 * implicit last field of every index. Returns null when the caller has no
 * scope. Company-less super_admins get the platform view (by_table / by_user /
 * creation time).
 */
function auditQuery(ctx: QueryCtx, user: Doc<'users'>, f: AuditFilters) {
  const scope = tenantScope(user)
  if (scope.kind === 'none') return null
  const range = (q: any) => {
    let r = q
    if (f.dateFrom) r = r.gte('_creationTime', f.dateFrom)
    if (f.dateTo) r = r.lte('_creationTime', f.dateTo)
    return r
  }
  const logs = ctx.db.query('auditLogs')
  if (scope.kind === 'company') {
    if (f.tableName) {
      return logs
        .withIndex('by_company_and_tableName', (q) =>
          range(q.eq('companyId', scope.companyId).eq('tableName', f.tableName!)),
        )
        .order('desc')
    }
    if (f.userId) {
      return logs
        .withIndex('by_user', (q) => range(q.eq('userId', f.userId!)))
        .order('desc')
    }
    return logs
      .withIndex('by_company', (q) => range(q.eq('companyId', scope.companyId)))
      .order('desc')
  }
  if (f.tableName) {
    return logs
      .withIndex('by_table', (q) => range(q.eq('tableName', f.tableName!)))
      .order('desc')
  }
  if (f.userId) {
    return logs.withIndex('by_user', (q) => range(q.eq('userId', f.userId!))).order('desc')
  }
  return logs.withIndex('by_creation_time', (q) => range(q)).order('desc')
}

function matches(user: Doc<'users'>, f: AuditFilters, log: Doc<'auditLogs'>) {
  const scope = tenantScope(user)
  if (scope.kind === 'company' && log.companyId !== scope.companyId) return false
  if (f.tableName && log.tableName !== f.tableName) return false
  if (f.userId && log.userId !== f.userId) return false
  if (f.actionType && log.actionType !== f.actionType) return false
  if (f.recordId && log.recordId !== f.recordId) return false
  return true
}

/**
 * Up to `max` matching rows, newest first. Stops after AUDIT_SCAN_LIMIT
 * examined rows so a rare filter cannot read a company's whole history.
 */
async function collectAudit(
  ctx: QueryCtx,
  user: Doc<'users'>,
  f: AuditFilters,
  max: number,
) {
  const q = auditQuery(ctx, user, f)
  if (!q) return []
  const out: Doc<'auditLogs'>[] = []
  let scanned = 0
  for await (const log of q) {
    scanned += 1
    if (matches(user, f, log)) out.push(log)
    if (out.length >= max || scanned >= AUDIT_SCAN_LIMIT) break
  }
  return out
}

function toClient(a: Doc<'auditLogs'>, userLabel?: string | null) {
  return {
    id: a._id,
    _id: a._id,
    user_id: a.userId,
    user_label: userLabel || null,
    action_type: a.actionType,
    table_name: a.tableName,
    record_id: a.recordId,
    previous_values: a.previousValues,
    new_values: a.newValues,
    company_id: a.companyId,
    created_at: a._creationTime,
    /** 'whatsapp' | 'telegram' (farm bot) or 'anowa' (confirmed from an Ask Anowa draft). */
    channel: a.channel ?? null,
  }
}

async function labelForUser(ctx: QueryCtx, userId: Id<'users'> | undefined) {
  if (!userId) return null
  const u = await ctx.db.get(userId)
  if (!u) return String(userId)
  return u.name || u.email || String(userId)
}

const auditLogRow = v.object({
  id: v.id('auditLogs'),
  _id: v.id('auditLogs'),
  user_id: v.optional(v.id('users')),
  user_label: v.union(v.string(), v.null()),
  action_type: v.string(),
  table_name: v.string(),
  record_id: v.optional(v.string()),
  previous_values: v.optional(v.any()),
  new_values: v.optional(v.any()),
  company_id: v.optional(v.id('companies')),
  created_at: v.number(),
  channel: v.union(v.literal('whatsapp'), v.literal('telegram'), v.literal('anowa'), v.null()),
})

export const list = query({
  args: {
    limit: v.optional(v.number()),
    tableName: v.optional(v.string()),
    userId: v.optional(v.id('users')),
    actionType: v.optional(v.string()),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
  },
  returns: v.array(auditLogRow),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.audit.view' })

    const maxRows = Math.min(args.limit ?? 200, 500)
    const { limit: _limit, ...filters } = args
    const auditLogs = await collectAudit(ctx, user, filters, maxRows)

    const out = []
    for (const log of auditLogs) {
      out.push(toClient(log, await labelForUser(ctx, log.userId)))
    }
    return out
  },
})

/**
 * Paginated audit log (PLAT-001), newest first, same filters as `list`.
 * `tableName`, `userId` and the date range are index reads; `actionType`
 * filters each page, so a page can come back short.
 */
export const listPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    tableName: v.optional(v.string()),
    userId: v.optional(v.id('users')),
    actionType: v.optional(v.string()),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
  },
  returns: paginationResultValidator(auditLogRow),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.audit.view' })
    const { paginationOpts, ...filters } = args
    const q = auditQuery(ctx, user, filters)
    if (!q) return { page: [], isDone: true, continueCursor: '' }
    const result = await q.paginate(paginationOpts)
    const page = []
    for (const log of result.page) {
      if (!matches(user, filters, log)) continue
      page.push(toClient(log, await labelForUser(ctx, log.userId)))
    }
    return { ...result, page }
  },
})

export const getByTable = query({
  args: {
    tableName: v.string(),
    recordId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(auditLogRow),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.audit.view' })

    const maxRows = Math.min(args.limit ?? 100, 300)
    // Company + table index: another tenant's audit volume no longer pushes
    // this company's rows out of the window.
    const auditLogs = await collectAudit(
      ctx,
      user,
      { tableName: args.tableName, recordId: args.recordId },
      maxRows,
    )

    const out = []
    for (const log of auditLogs) {
      out.push(toClient(log, await labelForUser(ctx, log.userId)))
    }
    return out
  },
})

export const getByUser = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  returns: v.array(auditLogRow),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.audit.view' })

    const maxRows = Math.min(args.limit ?? 100, 300)
    let auditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(maxRows)

    auditLogs = await listForCompany(user, auditLogs)

    const label = await labelForUser(ctx, args.userId)
    return auditLogs
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, maxRows)
      .map((log) => toClient(log, label))
  },
})

export const getSummary = query({
  args: {
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
  },
  returns: v.object({
    total_logs: v.number(),
    date_range: v.object({ from: v.union(v.number(), v.null()), to: v.union(v.number(), v.null()) }),
    action_types: v.record(v.string(), v.number()),
    table_names: v.record(v.string(), v.number()),
    top_users: v.array(
      v.object({ userId: v.string(), count: v.number(), label: v.union(v.string(), v.null()) }),
    ),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'org.audit.view' })

    // Newest 2000 rows of the company in the date range (index range).
    const auditLogs = await collectAudit(
      ctx,
      user,
      { dateFrom: args.dateFrom, dateTo: args.dateTo },
      2000,
    )


    const actionTypeCounts: Record<string, number> = {}
    const tableNameCounts: Record<string, number> = {}
    const userCounts: Record<string, number> = {}

    auditLogs.forEach((log) => {
      actionTypeCounts[log.actionType] = (actionTypeCounts[log.actionType] || 0) + 1
      tableNameCounts[log.tableName] = (tableNameCounts[log.tableName] || 0) + 1
      if (log.userId) {
        userCounts[log.userId] = (userCounts[log.userId] || 0) + 1
      }
    })

    const topUsers = []
    for (const [userId, count] of Object.entries(userCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)) {
      topUsers.push({
        userId,
        count,
        label: await labelForUser(ctx, userId as Id<'users'>),
      })
    }

    return {
      total_logs: auditLogs.length,
      date_range: {
        from: args.dateFrom || null,
        to: args.dateTo || null,
      },
      action_types: actionTypeCounts,
      table_names: tableNameCounts,
      top_users: topUsers,
    }
  },
})

// ─── Hash chain verification (TRACE-007) ───────────────────────────────────

/** Rows checked per verification transaction. */
const VERIFY_BATCH = 300

async function startVerification(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  requestedBy?: Id<'users'>,
) {
  const latest = await ctx.db
    .query('auditChainVerifications')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .order('desc')
    .first()
  // One run at a time; a run older than an hour is considered stuck.
  if (latest && latest.status === 'running' && Date.now() - latest.startedAt < 3_600_000) {
    return latest._id
  }
  const id = await ctx.db.insert('auditChainVerifications', {
    companyId,
    status: 'running',
    checkedCount: 0,
    lastSeq: 0,
    lastHash: GENESIS_HASH,
    requestedBy,
    startedAt: Date.now(),
  })
  await ctx.scheduler.runAfter(0, internal.audit.verifyBatch, { verificationId: id })
  return id
}

/**
 * Walk one batch of a company's chain in seq order, then reschedule itself
 * until the head is reached. Edited rows, missing rows (seq gaps) and rows
 * removed from the end (head ahead of the last row) all report "broken".
 */
export const verifyBatch = internalMutation({
  args: { verificationId: v.id('auditChainVerifications') },
  returns: v.null(),
  handler: async (ctx, { verificationId }) => {
    const run = await ctx.db.get(verificationId)
    if (!run || run.status !== 'running') return null
    const rows = await ctx.db
      .query('auditLogs')
      .withIndex('by_companyId_and_seq', (q) =>
        q.eq('companyId', run.companyId).gt('seq', run.lastSeq),
      )
      .take(VERIFY_BATCH)
    let expectedSeq = run.lastSeq + 1
    let prevHash = run.lastHash ?? GENESIS_HASH
    let checked = run.checkedCount
    for (const row of rows) {
      const link = await checkLink(row, expectedSeq, prevHash)
      if (!link.ok) {
        await ctx.db.patch(verificationId, {
          status: 'broken',
          brokenAtSeq: expectedSeq,
          reason: link.reason,
          checkedCount: checked,
          finishedAt: Date.now(),
        })
        return null
      }
      checked += 1
      prevHash = link.hash
      expectedSeq += 1
    }
    const lastSeq = expectedSeq - 1
    if (rows.length === VERIFY_BATCH) {
      await ctx.db.patch(verificationId, { checkedCount: checked, lastSeq, lastHash: prevHash })
      await ctx.scheduler.runAfter(0, internal.audit.verifyBatch, { verificationId })
      return null
    }
    const head = await chainHead(ctx, run.companyId)
    const headSeq = head?.seq ?? 0
    const intact = headSeq === lastSeq && (headSeq === 0 || head?.hash === prevHash)
    await ctx.db.patch(verificationId, {
      status: intact ? 'ok' : 'broken',
      checkedCount: checked,
      lastSeq,
      lastHash: prevHash,
      ...(intact
        ? {}
        : {
            brokenAtSeq: lastSeq + 1,
            reason: `the chain head is at entry ${headSeq} but entries stop at ${lastSeq} (entries removed)`,
          }),
      finishedAt: Date.now(),
    })
    return null
  },
})

/** Daily: verify every company's chain (paged over chain heads). */
export const verifyAll = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query('auditChainHeads')
      .paginate({ numItems: 50, cursor: cursor ?? null })
    for (const head of page.page) await startVerification(ctx, head.companyId)
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.audit.verifyAll, { cursor: page.continueCursor })
    }
    return null
  },
})

/** Start a verification of the caller's organization chain now. */
export const verifyChain = mutation({
  args: {},
  returns: v.id('auditChainVerifications'),
  handler: async (ctx) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'org.audit.view' })
    if (!companyId) throw new Error('No organization')
    return await startVerification(ctx, companyId, user._id)
  },
})

/** Chain length, the latest verification, and whether pre-chain rows exist. */
export const chainStatus = query({
  args: {},
  returns: v.union(
    v.object({
      chainLength: v.number(),
      headHash: v.union(v.string(), v.null()),
      unchainedCount: v.number(),
      unchainedMore: v.boolean(),
      latest: v.union(
        v.object({
          status: v.union(v.literal('ok'), v.literal('running'), v.literal('broken')),
          checkedCount: v.number(),
          brokenAtSeq: v.union(v.number(), v.null()),
          reason: v.union(v.string(), v.null()),
          startedAt: v.number(),
          finishedAt: v.union(v.number(), v.null()),
        }),
        v.null(),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const { companyId } = await requireMember(ctx, { permission: 'org.audit.view' })
    if (!companyId) return null
    const head = await ctx.db
      .query('auditChainHeads')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .unique()
    const latest = await ctx.db
      .query('auditChainVerifications')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .order('desc')
      .first()
    // Rows written before TRACE-007 have no seq.
    const unchained = await ctx.db
      .query('auditLogs')
      .withIndex('by_companyId_and_seq', (q) => q.eq('companyId', companyId).eq('seq', undefined))
      .take(1001)
    return {
      chainLength: head?.seq ?? 0,
      headHash: head?.hash ?? null,
      unchainedCount: Math.min(unchained.length, 1000),
      unchainedMore: unchained.length > 1000,
      latest: latest
        ? {
            status: latest.status,
            checkedCount: latest.checkedCount,
            brokenAtSeq: latest.brokenAtSeq ?? null,
            reason: latest.reason ?? null,
            startedAt: latest.startedAt,
            finishedAt: latest.finishedAt ?? null,
          }
        : null,
    }
  },
})
