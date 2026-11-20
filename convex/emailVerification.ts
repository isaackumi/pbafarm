/**
 * Email verification for signed-in users (SEC-005, closes doc 07 V3): a
 * 6-digit code is emailed; entering it sets users.emailVerificationTime.
 * Accepting an invite requires a verified email (memberships.acceptInvite).
 *
 * App-level rather than Convex Auth `verify` so sign-up keeps working on
 * deployments without an email provider configured.
 */
import { v } from 'convex/values'
import { userError } from './lib/errors'
import { mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { randomDigits, sha256Hex } from './lib/tokens'
import { requireAccount } from './lib/permissions'
import { emailContext, verificationCodeEmail } from './lib/emailTemplates'

const CODE_TTL_MS = 15 * 60 * 1000
const RESEND_AFTER_MS = 60 * 1000
const MAX_ATTEMPTS = 5

export const status = query({
  args: {},
  returns: v.object({ email: v.union(v.string(), v.null()), verified: v.boolean() }),
  handler: async (ctx) => {
    const me = await requireAccount(ctx)
    return {
      email: me.email ?? null,
      verified: !!me.emailVerificationTime,
    }
  },
})

export const requestCode = mutation({
  args: {},
  returns: v.object({ alreadyVerified: v.boolean() }),
  handler: async (ctx) => {
    const me = await requireAccount(ctx)
    if (!me.email) throw userError('VALIDATION', 'Your account has no email on file')
    if (me.emailVerificationTime) return { alreadyVerified: true }
    const now = Date.now()
    const prior = await ctx.db
      .query('emailVerifications')
      .withIndex('by_userId', (q) => q.eq('userId', me._id))
      .unique()
    if (prior) {
      if (now - prior._creationTime < RESEND_AFTER_MS) {
        throw userError('RATE_LIMITED', 'A code was just sent. Wait a minute before asking for another.')
      }
      await ctx.db.delete(prior._id)
    }
    const code = randomDigits(6)
    await ctx.db.insert('emailVerifications', {
      userId: me._id,
      email: me.email,
      codeHash: await sha256Hex(`${me._id}:${code}`),
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
    })
    const mail = verificationCodeEmail(emailContext(me.locale), {
      name: me.name,
      code,
      minutes: CODE_TTL_MS / 60_000,
    })
    await ctx.scheduler.runAfter(0, internal.emails.send, {
      to: me.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
    return { alreadyVerified: false }
  },
})

export const verify = mutation({
  args: { code: v.string() },
  returns: v.object({ verified: v.boolean() }),
  handler: async (ctx, { code }) => {
    const me = await requireAccount(ctx)
    if (me.emailVerificationTime) return { verified: true }
    const row = await ctx.db
      .query('emailVerifications')
      .withIndex('by_userId', (q) => q.eq('userId', me._id))
      .unique()
    if (!row || row.email !== me.email) throw userError('CONFLICT', 'Ask for a new code')
    if (row.expiresAt < Date.now()) throw userError('CONFLICT', 'This code has expired. Ask for a new one.')
    if (row.attempts >= MAX_ATTEMPTS) throw userError('RATE_LIMITED', 'Too many attempts. Ask for a new code.')
    const ok = row.codeHash === (await sha256Hex(`${me._id}:${code.trim()}`))
    if (!ok) {
      await ctx.db.patch(row._id, { attempts: row.attempts + 1 })
      return { verified: false }
    }
    await ctx.db.delete(row._id)
    await ctx.db.patch(me._id, { emailVerificationTime: Date.now() })
    return { verified: true }
  },
})
