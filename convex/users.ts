import { getAuthUserId } from '@convex-dev/auth/server'
import { query, mutation } from './_generated/server'
import { v } from 'convex/values'

export const current = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    return await ctx.db.get(userId)
  },
})

/** Dev/bootstrap: promote a user to super_admin by email after first signup. */
export const promoteToSuperAdmin = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email))
      .unique()
    if (!user) {
      throw new Error(`No user found for email: ${email}`)
    }
    await ctx.db.patch(user._id, { role: 'super_admin' })
    return user._id
  },
})
