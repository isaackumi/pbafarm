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
 */
export type ApiActor = {
  readonly user: Doc<'users'>
  readonly apiKeyId: Id<'apiKeys'>
  readonly companyId: Id<'companies'>
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
