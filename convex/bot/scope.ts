/**
 * Who a chat binding acts as, re-checked on every message and every write
 * (doc 23 §3-4). Never takes a company or site from the message or the LLM:
 * both come from the binding row, and the member's permissions and site
 * scope come from their membership, exactly as for the web app.
 */
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { botActorUser, withApiActor } from '../lib/apiActor'
import { memberContextIn, type MemberContext } from '../lib/permissions'
import { todayIn, zoneFor } from '../lib/dates'
import { botLocale, type BotLocale } from './i18n'

type Ctx = QueryCtx | MutationCtx

export type BindingProblem = 'revoked' | 'user_inactive' | 'phone_unverified' | 'company_inactive' | 'not_member'

export type BoundMember = {
  binding: Doc<'channelBindings'>
  /** The real user row. */
  account: Doc<'users'>
  /** The scoped actor the shared write helpers receive (role 'user'). */
  actor: Doc<'users'>
  member: MemberContext
  company: Doc<'companies'>
  /** The binding's active site when still in scope, else undefined (= all in scope). */
  site: Doc<'farmLocations'> | null
  locale: BotLocale
}

/**
 * What scope checks and draft validation need: the company, the member's
 * permissions and sites, an optional active site and the locale. A chat
 * binding (BoundMember) is one; Ask Anowa in the web app builds one from the
 * signed-in member (convex/anowa/scope.ts).
 */
export type MemberScope = {
  binding: { companyId: Id<'companies'> }
  member: MemberContext
  company: Doc<'companies'>
  site: Doc<'farmLocations'> | null
  locale: BotLocale
}

/** The checks a binding must pass; WhatsApp also needs the bound number to still be the user's verified phone. */
export async function checkBinding(
  ctx: Ctx,
  binding: Doc<'channelBindings'>,
): Promise<{ ok: true; bound: BoundMember } | { ok: false; problem: BindingProblem; locale: BotLocale }> {
  const account = await ctx.db.get(binding.userId)
  const locale = botLocale(account?.locale)
  if (binding.revokedAt) return { ok: false, problem: 'revoked', locale }
  if (!account || account.active === false) return { ok: false, problem: 'user_inactive', locale }
  if (binding.provider === 'whatsapp' && (account.phone !== binding.address || !account.phoneVerificationTime)) {
    return { ok: false, problem: 'phone_unverified', locale }
  }
  const company = await ctx.db.get(binding.companyId)
  if (!company || company.status !== 'approved') return { ok: false, problem: 'company_inactive', locale }
  const member = await memberContextIn(ctx, account, binding.companyId)
  if (!member) return { ok: false, problem: 'not_member', locale }
  let site: Doc<'farmLocations'> | null = null
  if (binding.activeSiteId) {
    const s = await ctx.db.get(binding.activeSiteId)
    if (s && s.companyId === binding.companyId && s.active !== false && (member.siteScope === 'all' || member.siteScope.has(s._id))) {
      site = s
    }
  }
  const actor = botActorUser(account, binding.companyId, member.siteScope, site?._id)
  return { ok: true, bound: { binding, account, actor, member, company, site, locale } }
}

/** A mutation ctx whose audit rows and domain events carry the chat channel. */
export function botCtx(ctx: MutationCtx, bound: BoundMember, sourceMessageId: string): MutationCtx {
  return withApiActor(ctx, {
    user: bound.actor,
    companyId: bound.binding.companyId,
    channel: { provider: bound.binding.provider, sourceMessageId },
  })
}

/** Units the binding may see: the active site, else every site in scope. Archived units excluded. */
export async function unitsInScope(ctx: Ctx, bound: MemberScope, cap = 300): Promise<Doc<'cages'>[]> {
  const companyId = bound.binding.companyId
  const rows = bound.site
    ? await ctx.db
        .query('cages')
        .withIndex('by_company_location', (q) => q.eq('companyId', companyId).eq('locationId', bound.site!._id))
        .take(cap)
    : await ctx.db
        .query('cages')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(cap)
  return rows.filter((c) => !c.archivedAt && inScope(bound, c.locationId))
}

export function inScope(bound: MemberScope, locationId: Id<'farmLocations'> | undefined): boolean {
  if (bound.member.siteScope === 'all') return true
  return !!locationId && bound.member.siteScope.has(locationId)
}

/** Normalise a unit name or code for matching what the user typed. */
export function unitKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(cage|pond|tank|unit|bassin|etang|étang|unité|unite)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Find one unit by the name/code the user gave; ambiguous or unknown → null with candidates. */
export function matchUnit(units: Doc<'cages'>[], typed: string): { unit: Doc<'cages'> | null; candidates: string[] } {
  const key = unitKey(typed)
  if (!key) return { unit: null, candidates: [] }
  const exact = units.filter((u) => unitKey(u.name) === key || (u.code && unitKey(u.code) === key))
  if (exact.length === 1) return { unit: exact[0], candidates: [] }
  const partial = exact.length ? exact : units.filter((u) => unitKey(u.name).includes(key))
  if (partial.length === 1) return { unit: partial[0], candidates: [] }
  return { unit: null, candidates: partial.slice(0, 8).map((u) => u.name) }
}

/** The farm date of a message: its timestamp in the unit's site timezone (or the company's). */
export async function farmDate(ctx: Ctx, bound: MemberScope, locationId: Id<'farmLocations'> | undefined, at: number) {
  const site = locationId ? await ctx.db.get(locationId) : bound.site
  return todayIn(zoneFor(site, bound.company), at)
}

/** The chat's live binding (Telegram: a private chat id is the user id, so a group sender's id finds theirs). */
export async function liveBinding(ctx: Ctx, provider: 'whatsapp' | 'telegram', address: string) {
  const rows = await ctx.db
    .query('channelBindings')
    .withIndex('by_provider_and_address', (q) => q.eq('provider', provider).eq('address', address))
    .take(20)
  return rows.find((b) => !b.revokedAt) ?? null
}

/** Organizations the user is an active member of (approved companies only). */
export async function companiesOf(ctx: Ctx, user: Doc<'users'>) {
  const rows = await ctx.db
    .query('memberships')
    .withIndex('by_userId', (q) => q.eq('userId', user._id))
    .take(50)
  const out: Doc<'companies'>[] = []
  for (const m of rows) {
    if (m.status !== 'active') continue
    const c = await ctx.db.get(m.companyId)
    if (c && c.status === 'approved' && (await memberContextIn(ctx, user, c._id))) out.push(c)
  }
  return out
}
