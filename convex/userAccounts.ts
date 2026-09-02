import {
  createAccount,
  getAuthUserId,
  modifyAccountCredentials,
  retrieveAccount,
} from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { action } from './_generated/server'
import { api, internal } from './_generated/api'

function assertPassword(password: string) {
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters long')
  }
}

/** Admin: create a login-ready user with a temporary password. */
export const createWithPassword = action({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.union(v.literal('user'), v.literal('admin'))),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await ctx.runQuery(api.users.current, {})
    if (!me) throw new Error('Not authenticated')
    const myRole = me.role ?? 'user'
    if (myRole !== 'admin' && myRole !== 'super_admin') {
      throw new Error('Insufficient permissions')
    }
    if (!me.companyId) throw new Error('No company linked')

    const email = args.email.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      throw new Error('A valid email is required')
    }
    assertPassword(args.password)

    const role = args.role || 'user'
    const name = args.name?.trim() || undefined

    const existing = await ctx.runQuery(internal.users.emailExists, {
      email,
    })
    if (existing.exists) {
      throw new Error(
        'An account with this email already exists. Invite/assign them instead, or ask them to change their password after signing in.',
      )
    }

    const { user } = await createAccount(ctx, {
      provider: 'password',
      account: { id: email, secret: args.password },
      profile: {
        email,
        name,
        role: 'user',
        active: true,
        mustChangePassword: true,
      },
    })

    await ctx.runMutation(internal.users.finalizeCreatedUser, {
      userId: user._id,
      companyId: me.companyId,
      role,
      name,
      actorId: me._id,
    })

    return {
      status: 'created' as const,
      userId: user._id,
      email,
      mustChangePassword: true,
      message:
        'User created. Share the temporary password securely — they must change it on first login.',
    }
  },
})

/** Logged-in user: verify current password, set a new one. */
export const changePassword = action({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const me = await ctx.runQuery(api.users.current, {})
    if (!me?.email) throw new Error('Your account has no email on file')

    assertPassword(args.newPassword)
    if (args.newPassword === args.currentPassword) {
      throw new Error('New password must be different from the current password')
    }

    try {
      await retrieveAccount(ctx, {
        provider: 'password',
        account: { id: me.email.toLowerCase(), secret: args.currentPassword },
      })
    } catch {
      throw new Error('Current password is incorrect')
    }

    await modifyAccountCredentials(ctx, {
      provider: 'password',
      account: { id: me.email.toLowerCase(), secret: args.newPassword },
    })

    await ctx.runMutation(internal.users.clearMustChangePassword, {
      userId,
    })

    return { ok: true }
  },
})
