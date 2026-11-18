import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { notifyChannel } from './automation/validators'
import { emitDomainEvent } from './lib/events'
import { roleKeyFromLegacy } from './lib/memberships'
import { notifyUsers, type NotifyChannel } from './lib/notify'
import {
  ROLE_TEMPLATES,
  isPermission,
  isTemplateKey,
  requireMember,
  type Permission,
} from './lib/permissions'
import { logAudit } from './lib/tenancy'

/**
 * Approval notifications and escalation (AUTO-004, doc 07 §5 templates
 * `approval_requested` / `approval_pending_escalation`, doc 14 row 26).
 *
 *   request (stocking, top-up, transfer, join request)
 *     └─ onApprovalRequested: emit `approval.requested`; notify members who
 *        hold the approve permission for that site (not the requester);
 *        schedule `escalate` after settings.approvalAlerts.escalateAfterHours
 *   escalate (scheduled): still pending → notify approvers and organization
 *        admins on the escalation channels; otherwise nothing
 *   decision → onApprovalDecided: emit `approval.decided`; tell the requester
 *
 * Built in rather than an automation rule: recipients are "members holding a
 * permission at this site", which rule recipients (everyone/roles/users)
 * cannot express. Rules and webhooks can still react to the two events.
 */

export const APPROVAL_KINDS = ['stocking', 'topup', 'transfer', 'join_request'] as const
export type ApprovalKind = (typeof APPROVAL_KINDS)[number]
export const approvalKind = v.union(
  v.literal('stocking'),
  v.literal('topup'),
  v.literal('transfer'),
  v.literal('join_request'),
)

const KIND: Record<ApprovalKind, { permission: Permission; label: string; approverLink: string; requesterLink: string }> = {
  stocking: { permission: 'production.stocking.approve', label: 'Stocking', approverLink: '/approvals', requesterLink: '/stocking' },
  topup: { permission: 'production.stocking.approve', label: 'Top-up', approverLink: '/approvals', requesterLink: '/stocking' },
  transfer: { permission: 'production.transfer.approve', label: 'Fish transfer', approverLink: '/approvals', requesterLink: '/fish-transfers' },
  join_request: { permission: 'org.members.manage', label: 'Join request', approverLink: '/users', requesterLink: '/dashboard' },
}

export type ApprovalAlertSettings = {
  enabled: boolean
  channels: NotifyChannel[]
  escalateAfterHours: number
  escalationChannels: NotifyChannel[]
}

export const DEFAULT_APPROVAL_ALERTS: ApprovalAlertSettings = {
  enabled: true,
  channels: ['in_app', 'email'],
  escalateAfterHours: 24,
  escalationChannels: ['in_app', 'email'],
}

export const MAX_ESCALATE_HOURS = 24 * 14

export function approvalAlertSettings(company: Doc<'companies'> | null): ApprovalAlertSettings {
  const s = company?.settings?.approvalAlerts
  const hours = s?.escalateAfterHours
  return {
    enabled: s?.enabled ?? DEFAULT_APPROVAL_ALERTS.enabled,
    channels: s?.channels ?? DEFAULT_APPROVAL_ALERTS.channels,
    escalateAfterHours:
      typeof hours === 'number' && hours >= 0 && hours <= MAX_ESCALATE_HOURS ? hours : DEFAULT_APPROVAL_ALERTS.escalateAfterHours,
    escalationChannels: s?.escalationChannels ?? DEFAULT_APPROVAL_ALERTS.escalationChannels,
  }
}

type Ctx = QueryCtx | MutationCtx

async function membershipPermissions(ctx: Ctx, m: { roleId?: Id<'roles'>; roleKey: string; companyId: Id<'companies'> }) {
  if (m.roleId) {
    const role = await ctx.db.get(m.roleId)
    return role && role.companyId === m.companyId && !role.archived ? role.permissions.filter(isPermission) : []
  }
  return isTemplateKey(m.roleKey) ? [...ROLE_TEMPLATES[m.roleKey]] : []
}

/**
 * Active members of the company holding `permission` with `locationId` in
 * their site scope. Reads memberships, plus legacy users that have no row yet
 * (same fallback as lib/memberships activeMembership). Platform admins are
 * not members and are never included.
 */
export async function membersWithPermission(
  ctx: Ctx,
  companyId: Id<'companies'>,
  permission: Permission,
  locationId?: Id<'farmLocations'>,
): Promise<Doc<'users'>[]> {
  const out = new Map<string, Doc<'users'>>()
  const withRow = new Set<string>()
  const memberships = await ctx.db
    .query('memberships')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .take(1000)
  for (const m of memberships) {
    withRow.add(String(m.userId))
    if (m.status !== 'active') continue
    if (locationId && !m.allLocations && !(m.locationIds ?? []).includes(locationId)) continue
    if (!(await membershipPermissions(ctx, m)).includes(permission)) continue
    const u = await ctx.db.get(m.userId)
    if (!u || u.active === false || (u.role ?? 'user') === 'super_admin') continue
    out.set(String(u._id), u)
  }
  const legacy = await ctx.db
    .query('users')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .take(1000)
  for (const u of legacy) {
    if (withRow.has(String(u._id)) || u.active === false || (u.role ?? 'user') === 'super_admin') continue
    const scoped = u.locationIds && u.locationIds.length > 0
    if (locationId && scoped && !u.locationIds!.includes(locationId)) continue
    if (!(ROLE_TEMPLATES[roleKeyFromLegacy(u.role)] as readonly Permission[]).includes(permission)) continue
    out.set(String(u._id), u)
  }
  return [...out.values()]
}

type Subject = {
  companyId: Id<'companies'>
  locationId?: Id<'farmLocations'>
  requesterId?: Id<'users'>
  pending: boolean
  subject: string
}

async function cageName(ctx: Ctx, id: Id<'cages'> | undefined) {
  if (!id) return 'a cage'
  return (await ctx.db.get(id))?.name ?? 'a cage'
}

const n = (x: number) => Math.round(x).toLocaleString('en-US')

/** The request behind an approval alert, or null when it is gone. */
export async function loadApproval(ctx: Ctx, kind: ApprovalKind, recordId: string): Promise<Subject | null> {
  if (kind === 'stocking') {
    const id = ctx.db.normalizeId('stockingHistory', recordId)
    const s = id ? await ctx.db.get(id) : null
    if (!s?.companyId) return null
    const batch = s.batchNumber ? ` (batch ${s.batchNumber})` : ''
    return {
      companyId: s.companyId,
      locationId: s.locationId,
      requesterId: s.createdBy,
      pending: s.status === 'pending_approval' && !s.deletedAt,
      subject: `Stocking ${n(s.fishCount)} fish into ${await cageName(ctx, s.cageId)}${batch}`,
    }
  }
  if (kind === 'topup') {
    const id = ctx.db.normalizeId('topupHistory', recordId)
    const t = id ? await ctx.db.get(id) : null
    if (!t?.companyId) return null
    const stocking = await ctx.db.get(t.stockingId)
    return {
      companyId: t.companyId,
      locationId: t.locationId,
      requesterId: t.createdBy,
      pending: t.status === 'pending_approval',
      subject: `Top-up of ${n(t.fishCount)} fish into ${await cageName(ctx, stocking?.cageId)}`,
    }
  }
  if (kind === 'transfer') {
    const id = ctx.db.normalizeId('fishTransfers', recordId)
    const t = id ? await ctx.db.get(id) : null
    if (!t?.companyId) return null
    const source = await ctx.db.get(t.sourceCageId)
    return {
      companyId: t.companyId,
      locationId: source?.locationId,
      requesterId: t.createdBy,
      pending: t.status === 'pending_approval',
      subject: `Transfer of ${n(t.quantity)} fish from ${await cageName(ctx, t.sourceCageId)} to ${await cageName(ctx, t.destinationCageId)}`,
    }
  }
  const id = ctx.db.normalizeId('userInvites', recordId)
  const invite = id ? await ctx.db.get(id) : null
  if (!invite) return null
  const requester = invite.requestedByUserId ? await ctx.db.get(invite.requestedByUserId) : null
  return {
    companyId: invite.companyId,
    requesterId: invite.requestedByUserId,
    pending: invite.status === 'requested',
    subject: `${requester?.name || invite.email} asked to join as ${invite.role}`,
  }
}

async function nameOf(ctx: Ctx, userId: Id<'users'> | undefined) {
  if (!userId) return 'Someone'
  const u = await ctx.db.get(userId)
  return u?.name || u?.email || 'Someone'
}

/** Call from the mutation that created a pending request, after the insert. */
export async function onApprovalRequested(ctx: MutationCtx, kind: ApprovalKind, recordId: string) {
  const a = await loadApproval(ctx, kind, recordId)
  if (!a || !a.pending) return
  const requesterName = await nameOf(ctx, a.requesterId)
  await emitDomainEvent(
    ctx,
    'approval.requested',
    { kind, recordId, subject: a.subject, requesterName },
    { companyId: a.companyId, locationId: a.locationId },
  )
  const company = await ctx.db.get(a.companyId)
  const settings = approvalAlertSettings(company)
  if (!settings.enabled || company?.status !== 'approved') return
  const approvers = (await membersWithPermission(ctx, a.companyId, KIND[kind].permission, a.locationId)).filter(
    (u) => u._id !== a.requesterId,
  )
  await notifyUsers(ctx, {
    companyId: a.companyId,
    users: approvers,
    channels: settings.channels,
    title: `${KIND[kind].label} needs approval`,
    message: `${requesterName}: ${a.subject}.`,
    link: KIND[kind].approverLink,
    dedupeKey: `approval:${kind}:${recordId}`,
    source: 'approval.requested',
  })
  if (settings.escalateAfterHours > 0) {
    await ctx.scheduler.runAfter(settings.escalateAfterHours * 3_600_000, internal.approvalAlerts.escalate, {
      kind,
      recordId,
      afterHours: settings.escalateAfterHours,
    })
  }
}

/** Call from the approve/reject mutation, after the status change. */
export async function onApprovalDecided(
  ctx: MutationCtx,
  kind: ApprovalKind,
  recordId: string,
  decision: 'approved' | 'rejected',
  decidedBy: Id<'users'>,
) {
  const a = await loadApproval(ctx, kind, recordId)
  if (!a) return
  await emitDomainEvent(
    ctx,
    'approval.decided',
    { kind, recordId, subject: a.subject, decision, decidedByName: await nameOf(ctx, decidedBy) },
    { companyId: a.companyId, locationId: a.locationId },
  )
  if (!a.requesterId || a.requesterId === decidedBy) return
  const requester = await ctx.db.get(a.requesterId)
  if (!requester || requester.active === false) return
  const company = await ctx.db.get(a.companyId)
  if (!approvalAlertSettings(company).enabled) return
  await notifyUsers(ctx, {
    companyId: a.companyId,
    users: [requester],
    channels: ['in_app'],
    title: `${KIND[kind].label} ${decision}`,
    message: `${a.subject}.`,
    link: KIND[kind].requesterLink,
    level: decision === 'approved' ? 'info' : 'warning',
    dedupeKey: `approval-decided:${kind}:${recordId}`,
    source: 'approval.decided',
  })
}

/** Scheduled by onApprovalRequested; acts only if the request is still pending. */
export const escalate = internalMutation({
  args: { kind: approvalKind, recordId: v.string(), afterHours: v.number() },
  handler: async (ctx, { kind, recordId, afterHours }) => {
    const a = await loadApproval(ctx, kind, recordId)
    if (!a || !a.pending) return { escalated: 0 }
    const company = await ctx.db.get(a.companyId)
    const settings = approvalAlertSettings(company)
    if (!settings.enabled || settings.escalateAfterHours === 0 || company?.status !== 'approved') return { escalated: 0 }
    const approvers = await membersWithPermission(ctx, a.companyId, KIND[kind].permission, a.locationId)
    const admins = await membersWithPermission(ctx, a.companyId, 'org.settings.manage')
    const users = [...approvers, ...admins].filter((u) => u._id !== a.requesterId)
    const hours = Math.round(afterHours * 10) / 10
    const { notified, deliveries } = await notifyUsers(ctx, {
      companyId: a.companyId,
      users,
      channels: settings.escalationChannels,
      title: `${KIND[kind].label} still waiting for approval`,
      message: `${a.subject} has waited more than ${hours} h.`,
      link: KIND[kind].approverLink,
      level: 'warning',
      dedupeKey: `approval-escalated:${kind}:${recordId}`,
      source: 'approval.escalated',
    })
    return { escalated: notified + deliveries }
  },
})

const CHANNEL_ORDER: NotifyChannel[] = ['in_app', 'sms', 'whatsapp', 'email']
const cleanChannels = (c: NotifyChannel[]) => CHANNEL_ORDER.filter((x) => c.includes(x))

/** Automations page: approval alert settings and the latest external sends. */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireMember(ctx, { permission: 'automation.manage' })
    if (!companyId) return null
    const company = await ctx.db.get(companyId)
    const recent = await ctx.db
      .query('notificationDispatches')
      .withIndex('by_company_and_createdAt', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(10)
    return {
      settings: approvalAlertSettings(company),
      recent: recent.map((d) => ({
        id: d._id,
        source: d.source,
        title: d.title,
        status: d.status,
        createdAt: d.createdAt,
        sent: d.deliveries.filter((x) => x.status === 'sent').length,
        failed: d.deliveries.filter((x) => x.status === 'failed').length,
        skipped: d.deliveries.filter((x) => x.status === 'skipped').length,
        error: d.error ?? null,
      })),
    }
  },
})

export const updateSettings = mutation({
  args: {
    enabled: v.boolean(),
    channels: v.array(notifyChannel),
    escalateAfterHours: v.number(),
    escalationChannels: v.array(notifyChannel),
  },
  handler: async (ctx, args) => {
    const { companyId } = await requireMember(ctx, { permission: 'automation.manage' })
    if (!companyId) throw new Error('No organization')
    const company = await ctx.db.get(companyId)
    if (!company) throw new Error('Organization not found')
    if (!Number.isFinite(args.escalateAfterHours) || args.escalateAfterHours < 0 || args.escalateAfterHours > MAX_ESCALATE_HOURS) {
      throw new Error(`Escalate after must be between 0 and ${MAX_ESCALATE_HOURS} hours`)
    }
    const next: ApprovalAlertSettings = {
      enabled: args.enabled,
      channels: cleanChannels(args.channels),
      escalateAfterHours: args.escalateAfterHours,
      escalationChannels: cleanChannels(args.escalationChannels),
    }
    if (next.enabled && !next.channels.length) throw new Error('Choose at least one channel')
    const settings = company.settings ?? { aiAssistantEnabled: false }
    await ctx.db.patch(companyId, { settings: { ...settings, approvalAlerts: next } })
    await logAudit(ctx, {
      actionType: 'approval_alerts_update',
      tableName: 'companies',
      recordId: companyId,
      previousValues: approvalAlertSettings(company),
      newValues: next,
    })
    return null
  },
})
