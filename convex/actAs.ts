/**
 * Super-admin support access (ENT-006). See convex/lib/actAs.ts for how a
 * live session changes requireUser.
 *
 * start: super_admin only, with a reason, a duration (≤ ACT_AS_MAX_MINUTES)
 * and an explicit `allowWrites` (default read-only). One live session per
 * admin: starting another ends the previous one. An expiry job ends the row
 * at expiresAt (requireUser also ignores a row past expiresAt). Start, stop
 * and expiry are audited under the organization.
 */
import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { requireUser } from './lib/authz'
import { insertAuditLog } from './lib/auditChain'
import { userError } from './lib/errors'
import {
  ACT_AS_DEFAULT_MINUTES,
  ACT_AS_MAX_MINUTES,
  ACT_AS_MIN_REASON,
  liveActAsSession,
} from './lib/actAs'

type EndReason = NonNullable<Doc<'actAsSessions'>['endedReason']>

/** The real super-admin account (act-as ignored). */
async function requireSuperAdmin(ctx: QueryCtx | MutationCtx): Promise<Doc<'users'>> {
  const user = await requireUser(ctx, { ignoreActAs: true })
  if ((user.role ?? 'user') !== 'super_admin') {
    throw userError('FORBIDDEN', 'Insufficient permissions: platform.admin', { permission: 'platform.admin' })
  }
  return user
}

async function endSession(ctx: MutationCtx, session: Doc<'actAsSessions'>, reason: EndReason, now: number) {
  await ctx.db.patch(session._id, { endedAt: now, endedReason: reason })
  await insertAuditLog(ctx, {
    userId: session.adminUserId,
    companyId: session.companyId,
    actAsSessionId: session._id,
    actionType: reason === 'expired' ? 'act_as_expired' : 'act_as_stop',
    tableName: 'actAsSessions',
    recordId: session._id,
    newValues: { endedReason: reason },
  })
}

const sessionView = v.object({
  sessionId: v.id('actAsSessions'),
  companyId: v.id('companies'),
  companyName: v.string(),
  reason: v.string(),
  allowWrites: v.boolean(),
  startedAt: v.number(),
  expiresAt: v.number(),
})

export const start = mutation({
  args: {
    companyId: v.id('companies'),
    reason: v.string(),
    allowWrites: v.optional(v.boolean()),
    minutes: v.optional(v.number()),
  },
  returns: v.object({ sessionId: v.id('actAsSessions'), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const admin = await requireSuperAdmin(ctx)
    const reason = args.reason.trim()
    if (reason.length < ACT_AS_MIN_REASON) {
      throw userError('VALIDATION', `Give a reason of at least ${ACT_AS_MIN_REASON} characters (ticket or request).`)
    }
    const minutes = Math.round(args.minutes ?? ACT_AS_DEFAULT_MINUTES)
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > ACT_AS_MAX_MINUTES) {
      throw userError('VALIDATION', `Support access lasts 1 to ${ACT_AS_MAX_MINUTES} minutes.`)
    }
    const company = await ctx.db.get(args.companyId)
    if (!company) throw userError('NOT_FOUND', 'Organization not found')

    const now = Date.now()
    const previous = await liveActAsSession(ctx, admin._id, now)
    if (previous) await endSession(ctx, previous, 'replaced', now)

    const expiresAt = now + minutes * 60_000
    const allowWrites = args.allowWrites === true
    const sessionId = await ctx.db.insert('actAsSessions', {
      adminUserId: admin._id,
      companyId: args.companyId,
      reason: reason.slice(0, 500),
      allowWrites,
      startedAt: now,
      expiresAt,
    })
    await ctx.scheduler.runAt(expiresAt, internal.actAs.expire, { sessionId })
    await insertAuditLog(ctx, {
      userId: admin._id,
      companyId: args.companyId,
      actAsSessionId: sessionId,
      actionType: 'act_as_start',
      tableName: 'actAsSessions',
      recordId: sessionId,
      newValues: { reason: reason.slice(0, 500), allowWrites, minutes, expiresAt },
    })
    return { sessionId, expiresAt }
  },
})

export const stop = mutation({
  args: {},
  returns: v.object({ ended: v.boolean() }),
  handler: async (ctx) => {
    const admin = await requireSuperAdmin(ctx)
    const session = await liveActAsSession(ctx, admin._id, Date.now())
    if (!session) return { ended: false }
    await endSession(ctx, session, 'stopped', Date.now())
    return { ended: true }
  },
})

/** Scheduled at expiresAt: ends the row so live queries (banner, data) refresh. */
export const expire = internalMutation({
  args: { sessionId: v.id('actAsSessions') },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId)
    if (!session || session.endedAt !== undefined) return null
    await endSession(ctx, session, 'expired', Math.max(Date.now(), session.expiresAt))
    return null
  },
})

/** The caller's live support session, for the banner. null for everyone else. */
export const status = query({
  args: {},
  returns: v.union(sessionView, v.null()),
  handler: async (ctx) => {
    let admin: Doc<'users'>
    try {
      admin = await requireUser(ctx, { ignoreActAs: true, allowPendingMfa: true })
    } catch {
      return null
    }
    if ((admin.role ?? 'user') !== 'super_admin') return null
    const session = await liveActAsSession(ctx, admin._id, Date.now())
    if (!session) return null
    const company = await ctx.db.get(session.companyId)
    return {
      sessionId: session._id,
      companyId: session.companyId,
      companyName: company?.name ?? 'Unknown organization',
      reason: session.reason,
      allowWrites: session.allowWrites,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
    }
  },
})

/** Support sessions of one organization, newest first (platform view). */
export const listForCompany = query({
  args: { companyId: v.id('companies') },
  returns: v.array(
    v.object({
      sessionId: v.id('actAsSessions'),
      adminUserId: v.id('users'),
      adminEmail: v.union(v.string(), v.null()),
      reason: v.string(),
      allowWrites: v.boolean(),
      startedAt: v.number(),
      expiresAt: v.number(),
      endedAt: v.union(v.number(), v.null()),
      endedReason: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { companyId }) => {
    await requireSuperAdmin(ctx)
    const rows = await ctx.db
      .query('actAsSessions')
      .withIndex('by_companyId_and_startedAt', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(50)
    const out = []
    for (const r of rows) {
      const admin = await ctx.db.get(r.adminUserId as Id<'users'>)
      out.push({
        sessionId: r._id,
        adminUserId: r.adminUserId,
        adminEmail: admin?.email ?? null,
        reason: r.reason,
        allowWrites: r.allowWrites,
        startedAt: r.startedAt,
        expiresAt: r.expiresAt,
        endedAt: r.endedAt ?? null,
        endedReason: r.endedReason ?? null,
      })
    }
    return out
  },
})
