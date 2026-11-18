import { v } from 'convex/values'
import { internalAction, internalMutation } from './_generated/server'
import type { ActionCtx, MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { randomDigits, sha256Hex } from './lib/crypto'
import { DEFAULT_COUNTRY, isSupportedCountry, normalizePhone } from './lib/phone'
import { OTP_MAX_ATTEMPTS, OTP_TTL_MS, rateLimiter } from './lib/rateLimits'
import { channelAvailable, deliverMessage } from './messaging/deliver'
import { phoneLoginOffered, securityPolicy } from './messaging/policy'

/**
 * Passwordless phone sign-in (SEC-006, doc 18 §7).
 *
 * Two calls to the Convex Auth credentials provider `phone-otp`:
 *   signIn('phone-otp', { flow: 'send', phone })          → always { signingIn: false }
 *   signIn('phone-otp', { flow: 'verify', phone, code })  → signed in, or not
 *
 * The send step answers identically whether or not a code was sent, and the
 * message itself is scheduled, so a caller cannot learn which numbers exist.
 * Sign-in only ever resolves to an existing user whose phone matches; this
 * module never creates users or auth accounts.
 */

/** Same session length as Convex Auth (AUTH_SESSION_TOTAL_DURATION_MS, default 30 days). */
function sessionDurationMs() {
  const configured = Number(process.env.AUTH_SESSION_TOTAL_DURATION_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : 30 * 24 * 60 * 60 * 1000
}

function loginCodeHash(phone: string, code: string) {
  return sha256Hex(`login:${phone}:${code}`)
}

/** The user may sign in by phone right now, or null. */
async function eligibleCompany(ctx: MutationCtx, user: Doc<'users'>) {
  if (user.active === false || !user.companyId) return null
  const company = await ctx.db.get(user.companyId)
  if (!company || company.status !== 'approved') return null
  const policy = securityPolicy(company)
  if (!phoneLoginOffered(policy)) return null
  return { company, policy }
}

async function userByPhone(ctx: MutationCtx, phone: string) {
  const matches = await ctx.db
    .query('users')
    .withIndex('phone', (q) => q.eq('phone', phone))
    .take(2)
  // Phones are unique (users.setPhone); refuse if legacy data says otherwise.
  return matches.length === 1 ? matches[0] : null
}

/**
 * Internal: store a code and schedule its delivery when the number belongs
 * to an eligible user. Returns nothing the caller could tell apart.
 */
export const issueLoginCode = internalMutation({
  args: { phone: v.string(), code: v.string(), codeHash: v.string() },
  handler: async (ctx, { phone, code, codeHash }) => {
    // Limits are consumed for every number, known or not.
    for (const name of ['loginCodePerPhone', 'loginCodePerPhoneDaily'] as const) {
      const r = await rateLimiter.limit(ctx, name, { key: phone })
      if (!r.ok) return null
    }
    if (!(await rateLimiter.limit(ctx, 'loginCodeGlobal')).ok) return null

    const user = await userByPhone(ctx, phone)
    if (!user) return null
    const eligible = await eligibleCompany(ctx, user)
    if (!eligible) return null
    const companyId = eligible.company._id
    const channel = eligible.policy.phoneLoginChannel
    if (!(await channelAvailable(ctx, companyId, channel))) return null
    if (!(await rateLimiter.limit(ctx, 'loginCodePerCompany', { key: companyId })).ok) return null

    const now = Date.now()
    const existing = await ctx.db
      .query('phoneLoginCodes')
      .withIndex('by_phone', (q) => q.eq('phone', phone))
      .collect()
    for (const row of existing) await ctx.db.delete(row._id)
    await ctx.db.insert('phoneLoginCodes', {
      phone,
      userId: user._id,
      companyId,
      codeHash,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      createdAt: now,
    })
    await ctx.scheduler.runAfter(0, internal.phoneAuth.deliverLoginCode, {
      companyId,
      channel,
      phone,
      code,
    })
    return null
  },
})

/** Internal: send a sign-in code. Failures are logged without the code. */
export const deliverLoginCode = internalAction({
  args: {
    companyId: v.id('companies'),
    channel: v.union(v.literal('sms'), v.literal('whatsapp')),
    phone: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await deliverMessage(ctx, args.companyId, {
      to: args.phone,
      channel: args.channel,
      body: `Your PBA Farm sign-in code is ${args.code}. It expires in 10 minutes. Do not share it.`,
      otpCode: args.code,
    })
    if (!result.ok) {
      console.warn(`Sign-in code not sent (${args.channel}, ${result.route}): ${result.error}`)
    }
    return null
  },
})

/**
 * Internal: check a code. On success the code is consumed and a session is
 * created for the existing user; returns null otherwise.
 */
export const verifyLoginCode = internalMutation({
  args: { phone: v.string(), codeHash: v.string() },
  handler: async (ctx, { phone, codeHash }) => {
    const row = await ctx.db
      .query('phoneLoginCodes')
      .withIndex('by_phone', (q) => q.eq('phone', phone))
      .first()
    if (!row) return null
    const now = Date.now()
    if (row.expiresAt < now || row.attempts >= OTP_MAX_ATTEMPTS) {
      await ctx.db.delete(row._id)
      return null
    }
    if (row.codeHash !== codeHash) {
      const attempts = row.attempts + 1
      if (attempts >= OTP_MAX_ATTEMPTS) await ctx.db.delete(row._id)
      else await ctx.db.patch(row._id, { attempts })
      return null
    }
    await ctx.db.delete(row._id)

    // Re-check: the account or policy may have changed since the code was sent.
    const user = await ctx.db.get(row.userId)
    if (!user || user.phone !== phone) return null
    const eligible = await eligibleCompany(ctx, user)
    if (!eligible || eligible.company._id !== row.companyId) return null

    // Session created here (as Convex Auth's createSession does) so the
    // two-step state can be recorded for this exact session.
    const sessionId = await ctx.db.insert('authSessions', {
      userId: user._id,
      expirationTime: now + sessionDurationMs(),
    })
    if (eligible.policy.phoneLoginSatisfies2fa) {
      await ctx.db.insert('mfaSessions', {
        userId: user._id,
        sessionId,
        companyId: row.companyId,
        purpose: 'verify',
        attempts: 0,
        verifiedAt: now,
        method: 'phone_login',
      })
    }
    await ctx.db.patch(user._id, { phoneVerificationTime: now })
    await ctx.db.insert('auditLogs', {
      userId: user._id,
      companyId: row.companyId,
      actionType: 'phone_sign_in',
      tableName: 'users',
      recordId: user._id,
      newValues: { sessionId, countsAsTwoStep: eligible.policy.phoneLoginSatisfies2fa },
    })
    return { userId: user._id, sessionId }
  },
})

/**
 * `authorize` of the `phone-otp` provider (convex/auth.ts). Runs in the
 * Convex Auth signIn action. Returns the user to sign in, or null.
 */
export async function authorizePhoneOtp(
  params: Partial<Record<string, unknown>>,
  ctx: ActionCtx,
): Promise<{ userId: Id<'users'>; sessionId: Id<'authSessions'> } | null> {
  const country =
    typeof params.country === 'string' && isSupportedCountry(params.country)
      ? params.country
      : DEFAULT_COUNTRY
  const phone = normalizePhone(typeof params.phone === 'string' ? params.phone : '', country)
  if (params.flow === 'send') {
    if (phone) {
      const code = randomDigits(6)
      await ctx.runMutation(internal.phoneAuth.issueLoginCode, {
        phone,
        code,
        codeHash: await loginCodeHash(phone, code),
      })
    }
    return null
  }
  if (params.flow === 'verify') {
    const code = typeof params.code === 'string' ? params.code.replace(/\s/g, '') : ''
    if (!phone || !/^\d{6}$/.test(code)) return null
    return await ctx.runMutation(internal.phoneAuth.verifyLoginCode, {
      phone,
      codeHash: await loginCodeHash(phone, code),
    })
  }
  return null
}
