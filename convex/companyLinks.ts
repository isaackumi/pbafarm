/**
 * Subsidiary links between organizations (ENT-001).
 *
 * A parent (group) organization asks to link a subsidiary by its company
 * code; an admin of the subsidiary accepts or declines. While a link is
 * active and the subsidiary shares reports, holders of group.reports.view in
 * the parent see the subsidiary's KPIs in consolidated reports (ENT-002,
 * convex/groupReports.ts) — read-only, never its records. The subsidiary can
 * stop sharing or end the link at any time; so can the parent.
 *
 * A subsidiary has at most one active parent, and two organizations cannot
 * be each other's parent.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireMember } from './lib/permissions'
import { logAudit } from './lib/tenancy'
import { userError } from './lib/errors'
import { notifyUsers } from './lib/notify'
import { membersWithPermission } from './approvalAlerts'

export const MAX_LINKS = 50

async function linksAsParent(ctx: QueryCtx, companyId: Id<'companies'>, status: Doc<'companyLinks'>['status']) {
  return await ctx.db
    .query('companyLinks')
    .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', status))
    .take(MAX_LINKS)
}

async function linksAsChild(ctx: QueryCtx, companyId: Id<'companies'>, status: Doc<'companyLinks'>['status']) {
  return await ctx.db
    .query('companyLinks')
    .withIndex('by_childCompanyId_and_status', (q) => q.eq('childCompanyId', companyId).eq('status', status))
    .take(MAX_LINKS)
}

/** Active links where `parentId` is the parent and the subsidiary shares reports. */
export async function sharingSubsidiaries(ctx: QueryCtx, parentId: Id<'companies'>) {
  return (await linksAsParent(ctx, parentId, 'active')).filter((l) => l.shareReports && l.childCompanyId !== parentId)
}

async function notifyAdmins(ctx: MutationCtx, companyId: Id<'companies'>, title: string, message: string, key: string) {
  const admins = await membersWithPermission(ctx, companyId, 'org.structure.manage')
  if (!admins.length) return
  await notifyUsers(ctx, {
    companyId,
    users: admins,
    channels: ['in_app'],
    title,
    message,
    link: '/organization-structure',
    dedupeKey: key,
    source: 'company.link',
  })
}

const companyLinkRow = v.object({
  name: v.string(),
  code: v.string(),
  _id: v.id('companyLinks'),
  status: v.union(
    v.literal('active'),
    v.literal('pending'),
    v.literal('declined'),
    v.literal('ended'),
  ),
  shareReports: v.boolean(),
  note: v.union(v.string(), v.null()),
  requestedAt: v.number(),
  respondedAt: v.union(v.number(), v.null()),
})

/** Links of the caller's organization, as parent and as subsidiary. */
export const overview = query({
  args: {},
  returns: v.object({ subsidiaries: v.array(companyLinkRow), parents: v.array(companyLinkRow) }),
  handler: async (ctx) => {
    const { companyId } = await requireMember(ctx, { permission: 'org.structure.manage' })
    if (!companyId) return { subsidiaries: [], parents: [] }
    const nameOf = async (id: Id<'companies'>) => {
      const c = await ctx.db.get(id)
      return c ? { name: c.name, code: c.code } : { name: '—', code: '' }
    }
    const shape = async (l: Doc<'companyLinks'>, other: Id<'companies'>) => ({
      _id: l._id,
      status: l.status,
      shareReports: l.shareReports,
      note: l.note ?? null,
      requestedAt: l.requestedAt,
      respondedAt: l.respondedAt ?? null,
      ...(await nameOf(other)),
    })
    const subsidiaries = []
    for (const status of ['pending', 'active'] as const) {
      for (const l of await linksAsParent(ctx, companyId, status)) subsidiaries.push(await shape(l, l.childCompanyId))
    }
    const parents = []
    for (const status of ['pending', 'active'] as const) {
      for (const l of await linksAsChild(ctx, companyId, status)) parents.push(await shape(l, l.companyId))
    }
    return { subsidiaries, parents }
  },
})

/** Parent side: ask an organization (by its company code) to become a subsidiary. */
export const request = mutation({
  args: { childCode: v.string(), note: v.optional(v.string()) },
  returns: v.id('companyLinks'),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'org.structure.manage' })
    if (!companyId) throw userError('FORBIDDEN', 'No organization')
    const code = args.childCode.trim().toUpperCase()
    if (!code) throw userError('VALIDATION', 'Enter the organization code')
    const child = await ctx.db
      .query('companies')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first()
    if (!child || child.status !== 'approved') throw userError('NOT_FOUND', 'No organization with this code')
    if (child._id === companyId) throw userError('VALIDATION', 'An organization cannot be its own subsidiary')
    const note = args.note?.trim().slice(0, 500) || undefined

    const mine = [...(await linksAsParent(ctx, companyId, 'pending')), ...(await linksAsParent(ctx, companyId, 'active'))]
    if (mine.length >= MAX_LINKS) throw userError('VALIDATION', `At most ${MAX_LINKS} subsidiaries`)
    if (mine.some((l) => l.childCompanyId === child._id)) throw userError('DUPLICATE', 'This organization is already linked or asked')
    if ((await linksAsChild(ctx, child._id, 'active')).length) {
      throw userError('CONFLICT', 'This organization is already a subsidiary of another group')
    }
    // No loops: the child must not already be our parent.
    if ((await linksAsChild(ctx, companyId, 'active')).some((l) => l.companyId === child._id)) {
      throw userError('CONFLICT', 'This organization is your parent organization')
    }
    const now = Date.now()
    const id = await ctx.db.insert('companyLinks', {
      companyId,
      childCompanyId: child._id,
      status: 'pending',
      shareReports: false,
      note,
      requestedBy: user._id,
      requestedAt: now,
      updatedAt: now,
    })
    const parent = await ctx.db.get(companyId)
    await notifyAdmins(
      ctx,
      child._id,
      'Subsidiary link request',
      `${parent?.name ?? 'An organization'} asks to link your organization as a subsidiary.`,
      `company-link:${id}:requested`,
    )
    await logAudit(ctx, { actionType: 'create', tableName: 'companyLinks', recordId: id, newValues: { childCompanyId: child._id, note } })
    return id
  },
})

async function ownLink(ctx: QueryCtx, companyId: Id<'companies'>, linkId: Id<'companyLinks'>, side: 'child' | 'either') {
  const link = await ctx.db.get(linkId)
  const isChild = link?.childCompanyId === companyId
  const isParent = link?.companyId === companyId
  if (!link || !(isChild || (side === 'either' && isParent))) throw userError('NOT_FOUND', 'Link not found')
  return link
}

/** Subsidiary side: accept (optionally sharing reports) or decline. */
export const respond = mutation({
  args: { linkId: v.id('companyLinks'), accept: v.boolean(), shareReports: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'org.structure.manage' })
    if (!companyId) throw userError('FORBIDDEN', 'No organization')
    const link = await ownLink(ctx, companyId, args.linkId, 'child')
    if (link.status !== 'pending') throw userError('CONFLICT', 'This request was already answered')
    if (args.accept && (await linksAsChild(ctx, companyId, 'active')).length) {
      throw userError('CONFLICT', 'Your organization is already a subsidiary of another group')
    }
    const now = Date.now()
    await ctx.db.patch(link._id, {
      status: args.accept ? 'active' : 'declined',
      shareReports: args.accept ? (args.shareReports ?? true) : false,
      respondedBy: user._id,
      respondedAt: now,
      updatedAt: now,
    })
    const child = await ctx.db.get(companyId)
    await notifyAdmins(
      ctx,
      link.companyId,
      args.accept ? 'Subsidiary linked' : 'Subsidiary link declined',
      `${child?.name ?? 'The organization'} ${args.accept ? 'accepted' : 'declined'} your link request.`,
      `company-link:${link._id}:${args.accept ? 'accepted' : 'declined'}`,
    )
    await logAudit(ctx, { actionType: 'update', tableName: 'companyLinks', recordId: link._id, newValues: args })
    return null
  },
})

/** Subsidiary side: start or stop sharing reports with the parent. */
export const setShareReports = mutation({
  args: { linkId: v.id('companyLinks'), shareReports: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { companyId } = await requireMember(ctx, { permission: 'org.structure.manage' })
    if (!companyId) throw userError('FORBIDDEN', 'No organization')
    const link = await ownLink(ctx, companyId, args.linkId, 'child')
    if (link.status !== 'active') throw userError('CONFLICT', 'The link is not active')
    await ctx.db.patch(link._id, { shareReports: args.shareReports, updatedAt: Date.now() })
    await logAudit(ctx, { actionType: 'update', tableName: 'companyLinks', recordId: link._id, newValues: args })
    return null
  },
})

/** Either side: end an active link or withdraw a pending request. */
export const end = mutation({
  args: { linkId: v.id('companyLinks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'org.structure.manage' })
    if (!companyId) throw userError('FORBIDDEN', 'No organization')
    const link = await ownLink(ctx, companyId, args.linkId, 'either')
    if (link.status !== 'active' && link.status !== 'pending') throw userError('CONFLICT', 'The link already ended')
    const now = Date.now()
    await ctx.db.patch(link._id, { status: 'ended', shareReports: false, endedBy: user._id, endedAt: now, updatedAt: now })
    const other = link.companyId === companyId ? link.childCompanyId : link.companyId
    await notifyAdmins(ctx, other, 'Subsidiary link ended', 'A link between your organization and another was ended.', `company-link:${link._id}:ended`)
    await logAudit(ctx, { actionType: 'update', tableName: 'companyLinks', recordId: link._id, newValues: { status: 'ended' } })
    return null
  },
})
