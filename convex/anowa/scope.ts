/**
 * Who Ask Anowa acts as in the web app: the signed-in member, never an id
 * the model or the browser supplies. Built on every tool call, every draft
 * read and every confirm, so a role or site change takes effect at once.
 *
 * Writes go through the same helpers as the web forms with the member
 * downgraded to role 'user' and limited to their sites (botActorUser), like
 * the chat bot, so admin-only overrides (negative stock, feed overlap) are
 * never reachable from a draft. Audit rows carry channel 'anowa' ("you, via
 * Anowa") and the draft group as the source.
 */
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { assertSiteInScope, type MemberContext } from '../lib/permissions'
import { userError } from '../lib/errors'
import { botActorUser, withApiActor } from '../lib/apiActor'
import { actAsSessionOf } from '../lib/actAs'
import { botLocale } from '../bot/i18n'
import type { MemberScope } from '../bot/scope'

export type WebMember = MemberScope & {
  /** The real user row. */
  account: Doc<'users'>
  /** The scoped actor the shared write helpers receive. */
  actor: Doc<'users'>
}

/**
 * `member` comes from requireMember(ctx, { permission: 'ai.use' }) in the
 * calling function: every Ask Anowa function needs the assistant permission.
 */
export async function webMember(
  ctx: QueryCtx | MutationCtx,
  member: MemberContext,
  siteId?: Id<'farmLocations'> | null,
): Promise<WebMember> {
  const account = member.user
  const companyId = member.companyId
  if (!companyId) throw userError('FORBIDDEN', 'Your account is not linked to an organization')
  const company = await ctx.db.get(companyId)
  if (!company || company.status !== 'approved') throw userError('FORBIDDEN', 'Your organization is not active')
  let site: Doc<'farmLocations'> | null = null
  if (siteId) {
    const s = await ctx.db.get(siteId)
    if (!s || s.companyId !== companyId) throw userError('NOT_FOUND', 'Site not found')
    assertSiteInScope(member, siteId)
    site = s
  }
  return {
    binding: { companyId },
    account,
    actor: botActorUser(account, companyId, member.siteScope, site?._id),
    member,
    company,
    site,
    locale: botLocale(account.locale),
  }
}

/**
 * Drafting and confirming change records as the member through a channel
 * actor, whose audit rows do not carry a support session (lib/tenancy
 * logAudit). During support access (ENT-006) those writes would not be
 * attributed to the session, so Ask Anowa refuses them; use the forms.
 */
export function assertNotSupportAccess(w: WebMember) {
  if (actAsSessionOf(w.account)) {
    throw userError('FORBIDDEN', 'Ask Anowa cannot change records during support access. Use the forms.')
  }
}

/** A mutation ctx whose audit rows and domain events say "via Anowa". */
export function anowaCtx(ctx: MutationCtx, w: WebMember, draftGroup: string): MutationCtx {
  return withApiActor(ctx, {
    user: w.actor,
    companyId: w.binding.companyId,
    channel: { provider: 'anowa', sourceMessageId: draftGroup },
  })
}
