import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Acting for an API key (INT-004, doc 09 §8).
 *
 * Public API writes reuse the same domain helpers as the UI (for example
 * `insertDailyRecord`), which take a `user` and write audit rows through
 * `logAudit`. An API request has no signed-in user, so the httpAction's
 * internal mutation builds an actor and carries it on the ctx:
 *
 *   const apiCtx = withApiActor(ctx, actor)
 *   await insertDailyRecord(apiCtx, actor.user, input)
 *
 * The actor user is the key's creator downgraded to role 'user' and limited to
 * the key's sites, so admin-only overrides (negative stock, feed overlap) are
 * never available through the API. `logAudit` records `apiKeyId` on every row.
 *
 * The farm bot (doc 23) acts the same way for a bound chat user: the actor
 * carries `channel` instead of `apiKeyId`, see `botActorUser`.
 */
export type ApiActor = {
  readonly user: Doc<'users'>
  /** The API key, for public API writes. Absent for chat-channel writes. */
  readonly apiKeyId?: Id<'apiKeys'>
  readonly companyId: Id<'companies'>
  /**
   * The chat channel a farm-bot write came from (BOT-003, doc 23): recorded on
   * the audit row with the provider message id that carried the entry.
   */
  readonly channel?: { readonly provider: 'whatsapp' | 'telegram' | 'anowa'; readonly sourceMessageId: string }
}

type WithActor = { readonly apiActor?: ApiActor }

export function withApiActor<C extends QueryCtx | MutationCtx>(ctx: C, actor: ApiActor): C {
  return { ...ctx, apiActor: actor } as C
}

export function apiActorOf(ctx: QueryCtx | MutationCtx): ApiActor | undefined {
  return (ctx as unknown as WithActor).apiActor
}

/** The user an API key acts as: its creator, role 'user', the key's company and sites. */
export function apiActorUser(creator: Doc<'users'>, key: Doc<'apiKeys'>): Doc<'users'> {
  return {
    ...creator,
    role: 'user',
    companyId: key.companyId,
    locationIds: key.locationIds && key.locationIds.length ? key.locationIds : undefined,
    activeLocationId: undefined,
  }
}

/**
 * The user a chat binding acts as (BOT-003): the member, role 'user', the
 * binding's company and the membership's sites, so the shared write helpers
 * (listForCompany, writeLocationId) scope exactly as they do in the web app.
 */
export function botActorUser(
  user: Doc<'users'>,
  companyId: Id<'companies'>,
  siteScope: 'all' | ReadonlySet<Id<'farmLocations'>>,
  activeSiteId?: Id<'farmLocations'>,
): Doc<'users'> {
  return {
    ...user,
    role: 'user',
    companyId,
    locationIds: siteScope === 'all' ? undefined : [...siteScope],
    activeLocationId: activeSiteId,
  }
}
