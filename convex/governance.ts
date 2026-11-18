/**
 * Data governance (ENT-005): organization data export, organization and
 * account deletion requests with a grace period, and retention jobs.
 * Rules and table lists: convex/lib/governance.ts and
 * docs/architecture/21-data-governance.md.
 */
import { v } from 'convex/values'
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { requireAccount, requireMember, requirePlatformAdmin, assertUserCan } from './lib/permissions'
import { revokeUserSessions } from './lib/authz'
import { logAudit } from './lib/tenancy'
import { insertAuditLog } from './lib/auditChain'
import { userError } from './lib/errors'
import {
  EXPORT_ROW_CAP,
  EXPORT_TABLES,
  PURGE_TABLES,
  RETENTION,
  exportRow,
  tenantTable,
} from './lib/governance'
import { buildZip, toCsv, type ZipEntry } from './lib/zip'
import { deleteUserPreferences } from './userPreferences'

// ─── Organization export ────────────────────────────────────────────────────

function exportToClient(e: Doc<'dataExports'>) {
  return {
    id: e._id,
    status: e.status,
    sizeBytes: e.sizeBytes ?? null,
    tableCounts: e.tableCounts ?? null,
    truncatedTables: e.truncatedTables ?? [],
    error: e.error ?? null,
    createdAt: e.createdAt,
    finishedAt: e.finishedAt ?? null,
    expiresAt: e.expiresAt ?? null,
  }
}

/** Queue a full export of the organization (zip: JSON + CSV per table). */
export const requestExport = mutation({
  args: {},
  returns: v.id('dataExports'),
  handler: async (ctx) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'org.data.export' })
    if (!companyId) throw userError('VALIDATION', 'No organization selected')
    const latest = await ctx.db
      .query('dataExports')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .order('desc')
      .first()
    if (latest && (latest.status === 'queued' || latest.status === 'running') && Date.now() - latest.createdAt < 3_600_000) {
      throw userError('CONFLICT', 'An export is already being prepared')
    }
    const exportId = await ctx.db.insert('dataExports', {
      companyId,
      requestedBy: user._id,
      status: 'queued',
      createdAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'data_export_requested',
      tableName: 'dataExports',
      recordId: exportId,
    })
    await ctx.scheduler.runAfter(0, internal.governance.runExport, { exportId })
    return exportId
  },
})

export const listExports = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireMember(ctx, { permission: 'org.data.export' })
    if (!companyId) return []
    const rows = await ctx.db
      .query('dataExports')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(10)
    return rows.map(exportToClient)
  },
})

/** A download link for a ready, unexpired export of the caller's organization. Audited. */
export const exportDownloadUrl = mutation({
  args: { exportId: v.id('dataExports') },
  returns: v.string(),
  handler: async (ctx, { exportId }) => {
    const { companyId } = await requireMember(ctx, { permission: 'org.data.export' })
    const row = await ctx.db.get(exportId)
    if (!row || row.companyId !== companyId) throw userError('NOT_FOUND', 'Export not found')
    if (row.status !== 'ready' || !row.storageId || (row.expiresAt ?? 0) < Date.now()) {
      throw userError('CONFLICT', 'This export is not available')
    }
    const url = await ctx.storage.getUrl(row.storageId)
    if (!url) throw userError('NOT_FOUND', 'Export file not found')
    await logAudit(ctx, { actionType: 'data_export_downloaded', tableName: 'dataExports', recordId: exportId })
    return url
  },
})

export const exportJob = internalQuery({
  args: { exportId: v.id('dataExports') },
  handler: async (ctx, { exportId }) => await ctx.db.get(exportId),
})

export const markExport = internalMutation({
  args: {
    exportId: v.id('dataExports'),
    status: v.union(v.literal('running'), v.literal('ready'), v.literal('failed')),
    storageId: v.optional(v.id('_storage')),
    sizeBytes: v.optional(v.number()),
    tableCounts: v.optional(v.record(v.string(), v.number())),
    truncatedTables: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { exportId, status, ...rest }) => {
    const now = Date.now()
    await ctx.db.patch(exportId, {
      status,
      ...rest,
      ...(status === 'running' ? {} : { finishedAt: now }),
      ...(status === 'ready' ? { expiresAt: now + RETENTION.exportMs } : {}),
    })
    return null
  },
})

/** One page of a tenant table for the export, redacted. */
export const exportPage = internalQuery({
  args: {
    companyId: v.id('companies'),
    table: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { companyId, table, cursor }) => {
    const spec = tenantTable(table)
    if (!spec || spec.export === false) throw new Error(`Not an exported table: ${table}`)
    const result = await (ctx.db.query(spec.table) as any)
      .withIndex(spec.index, (q: any) => q.eq('companyId', companyId))
      .paginate({ numItems: 1000, cursor })
    return {
      rows: (result.page as Array<Record<string, unknown>>).map((r) => exportRow(r, spec.redact)),
      isDone: result.isDone as boolean,
      continueCursor: result.continueCursor as string,
    }
  },
})

/** Build the zip: <table>.json and <table>.csv per table, plus manifest.json. */
export const runExport = internalAction({
  args: { exportId: v.id('dataExports') },
  returns: v.null(),
  handler: async (ctx, { exportId }) => {
    const job = await ctx.runQuery(internal.governance.exportJob, { exportId })
    if (!job || job.status !== 'queued') return null
    await ctx.runMutation(internal.governance.markExport, { exportId, status: 'running' })
    try {
      const entries: ZipEntry[] = []
      const tableCounts: Record<string, number> = {}
      const truncatedTables: string[] = []
      for (const spec of EXPORT_TABLES) {
        const rows: Array<Record<string, unknown>> = []
        let cursor: string | null = null
        for (;;) {
          const page: { rows: Array<Record<string, unknown>>; isDone: boolean; continueCursor: string } =
            await ctx.runQuery(internal.governance.exportPage, {
              companyId: job.companyId,
              table: spec.table,
              cursor,
            })
          rows.push(...page.rows)
          if (page.isDone) break
          if (rows.length >= EXPORT_ROW_CAP) {
            truncatedTables.push(spec.table)
            break
          }
          cursor = page.continueCursor
        }
        tableCounts[spec.table] = rows.length
        if (rows.length === 0) continue
        entries.push({ name: `json/${spec.table}.json`, data: JSON.stringify(rows, null, 1) })
        entries.push({ name: `csv/${spec.table}.csv`, data: toCsv(rows) })
      }
      entries.unshift({
        name: 'manifest.json',
        data: JSON.stringify(
          {
            companyId: job.companyId,
            exportId,
            generatedAt: new Date().toISOString(),
            tableCounts,
            truncatedTables,
            note: 'Secrets (credentials, key and token hashes, sign-in data) are not included.',
          },
          null,
          2,
        ),
      })
      const zip = buildZip(entries)
      const storageId = await ctx.storage.store(new Blob([zip as BlobPart], { type: 'application/zip' }))
      await ctx.runMutation(internal.governance.markExport, {
        exportId,
        status: 'ready',
        storageId,
        sizeBytes: zip.length,
        tableCounts,
        truncatedTables,
      })
    } catch (err) {
      await ctx.runMutation(internal.governance.markExport, {
        exportId,
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 300) : 'Export failed',
      })
    }
    return null
  },
})

/** Daily: delete export files past their expiry. */
export const pruneExports = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const due = await ctx.db
      .query('dataExports')
      .withIndex('by_status_and_expiresAt', (q) => q.eq('status', 'ready').lt('expiresAt', Date.now()))
      .take(100)
    for (const row of due) {
      if (row.storageId) await ctx.storage.delete(row.storageId)
      await ctx.db.patch(row._id, { status: 'expired', storageId: undefined })
    }
    return due.length
  },
})

// ─── Deletion requests ──────────────────────────────────────────────────────

const OPEN = ['requested', 'approved', 'in_progress'] as const

async function openRequest(
  ctx: MutationCtx,
  by: { companyId: Id<'companies'> } | { userId: Id<'users'> },
  kind: Doc<'dataRequests'>['kind'],
) {
  for (const status of OPEN) {
    const rows =
      'companyId' in by
        ? await ctx.db
            .query('dataRequests')
            .withIndex('by_companyId_and_status', (q) => q.eq('companyId', by.companyId).eq('status', status))
            .take(20)
        : await ctx.db
            .query('dataRequests')
            .withIndex('by_userId_and_status', (q) => q.eq('userId', by.userId).eq('status', status))
            .take(20)
    const hit = rows.find((r) => r.kind === kind)
    if (hit) return hit
  }
  return null
}

function requestToClient(r: Doc<'dataRequests'>, extra: Record<string, unknown> = {}) {
  return {
    id: r._id,
    kind: r.kind,
    status: r.status,
    companyId: r.companyId ?? null,
    userId: r.userId,
    reason: r.reason ?? null,
    requestedAt: r.requestedAt,
    decidedAt: r.decidedAt ?? null,
    decisionNote: r.decisionNote ?? null,
    graceEndsAt: r.graceEndsAt ?? null,
    completedAt: r.completedAt ?? null,
    ...extra,
  }
}

/** Ask for the organization and all its data to be deleted (platform approves). */
export const requestOrgDeletion = mutation({
  args: { reason: v.optional(v.string()) },
  returns: v.id('dataRequests'),
  handler: async (ctx, { reason }) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'org.data.delete' })
    if (!companyId) throw userError('VALIDATION', 'No organization selected')
    if (await openRequest(ctx, { companyId }, 'org_deletion')) {
      throw userError('CONFLICT', 'A deletion request for this organization is already open')
    }
    const id = await ctx.db.insert('dataRequests', {
      kind: 'org_deletion',
      companyId,
      userId: user._id,
      status: 'requested',
      reason: reason?.trim().slice(0, 1000) || undefined,
      requestedAt: Date.now(),
    })
    await logAudit(ctx, { actionType: 'org_deletion_requested', tableName: 'dataRequests', recordId: id })
    return id
  },
})

/** Ask for my own account to be deleted (anonymized) after the grace period. */
export const requestAccountDeletion = mutation({
  args: { reason: v.optional(v.string()) },
  returns: v.id('dataRequests'),
  handler: async (ctx, { reason }) => {
    const user = await requireAccount(ctx)
    if ((user.role ?? 'user') === 'super_admin') {
      throw userError('VALIDATION', 'A platform admin account cannot be deleted this way')
    }
    if (await openRequest(ctx, { userId: user._id }, 'account_deletion')) {
      throw userError('CONFLICT', 'You already have an open deletion request')
    }
    const id = await ctx.db.insert('dataRequests', {
      kind: 'account_deletion',
      companyId: user.companyId,
      userId: user._id,
      status: 'requested',
      reason: reason?.trim().slice(0, 1000) || undefined,
      requestedAt: Date.now(),
    })
    await logAudit(ctx, { actionType: 'account_deletion_requested', tableName: 'dataRequests', recordId: id })
    return id
  },
})

/**
 * Withdraw a request. The requester (or, for an organization request, anyone
 * holding org.data.delete there) can cancel before approval; an account
 * deletion can also be cancelled by its owner during the grace period.
 */
export const cancelRequest = mutation({
  args: { requestId: v.id('dataRequests') },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const user = await requireAccount(ctx)
    const r = await ctx.db.get(requestId)
    if (!r) throw userError('NOT_FOUND', 'Request not found')
    const mine = r.userId === user._id
    if (!mine) {
      if (r.kind !== 'org_deletion' || !r.companyId || r.companyId !== user.companyId) {
        throw userError('NOT_FOUND', 'Request not found')
      }
      await assertUserCan(ctx, user, 'org.data.delete')
    }
    const now = Date.now()
    const cancellable =
      r.status === 'requested' ||
      (r.status === 'approved' && r.kind === 'account_deletion' && (r.graceEndsAt ?? 0) > now)
    if (!cancellable) throw userError('CONFLICT', 'This request can no longer be cancelled here')
    await ctx.db.patch(requestId, { status: 'cancelled', decidedAt: now, decidedBy: user._id })
    await logAudit(ctx, { actionType: 'data_request_cancelled', tableName: 'dataRequests', recordId: requestId })
    return null
  },
})

/** My account request, and my organization's request when I may manage it. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAccount(ctx)
    const out: Doc<'dataRequests'>[] = []
    const own = await ctx.db
      .query('dataRequests')
      .withIndex('by_userId_and_status', (q) => q.eq('userId', user._id))
      .take(50)
    out.push(...own)
    if (user.companyId) {
      const companyId = user.companyId
      let canManage = true
      try {
        await assertUserCan(ctx, user, 'org.data.delete')
      } catch {
        canManage = false
      }
      if (canManage) {
        const org = await ctx.db
          .query('dataRequests')
          .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId))
          .take(50)
        for (const r of org) if (r.kind === 'org_deletion' && !out.some((o) => o._id === r._id)) out.push(r)
      }
    }
    return out.sort((a, b) => b.requestedAt - a.requestedAt || b._creationTime - a._creationTime).map((r) => requestToClient(r))
  },
})

/** Platform: open deletion requests to decide or follow. */
export const platformListRequests = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx)
    const rows: Doc<'dataRequests'>[] = []
    for (const status of OPEN) {
      rows.push(
        ...(await ctx.db
          .query('dataRequests')
          .withIndex('by_status_and_graceEndsAt', (q) => q.eq('status', status))
          .take(100)),
      )
    }
    const out = []
    for (const r of rows) {
      const company = r.companyId ? await ctx.db.get(r.companyId) : null
      const requester = await ctx.db.get(r.userId)
      out.push(
        requestToClient(r, {
          companyName: company?.name ?? null,
          requesterLabel: requester?.name || requester?.email || String(r.userId),
        }),
      )
    }
    return out.sort((a, b) => b.requestedAt - a.requestedAt)
  },
})

/**
 * Platform: approve or reject. Approval starts the grace period; an approved
 * organization deletion blocks its members at once (company not approved).
 */
export const decideRequest = mutation({
  args: { requestId: v.id('dataRequests'), approve: v.boolean(), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { requestId, approve, note }) => {
    const admin = await requirePlatformAdmin(ctx)
    const r = await ctx.db.get(requestId)
    if (!r) throw userError('NOT_FOUND', 'Request not found')
    if (r.status !== 'requested') throw userError('CONFLICT', 'This request was already decided')
    const now = Date.now()
    const decisionNote = note?.trim().slice(0, 1000) || undefined
    if (!approve) {
      await ctx.db.patch(requestId, { status: 'rejected', decidedAt: now, decidedBy: admin._id, decisionNote })
    } else {
      const graceEndsAt = now + RETENTION.deletionGraceMs
      let previousCompanyStatus: string | undefined
      if (r.kind === 'org_deletion' && r.companyId) {
        const company = await ctx.db.get(r.companyId)
        if (company) {
          previousCompanyStatus = company.status
          await ctx.db.patch(company._id, {
            status: 'rejected',
            rejectionReason: `Deletion scheduled for ${new Date(graceEndsAt).toISOString().slice(0, 10)}`,
          })
        }
      }
      await ctx.db.patch(requestId, {
        status: 'approved',
        decidedAt: now,
        decidedBy: admin._id,
        decisionNote,
        graceEndsAt,
        previousCompanyStatus,
      })
    }
    await insertAuditLog(ctx, {
      userId: admin._id,
      companyId: r.companyId,
      actionType: approve ? 'data_request_approved' : 'data_request_rejected',
      tableName: 'dataRequests',
      recordId: requestId,
      newValues: { kind: r.kind, note: decisionNote },
    })
    return null
  },
})

/** Platform: cancel an approved request during its grace period (restores the organization). */
export const platformCancelRequest = mutation({
  args: { requestId: v.id('dataRequests') },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const admin = await requirePlatformAdmin(ctx)
    const r = await ctx.db.get(requestId)
    if (!r) throw userError('NOT_FOUND', 'Request not found')
    const now = Date.now()
    if (!(r.status === 'requested' || (r.status === 'approved' && (r.graceEndsAt ?? 0) > now))) {
      throw userError('CONFLICT', 'This request can no longer be cancelled')
    }
    if (r.status === 'approved' && r.kind === 'org_deletion' && r.companyId) {
      const restore = r.previousCompanyStatus
      if (restore === 'approved' || restore === 'pending' || restore === 'rejected') {
        await ctx.db.patch(r.companyId, { status: restore, rejectionReason: undefined })
      }
    }
    await ctx.db.patch(requestId, { status: 'cancelled', decidedAt: now, decidedBy: admin._id })
    await insertAuditLog(ctx, {
      userId: admin._id,
      companyId: r.companyId,
      actionType: 'data_request_cancelled',
      tableName: 'dataRequests',
      recordId: requestId,
    })
    return null
  },
})

// ─── Retention jobs ─────────────────────────────────────────────────────────

/** Remove personal data from an account; keeps the row so references still resolve. */
export async function anonymizeUser(ctx: MutationCtx, userId: Id<'users'>) {
  const user = await ctx.db.get(userId)
  if (!user) return
  const memberships = await ctx.db
    .query('memberships')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(200)
  for (const m of memberships) {
    await ctx.db.patch(m._id, { status: 'removed', statusChangedAt: Date.now(), updatedAt: Date.now() })
  }
  const accounts = await ctx.db
    .query('authAccounts')
    .withIndex('userIdAndProvider', (q) => q.eq('userId', userId))
    .take(50)
  for (const a of accounts) await ctx.db.delete(a._id)
  await revokeUserSessions(ctx, userId)
  await deleteUserPreferences(ctx, userId)
  await ctx.db.patch(userId, {
    name: 'Deleted user',
    email: undefined,
    phone: undefined,
    image: undefined,
    emailVerificationTime: undefined,
    phoneVerificationTime: undefined,
    active: false,
    companyId: undefined,
    locationIds: undefined,
    activeLocationId: undefined,
    deletedAt: Date.now(),
  })
}

/** Daily: complete approved requests whose grace period ended; purge expired audit rows. */
export const processDueRequests = internalMutation({
  args: {},
  returns: v.object({ due: v.number(), auditPurges: v.number() }),
  handler: async (ctx) => {
    const now = Date.now()
    const due = await ctx.db
      .query('dataRequests')
      .withIndex('by_status_and_graceEndsAt', (q) =>
        q.eq('status', 'approved').gt('graceEndsAt', 0).lte('graceEndsAt', now),
      )
      .take(10)
    for (const r of due) {
      if (r.kind === 'account_deletion') {
        await anonymizeUser(ctx, r.userId)
        await ctx.db.patch(r._id, { status: 'completed', completedAt: now })
        await insertAuditLog(ctx, {
          companyId: r.companyId,
          actionType: 'account_deleted',
          tableName: 'users',
          recordId: r.userId,
        })
      } else if (r.companyId) {
        await ctx.db.patch(r._id, { status: 'in_progress' })
        await ctx.scheduler.runAfter(0, internal.governance.purgeCompanyBatch, {
          companyId: r.companyId,
          requestId: r._id,
          dryRun: false,
        })
      }
    }
    const expiredAudit = await ctx.db
      .query('dataRequests')
      .withIndex('by_status_and_auditRetainUntil', (q) =>
        q.eq('status', 'completed').gt('auditRetainUntil', 0).lte('auditRetainUntil', now),
      )
      .take(5)
    for (const r of expiredAudit) {
      await ctx.scheduler.runAfter(0, internal.governance.purgeAuditBatch, { requestId: r._id })
    }
    return { due: due.length, auditPurges: expiredAudit.length }
  },
})

const PURGE_BATCH = 100

async function deleteCascade(ctx: MutationCtx, table: string, row: any) {
  if (table === 'biweeklyRecords') {
    const children = await ctx.db
      .query('biweeklySampling')
      .withIndex('by_record', (q) => q.eq('biweeklyRecordId', row._id))
      .take(200)
    for (const c of children) await ctx.db.delete(c._id)
  } else if (table === 'messagingChannels') {
    const secrets = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_channel', (q) => q.eq('channelId', row._id))
      .take(20)
    for (const s of secrets) await ctx.db.delete(s._id)
  } else if (table === 'webhookEndpoints') {
    const secrets = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_webhookEndpointId', (q) => q.eq('webhookEndpointId', row._id))
      .take(20)
    for (const s of secrets) await ctx.db.delete(s._id)
    const deliveries = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_endpointId_and_createdAt', (q) => q.eq('endpointId', row._id))
      .take(500)
    for (const d of deliveries) await ctx.db.delete(d._id)
  } else if (table === 'inboundWebhooks' || table === 'llmCredentials') {
    const secrets =
      table === 'inboundWebhooks'
        ? await ctx.db
            .query('integrationSecrets')
            .withIndex('by_inboundWebhookId', (q) => q.eq('inboundWebhookId', row._id))
            .take(20)
        : await ctx.db
            .query('integrationSecrets')
            .withIndex('by_llmCredentialId', (q) => q.eq('llmCredentialId', row._id))
            .take(20)
    for (const s of secrets) await ctx.db.delete(s._id)
  } else if (table === 'apiKeys') {
    const keys = await ctx.db
      .query('apiIdempotencyKeys')
      .withIndex('by_apiKeyId_and_key', (q) => q.eq('apiKeyId', row._id))
      .take(500)
    for (const k of keys) await ctx.db.delete(k._id)
  } else if ((table === 'files' || table === 'dataExports') && row.storageId) {
    await ctx.storage.delete(row.storageId)
  }
}

/**
 * Delete an organization's rows table by table, PURGE_BATCH rows per
 * transaction, rescheduling itself. Audit rows are kept (retention); users
 * are detached, not deleted (they may belong to other organizations).
 * `dryRun` (the default) only counts what would go, up to 200 per table.
 */
export const purgeCompanyBatch = internalMutation({
  args: {
    companyId: v.id('companies'),
    requestId: v.optional(v.id('dataRequests')),
    dryRun: v.optional(v.boolean()),
    tableIndex: v.optional(v.number()),
    counts: v.optional(v.record(v.string(), v.number())),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false
    if (dryRun) {
      const counts: Record<string, number> = {}
      for (const spec of PURGE_TABLES) {
        const rows = await (ctx.db.query(spec.table) as any)
          .withIndex(spec.index, (q: any) => q.eq('companyId', args.companyId))
          .take(201)
        if (rows.length) counts[spec.table] = rows.length
      }
      return { dryRun: true, counts, done: false }
    }
    if (args.requestId) {
      const r = await ctx.db.get(args.requestId)
      if (!r || r.status !== 'in_progress' || r.companyId !== args.companyId) {
        return { dryRun: false, counts: args.counts ?? {}, done: false }
      }
    }
    const counts = { ...(args.counts ?? {}) }
    const index = args.tableIndex ?? 0
    const spec = PURGE_TABLES[index]
    if (spec) {
      const rows = await (ctx.db.query(spec.table) as any)
        .withIndex(spec.index, (q: any) => q.eq('companyId', args.companyId))
        .take(PURGE_BATCH)
      for (const row of rows) {
        if (spec.purge === 'detach') {
          await ctx.db.patch(row._id, { companyId: undefined, activeLocationId: undefined, locationIds: undefined })
        } else {
          await deleteCascade(ctx, spec.table, row)
          await ctx.db.delete(row._id)
        }
      }
      counts[spec.table] = (counts[spec.table] ?? 0) + rows.length
      const next = rows.length === PURGE_BATCH ? index : index + 1
      await ctx.scheduler.runAfter(0, internal.governance.purgeCompanyBatch, {
        companyId: args.companyId,
        requestId: args.requestId,
        dryRun: false,
        tableIndex: next,
        counts,
      })
      return { dryRun: false, counts, done: false }
    }
    // Every table is empty: keep a tombstone company row for the audit trail.
    const company = await ctx.db.get(args.companyId)
    if (company) {
      if (company.logoStorageId) await ctx.storage.delete(company.logoStorageId)
      await ctx.db.patch(company._id, {
        name: 'Deleted organization',
        status: 'rejected',
        rejectionReason: 'Deleted on request',
        address: undefined,
        contactEmail: undefined,
        contactPhone: undefined,
        abbreviation: undefined,
        logoStorageId: undefined,
        settings: undefined,
      })
    }
    const now = Date.now()
    if (args.requestId) {
      await ctx.db.patch(args.requestId, {
        status: 'completed',
        completedAt: now,
        purgedCounts: counts,
        auditRetainUntil: now + RETENTION.auditAfterDeletionMs,
      })
    }
    await insertAuditLog(ctx, {
      companyId: args.companyId,
      actionType: 'org_deleted',
      tableName: 'companies',
      recordId: args.companyId,
      newValues: { purgedCounts: counts },
    })
    return { dryRun: false, counts, done: true }
  },
})

/** After the retention period, delete a deleted organization's audit rows and chain. */
export const purgeAuditBatch = internalMutation({
  args: { requestId: v.id('dataRequests') },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId)
    if (!r || r.status !== 'completed' || !r.companyId || r.auditPurgedAt) return null
    const companyId = r.companyId
    const rows = await ctx.db
      .query('auditLogs')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(500)
    for (const row of rows) await ctx.db.delete(row._id)
    if (rows.length === 500) {
      await ctx.scheduler.runAfter(0, internal.governance.purgeAuditBatch, { requestId })
      return null
    }
    for (const table of ['auditChainHeads', 'auditChainVerifications'] as const) {
      const left = await ctx.db
        .query(table)
        .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
        .take(500)
      for (const row of left) await ctx.db.delete(row._id)
    }
    await ctx.db.patch(requestId, { auditPurgedAt: Date.now(), auditRetainUntil: undefined })
    return null
  },
})
