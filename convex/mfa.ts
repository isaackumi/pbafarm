import { insertAuditLog } from './lib/auditChain'
import { v } from 'convex/values'
import { getAuthSessionId } from '@convex-dev/auth/server'
import { action, internalMutation } from './_generated/server'
import type { ActionCtx, MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { requireUser } from './lib/authz'
import { randomDigits, sha256Hex } from './lib/crypto'
import { maskPhone, normalizePhone } from './lib/phone'
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  rateLimiter,
  retryAfterText,
} from './lib/rateLimits'
import { channelAvailable, deliverMessage } from './messaging/deliver'
import { messagingPrefs } from './messaging/channels'
import { securityPolicy } from './messaging/policy'
import { assertPhoneFree } from './users'

/**
 * Two-step verification per sign-in session (SEC-007, doc 18 §8).
 *
 * When the user's company requires it, requireUser refuses MFA_REQUIRED until
 * this session has a verified mfaSessions row. These functions are the only
 * ones (with users.current and sign-out) that work before that.
 * Users without a phone enrol one: the code goes to the new number and the
 * number is saved when the code is entered.
 */

const phoneChannel = v.union(v.literal('sms'), v.literal('whatsapp'))

function challengeHash(sessionId: string, code: string) {
  return sha256Hex(`mfa:${sessionId}:${code}`)
}

async function sessionRow(ctx: MutationCtx, sessionId: Id<'authSessions'>) {
  return await ctx.db
    .query('mfaSessions')
    .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
    .first()
}

/** Drop rows of this user's sessions that no longer exist (signed out, expired). */
async function pruneStaleRows(ctx: MutationCtx, userId: Id<'users'>) {
  const rows = await ctx.db
    .query('mfaSessions')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .take(50)
  for (const row of rows) {
    if (!(await ctx.db.get(row.sessionId))) await ctx.db.delete(row._id)
  }
}

/** Internal: store a pending code for this session and say where to send it. */
export const issueChallenge = internalMutation({
  args: {
    purpose: v.union(v.literal('verify'), v.literal('enrol')),
    channel: phoneChannel,
    phone: v.optional(v.string()),
    /** Hash of the code, bound to this session (computed in the action). */
    codeHash: v.string(),
  },
  returns: v.object({ to: v.string(), companyId: v.id('companies') }),
  handler: async (ctx, args): Promise<{ to: string; companyId: Id<'companies'> }> => {
    const user = await requireUser(ctx, { allowPendingMfa: true })
    const sessionId = (await getAuthSessionId(ctx)) as Id<'authSessions'> | null
    if (!sessionId || !user.companyId) throw new Error('Two-step verification is not needed for this account.')
    const company = await ctx.db.get(user.companyId)
    const policy = securityPolicy(company)
    if (!policy.require2fa) throw new Error('Your company does not require two-step verification.')
    if (!(await channelAvailable(ctx, user.companyId, args.channel))) {
      throw new Error(`Codes cannot be sent by ${args.channel === 'sms' ? 'SMS' : 'WhatsApp'} right now. Try the other option or ask your admin.`)
    }

    let to: string
    let pendingPhone: string | undefined
    if (args.purpose === 'enrol') {
      if (user.phone) throw new Error('Your account already has a phone number. Ask an admin to change it.')
      const normalized = normalizePhone(args.phone, messagingPrefs(company).defaultCountryCode)
      if (!normalized) throw new Error('Enter a valid phone number')
      await assertPhoneFree(ctx, normalized, user._id)
      to = normalized
      pendingPhone = normalized
    } else {
      if (!user.phone) throw new Error('Add your phone number first.')
      to = user.phone
    }

    const existing = await sessionRow(ctx, sessionId)
    const now = Date.now()
    if (existing?.verifiedAt) throw new Error('This sign-in is already verified.')
    if (existing?.lastSentAt && now - existing.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
      throw new Error(`Wait a moment before asking for another code. ${retryAfterText(OTP_RESEND_COOLDOWN_MS - (now - existing.lastSentAt))}`)
    }
    const limit = await rateLimiter.limit(ctx, 'mfaCodePerUser', { key: user._id })
    if (!limit.ok) throw new Error(`Too many codes requested. ${retryAfterText(limit.retryAfter)}`)

    const fields = {
      userId: user._id,
      sessionId,
      companyId: user.companyId,
      purpose: args.purpose,
      channel: args.channel,
      codeHash: args.codeHash,
      pendingPhone,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      lastSentAt: now,
    }
    if (existing) await ctx.db.replace(existing._id, fields)
    else {
      await pruneStaleRows(ctx, user._id)
      await ctx.db.insert('mfaSessions', fields)
    }
    return { to, companyId: user.companyId }
  },
})

async function sendChallenge(
  ctx: ActionCtx,
  args: { purpose: 'verify' | 'enrol'; channel: 'sms' | 'whatsapp'; phone?: string },
) {
  const sessionId = await getAuthSessionId(ctx)
  if (!sessionId) throw new Error('Not authenticated')
  const code = randomDigits(6)
  const target: { to: string; companyId: Id<'companies'> } = await ctx.runMutation(
    internal.mfa.issueChallenge,
    { ...args, codeHash: await challengeHash(sessionId, code) },
  )
  const result = await deliverMessage(ctx, target.companyId, {
    to: target.to,
    channel: args.channel,
    body: `Your PBA Farm verification code is ${code}. It expires in 10 minutes. Do not share it.`,
    otpCode: code,
  })
  if (!result.ok) {
    console.warn(`Verification code not sent (${args.channel}, ${result.route}): ${result.error}`)
    return {
      ok: false,
      sentTo: maskPhone(target.to),
      error: 'Could not send the code. Try the other option, or ask your admin to check the messaging settings.',
    }
  }
  return { ok: true, sentTo: maskPhone(target.to), error: null }
}

/** Send a code to the user's phone for this sign-in. */
export const startChallenge = action({
  args: { channel: phoneChannel },
  handler: async (ctx, { channel }): Promise<{ ok: boolean; sentTo: string; error: string | null }> =>
    sendChallenge(ctx, { purpose: 'verify', channel }),
})

/** No phone on the account yet: send a code to a new number to enrol it. */
export const startEnrolment = action({
  args: { phone: v.string(), channel: phoneChannel },
  handler: async (ctx, { phone, channel }): Promise<{ ok: boolean; sentTo: string; error: string | null }> =>
    sendChallenge(ctx, { purpose: 'enrol', channel, phone }),
})

/** Internal: check a code for this session; verifies the session on success. */
export const checkChallenge = internalMutation({
  args: { codeHash: v.optional(v.string()) },
  returns: v.object({ ok: v.boolean(), error: v.union(v.string(), v.null()) }),
  handler: async (ctx, { codeHash }): Promise<{ ok: boolean; error: string | null }> => {
    const user = await requireUser(ctx, { allowPendingMfa: true })
    const sessionId = (await getAuthSessionId(ctx)) as Id<'authSessions'> | null
    if (!sessionId) throw new Error('Not authenticated')
    const row = await sessionRow(ctx, sessionId)
    if (!row || row.userId !== user._id) return { ok: false, error: 'Ask for a code first.' }
    if (row.verifiedAt) return { ok: true, error: null }
    if (!row.codeHash || !row.expiresAt || row.expiresAt < Date.now()) {
      return { ok: false, error: 'This code has expired. Ask for a new one.' }
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      return { ok: false, error: 'Too many wrong codes. Ask for a new one.' }
    }
    if (!codeHash || codeHash !== row.codeHash) {
      const attempts = row.attempts + 1
      await ctx.db.patch(row._id, {
        attempts,
        ...(attempts >= OTP_MAX_ATTEMPTS ? { codeHash: undefined } : {}),
      })
      return {
        ok: false,
        error: attempts >= OTP_MAX_ATTEMPTS ? 'Too many wrong codes. Ask for a new one.' : 'That code is not right.',
      }
    }
    const now = Date.now()
    await ctx.db.patch(row._id, {
      verifiedAt: now,
      method: 'otp',
      codeHash: undefined,
      expiresAt: undefined,
    })
    if (row.purpose === 'enrol' && row.pendingPhone) {
      await assertPhoneFree(ctx, row.pendingPhone, user._id)
      await ctx.db.patch(user._id, { phone: row.pendingPhone, phoneVerificationTime: now })
      await insertAuditLog(ctx, {
        userId: user._id,
        companyId: user.companyId,
        actionType: 'phone_enrol',
        tableName: 'users',
        recordId: user._id,
        previousValues: { phone: null },
        newValues: { phone: maskPhone(row.pendingPhone) },
      })
    }
    await insertAuditLog(ctx, {
      userId: user._id,
      companyId: user.companyId,
      actionType: 'mfa_verify',
      tableName: 'mfaSessions',
      recordId: row._id,
      newValues: { channel: row.channel, purpose: row.purpose },
    })
    return { ok: true, error: null }
  },
})

/** Check the code entered for this sign-in (hashed here, compared in the mutation). */
export const verifyChallenge = action({
  args: { code: v.string() },
  returns: v.object({ ok: v.boolean(), error: v.union(v.string(), v.null()) }),
  handler: async (ctx, { code }): Promise<{ ok: boolean; error: string | null }> => {
    const sessionId = await getAuthSessionId(ctx)
    if (!sessionId) throw new Error('Not authenticated')
    const clean = code.replace(/\s/g, '')
    return await ctx.runMutation(internal.mfa.checkChallenge, {
      codeHash: /^\d{6}$/.test(clean) ? await challengeHash(sessionId, clean) : undefined,
    })
  },
})

export type MfaSessionRow = Doc<'mfaSessions'>
