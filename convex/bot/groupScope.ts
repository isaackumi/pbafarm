/**
 * Effective access in a Telegram group (VFQ-1): the intersection of the
 * group's site scope and capabilities with the sender's own role and sites.
 * A group never gives a person more than their role allows; it can only take
 * away (sites outside the group, money, buyers, data entry).
 *
 * `boundFor` is what every bot read, agent turn and draft calls: the sender's
 * binding is re-checked (checkBinding: account, company, membership), then,
 * in a group, the group must be live and belong to the binding's company.
 */
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { botActorUser } from '../lib/apiActor'
import { ADMIN_ONLY, type MemberContext, type Permission } from '../lib/permissions'
import { checkBinding, type BoundMember } from './scope'

type Ctx = QueryCtx | MutationCtx

export type GroupCaps = Doc<'botChatGroups'>['caps']
export type SiteScope = MemberContext['siteScope']

export const DEFAULT_CAPS: GroupCaps = { ask: true, log: true, alerts: true, money: false, buyers: false }

/** Costs, prices, revenue, margins and project spend. */
export function isMoneyPermission(p: Permission): boolean {
  return (
    p.startsWith('finance.') ||
    p.startsWith('projects.') ||
    p === 'inventory.prices.manage' ||
    p === 'production.plan.manage'
  )
}

/** Customers and sales to buyers. */
const BUYER_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'finance.sales.record',
  'finance.sales.correct',
  'hatchery.dispatch',
])

/** Reading only: what stays when logging is off in the group. */
function isReadPermission(p: Permission): boolean {
  return p.endsWith('.view') || p === 'ai.use'
}

/** The group's sites as the member-scope shape. */
export function groupSiteScope(group: Pick<Doc<'botChatGroups'>, 'siteScope'>): SiteScope {
  return group.siteScope === 'all' ? 'all' : new Set(group.siteScope)
}

/** Sites both may see. */
export function intersectScope(a: SiteScope, b: SiteScope): SiteScope {
  if (a === 'all') return b === 'all' ? 'all' : new Set(b)
  if (b === 'all') return new Set(a)
  return new Set([...a].filter((id) => b.has(id)))
}

/**
 * The member as seen from the group: their permissions minus what the group
 * has switched off (and minus admin settings, which are never used from a
 * chat), and their sites intersected with the group's.
 */
export function narrowMember(member: MemberContext, group: Pick<Doc<'botChatGroups'>, 'siteScope' | 'caps'>): MemberContext {
  const admin = new Set<Permission>(ADMIN_ONLY)
  const permissions = new Set<Permission>()
  for (const p of member.permissions) {
    if (admin.has(p)) continue
    if (!group.caps.money && isMoneyPermission(p)) continue
    if (!group.caps.buyers && BUYER_PERMISSIONS.has(p)) continue
    if (!group.caps.log && !isReadPermission(p)) continue
    permissions.add(p)
  }
  return { ...member, permissions, siteScope: intersectScope(member.siteScope, groupSiteScope(group)) }
}

export function scopeIsEmpty(scope: SiteScope): boolean {
  return scope !== 'all' && scope.size === 0
}

/** A live, linked group of this provider chat (pending and revoked rows do not count). */
export async function activeGroupByChat(ctx: Ctx, chatId: string): Promise<Doc<'botChatGroups'> | null> {
  const rows = await ctx.db
    .query('botChatGroups')
    .withIndex('by_provider_and_chatId', (q) => q.eq('provider', 'telegram').eq('chatId', chatId))
    .take(20)
  return rows.find((g) => g.status === 'active') ?? null
}

export type GroupProblem = 'not_connected' | 'group_inactive' | 'wrong_company' | 'no_sites' | 'site_out_of_scope'

/**
 * The sender in the group: checkBinding, then the group's company must be the
 * binding's, and the scope narrows to the group. `siteId` (a site the scope
 * resolver found) must be inside the result.
 */
export async function groupBound(
  ctx: Ctx,
  bound: BoundMember,
  group: Doc<'botChatGroups'>,
  siteId?: Id<'farmLocations'>,
): Promise<{ ok: true; bound: BoundMember } | { ok: false; problem: GroupProblem }> {
  if (group.status !== 'active') return { ok: false, problem: 'group_inactive' }
  if (group.companyId !== bound.binding.companyId) return { ok: false, problem: 'wrong_company' }
  const member = narrowMember(bound.member, group)
  if (scopeIsEmpty(member.siteScope)) return { ok: false, problem: 'no_sites' }
  return withSite(ctx, { ...bound, member }, siteId)
}

async function withSite(
  ctx: Ctx,
  bound: BoundMember,
  siteId: Id<'farmLocations'> | undefined,
): Promise<{ ok: true; bound: BoundMember } | { ok: false; problem: GroupProblem }> {
  const scope = bound.member.siteScope
  const reach = (s: Doc<'farmLocations'> | null) =>
    !!s && s.companyId === bound.binding.companyId && s.active !== false && (scope === 'all' || scope.has(s._id))
  let site = bound.site && reach(bound.site) ? bound.site : null
  if (siteId) {
    const s = await ctx.db.get(siteId)
    if (!reach(s)) return { ok: false, problem: 'site_out_of_scope' }
    site = s
  }
  const actor = botActorUser(bound.account, bound.binding.companyId, scope, site?._id)
  return { ok: true, bound: { ...bound, site, actor } }
}

/**
 * The binding as it may act now: in a group (chatGroupId) narrowed to the
 * group; with siteId, on that site for this turn. Every read, agent turn and
 * draft from the bot goes through here.
 */
export async function boundFor(
  ctx: Ctx,
  bindingId: Id<'channelBindings'>,
  opts: { chatGroupId?: Id<'botChatGroups'>; siteId?: Id<'farmLocations'> } = {},
): Promise<{ ok: true; bound: BoundMember; group: Doc<'botChatGroups'> | null } | { ok: false; error: string }> {
  const binding = await ctx.db.get(bindingId)
  if (!binding) return { ok: false, error: 'not connected' }
  const checked = await checkBinding(ctx, binding)
  if (!checked.ok) return { ok: false, error: 'not connected' }
  if (opts.chatGroupId) {
    const group = await ctx.db.get(opts.chatGroupId)
    if (!group) return { ok: false, error: 'not connected' }
    const g = await groupBound(ctx, checked.bound, group, opts.siteId)
    return g.ok ? { ok: true, bound: g.bound, group } : { ok: false, error: g.problem === 'site_out_of_scope' ? 'site out of scope' : 'not connected' }
  }
  if (!opts.siteId) return { ok: true, bound: checked.bound, group: null }
  const s = await withSite(ctx, checked.bound, opts.siteId)
  return s.ok ? { ok: true, bound: s.bound, group: null } : { ok: false, error: 'site out of scope' }
}
