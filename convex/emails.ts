import { v } from 'convex/values'
import { internalAction } from './_generated/server'
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
