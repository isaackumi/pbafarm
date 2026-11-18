/**
 * Exactly-once field writes (MOBILE-002, doc 12 §6.4).
 *
 * A phone that loses the response to a save cannot tell whether the server
 * wrote it, so its outbox sends the same request again. A mutation defined
 * with `idempotentMutation(name, { args, handler })` accepts an optional
 * `clientMutationId`: the first result is stored with that key, and a repeat
 * from the same user returns it without running the handler again. Lookup and
 * write share the mutation's transaction, so two racing retries cannot both
 * write.
 *
 * Calls without `clientMutationId` run exactly as before, and the handler
 * never sees the key (records and audit rows are unchanged).
 */
import { v } from 'convex/values'
import type { ObjectType, PropertyValidators } from 'convex/values'
import { mutation } from '../_generated/server'
import type { MutationCtx } from '../_generated/server'
import { requireUser } from './authz'
import { userError } from './errors'

/** Keys are kept this long, then pruned (outboxes retry for days, not months). */
export const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export const MAX_CLIENT_MUTATION_ID_LENGTH = 128

/**
 * Run `run` once per (user, key). Returns the stored result on a repeat.
 * Exported for tests and for mutations that cannot use the builder.
 */
export async function runOnce<R>(
  ctx: MutationCtx,
  name: string,
  clientMutationId: string | undefined,
  run: () => Promise<R>,
): Promise<R> {
  if (clientMutationId === undefined) return run()
  const key = clientMutationId.trim()
  if (!key || key.length > MAX_CLIENT_MUTATION_ID_LENGTH) {
    throw userError('VALIDATION', 'Invalid client mutation id')
  }
  const user = await requireUser(ctx)
  const seen = await ctx.db
    .query('idempotencyKeys')
    .withIndex('by_user_and_key', (q) => q.eq('userId', user._id).eq('key', key))
    .unique()
  if (seen) {
    if (seen.mutation !== name) {
      throw userError('CONFLICT', 'This entry id was already used for a different save')
    }
    return seen.result as R
  }
  const result = await run()
  await ctx.db.insert('idempotencyKeys', {
    userId: user._id,
    key,
    mutation: name,
    result: result === undefined ? null : result,
    createdAt: Date.now(),
  })
  return result
}

/** `mutation({ args, handler })` plus an optional `clientMutationId` replay key. */
export function idempotentMutation<Args extends PropertyValidators, R>(
  name: string,
  def: {
    args: Args
    handler: (ctx: MutationCtx, args: ObjectType<Args>) => Promise<R>
  },
) {
  return mutation({
    args: { ...def.args, clientMutationId: v.optional(v.string()) },
    handler: async (ctx, all): Promise<R> => {
      const { clientMutationId, ...args } = all as ObjectType<Args> & {
        clientMutationId?: string
      }
      return runOnce(ctx, name, clientMutationId, () =>
        def.handler(ctx, args as unknown as ObjectType<Args>),
      )
    },
  })
}
