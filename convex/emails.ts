import { v } from 'convex/values'
import { internalAction, internalQuery } from './_generated/server'
import { pickEmailAdapter } from './lib/email'

/** Send one email through the platform adapter. Scheduled by mutations. */
export const send = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    html: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, message) => {
    await pickEmailAdapter().send(message)
    return null
  },
})

/** Language of the account behind an address, for account emails (password reset). */
export const recipientLocale = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email.trim().toLowerCase()))
      .first()
    return user?.locale ?? null
  },
})
