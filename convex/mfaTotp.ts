/**
 * Authenticator-app two-step verification (ENT-003, TOTP RFC 6238).
 *
 * Works next to the SMS/WhatsApp codes of convex/mfa.ts: a session is
 * verified by either. Enrolment: startEnrolment (action: makes and encrypts
 * the secret, returns the otpauth URI once) → confirmEnrolment (first code;
 * returns ten single-use recovery codes, stored hashed). Once confirmed,
 * every new session of the user must verify (requireUser), whether or not the
 * company requires it. Five wrong codes lock the factor for 15 minutes.
 *
 * These functions act on the caller's own account: they pass
 * allowPendingMfa (they are how a session gets verified) and ignoreActAs.
 */
import { v } from 'convex/values'
import { getAuthSessionId, getAuthUserId } from '@convex-dev/auth/server'
import { action, internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { requireUser, sessionMfaVerified } from './lib/authz'
import { insertAuditLog } from './lib/auditChain'
import { decryptJson, encryptJson, encryptionConfigured, MISSING_KEY_MESSAGE } from './lib/crypto'
import { userError } from './lib/errors'
import { channelAvailable } from './messaging/deliver'
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyTotp,
} from './lib/totp'

const MAX_FAILED = 5
const LOCK_MS = 15 * 60 * 1000
const OWN = { allowPendingMfa: true, ignoreActAs: true } as const

const aad = (userId: Id<'users'>) => `totp:${userId}`
const result = v.object({ ok: v.boolean(), error: v.union(v.string(), v.null()) })

async function factorOf(ctx: MutationCtx, userId: Id<'users'>) {
  return await ctx.db
    .query('mfaTotp')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique()
}

async function deleteRecoveryCodes(ctx: MutationCtx, userId: Id<'users'>) {
  const rows = await ctx.db
    .query('mfaRecoveryCodes')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(100)
  for (const r of rows) await ctx.db.delete(r._id)
}

async function issueRecoveryCodes(ctx: MutationCtx, userId: Id<'users'>): Promise<string[]> {
  await deleteRecoveryCodes(ctx, userId)
  const codes = generateRecoveryCodes()
  for (const code of codes) {
    await ctx.db.insert('mfaRecoveryCodes', { userId, codeHash: await hashRecoveryCode(userId, code) })
  }
  return codes
}

/** Mark this sign-in session as verified (only meaningful with a company). */
async function markSessionVerified(ctx: MutationCtx, user: Doc<'users'>, method: 'totp' | 'recovery_code') {
  const sessionId = (await getAuthSessionId(ctx)) as Id<'authSessions'> | null
  if (!sessionId || !user.companyId) return
  const now = Date.now()
  const row = await ctx.db
    .query('mfaSessions')
    .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
    .first()
  if (row && row.userId === user._id) {
    await ctx.db.patch(row._id, { verifiedAt: now, method, codeHash: undefined, expiresAt: undefined })
  } else {
    await ctx.db.insert('mfaSessions', {
      userId: user._id,
      sessionId,
      companyId: user.companyId,
      purpose: 'verify',
      attempts: 0,
      verifiedAt: now,
      method,
    })
  }
}

/**
 * Check a code against the confirmed (or, with `pending`, unconfirmed)
 * factor, with lockout and replay protection. Wrong codes are recorded, so
 * callers return the refusal instead of throwing.
 */
async function checkCode(
  ctx: MutationCtx,
  user: Doc<'users'>,
  code: string,
  opts: { pending?: boolean } = {},
): Promise<{ ok: true; factor: Doc<'mfaTotp'> } | { ok: false; error: string }> {
  const factor = await factorOf(ctx, user._id)
  if (!factor || (!opts.pending && factor.confirmedAt === undefined)) {
    return { ok: false, error: 'No authenticator app is set up for this account.' }
  }
  const now = Date.now()
  if (factor.lockedUntil && factor.lockedUntil > now) {
    return { ok: false, error: 'Too many wrong codes. Try again in 15 minutes or use a recovery code.' }
  }
  const secret = await decryptJson<string>(factor.secretEnc, aad(user._id))
  const step = await verifyTotp(secret, code, now, factor.lastStep)
  if (step === null) {
    const failed = (factor.failedAttempts ?? 0) + 1
    await ctx.db.patch(factor._id, {
      failedAttempts: failed >= MAX_FAILED ? 0 : failed,
      ...(failed >= MAX_FAILED ? { lockedUntil: now + LOCK_MS } : {}),
    })
    return { ok: false, error: 'That code is not right.' }
  }
  await ctx.db.patch(factor._id, { lastStep: step, failedAttempts: 0, lockedUntil: undefined })
  return { ok: true, factor }
}

export const status = query({
  args: {},
  returns: v.object({
    enrolled: v.boolean(),
    pending: v.boolean(),
    recoveryCodesLeft: v.number(),
    available: v.boolean(),
  }),
  handler: async (ctx) => {
    const user = await requireUser(ctx, OWN)
    const factor = await ctx.db
      .query('mfaTotp')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .unique()
    const codes = await ctx.db
      .query('mfaRecoveryCodes')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .take(100)
    return {
      enrolled: factor?.confirmedAt !== undefined,
      pending: !!factor && factor.confirmedAt === undefined,
      recoveryCodesLeft: codes.filter((c) => c.usedAt === undefined).length,
      available: encryptionConfigured(),
    }
  },
})

/** Internal: store a new (unconfirmed) secret for the caller. */
export const storePending = internalMutation({
  args: { secretEnc: v.object({ ciphertext: v.string(), iv: v.string(), keyVersion: v.number() }) },
  returns: v.object({ account: v.string() }),
  handler: async (ctx, { secretEnc }) => {
    const user = await requireUser(ctx, OWN)
    const existing = await factorOf(ctx, user._id)
    if (existing?.confirmedAt !== undefined) {
      throw userError('CONFLICT', 'An authenticator app is already set up. Remove it first to set up another.')
    }
    // Before this session is verified, only an account with no second factor
    // yet may enrol (same rule as enrolling a phone at /verify).
    const company = user.companyId ? await ctx.db.get(user.companyId) : null
    const mfaPending =
      (company?.settings?.security?.require2fa === true || user.totpEnabledAt !== undefined) &&
      !(await sessionMfaVerified(ctx, user._id))
    const phoneCodesWork =
      !!user.phone &&
      !!user.companyId &&
      ((await channelAvailable(ctx, user.companyId, 'sms')) ||
        (await channelAvailable(ctx, user.companyId, 'whatsapp')))
    if (mfaPending && phoneCodesWork) {
      throw userError('FORBIDDEN', 'Verify this sign-in with a code sent to your phone first.')
    }
    if (existing) await ctx.db.delete(existing._id)
    await ctx.db.insert('mfaTotp', { userId: user._id, secretEnc, createdAt: Date.now() })
    return { account: user.email ?? user.phone ?? String(user._id) }
  },
})

/** Begin setting up an authenticator app. The secret is shown only now. */
export const startEnrolment = action({
  args: {},
  returns: v.object({ secret: v.string(), uri: v.string() }),
  handler: async (ctx): Promise<{ secret: string; uri: string }> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    if (!encryptionConfigured()) throw userError('CONFLICT', MISSING_KEY_MESSAGE)
    const secret = generateTotpSecret()
    const secretEnc = await encryptJson(secret, aad(userId))
    const { account }: { account: string } = await ctx.runMutation(internal.mfaTotp.storePending, { secretEnc })
    return { secret, uri: otpauthUri(secret, account) }
  },
})

/** First code from the app: turns the factor on and returns the recovery codes (shown once). */
export const confirmEnrolment = mutation({
  args: { code: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), recoveryCodes: v.array(v.string()) }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx, OWN)
    const checked = await checkCode(ctx, user, code, { pending: true })
    if (!checked.ok) return checked
    const now = Date.now()
    await ctx.db.patch(checked.factor._id, { confirmedAt: now })
    await ctx.db.patch(user._id, { totpEnabledAt: now })
    const recoveryCodes = await issueRecoveryCodes(ctx, user._id)
    await markSessionVerified(ctx, user, 'totp')
    await insertAuditLog(ctx, {
      userId: user._id,
      companyId: user.companyId,
      actionType: 'mfa_totp_enrol',
      tableName: 'mfaTotp',
      recordId: checked.factor._id,
    })
    return { ok: true as const, recoveryCodes }
  },
})

/** Verify this sign-in with a code from the app. */
export const verify = mutation({
  args: { code: v.string() },
  returns: result,
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx, OWN)
    const checked = await checkCode(ctx, user, code)
    if (!checked.ok) return { ok: false, error: checked.error }
    await markSessionVerified(ctx, user, 'totp')
    await insertAuditLog(ctx, {
      userId: user._id,
      companyId: user.companyId,
      actionType: 'mfa_verify',
      tableName: 'mfaTotp',
      recordId: checked.factor._id,
      newValues: { method: 'totp' },
    })
    return { ok: true, error: null }
  },
})

/** Verify this sign-in with a single-use recovery code. */
export const redeemRecoveryCode = mutation({
  args: { code: v.string() },
  returns: result,
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx, OWN)
    const factor = await factorOf(ctx, user._id)
    if (!factor?.confirmedAt) return { ok: false, error: 'No authenticator app is set up for this account.' }
    if (factor.lockedUntil && factor.lockedUntil > Date.now()) {
      return { ok: false, error: 'Too many wrong codes. Try again in 15 minutes.' }
    }
    const codeHash = await hashRecoveryCode(user._id, code)
    const row = await ctx.db
      .query('mfaRecoveryCodes')
      .withIndex('by_userId_and_codeHash', (q) => q.eq('userId', user._id).eq('codeHash', codeHash))
      .first()
    if (!row || row.usedAt !== undefined) {
      const failed = (factor.failedAttempts ?? 0) + 1
      await ctx.db.patch(factor._id, {
        failedAttempts: failed >= MAX_FAILED ? 0 : failed,
        ...(failed >= MAX_FAILED ? { lockedUntil: Date.now() + LOCK_MS } : {}),
      })
      return { ok: false, error: 'That recovery code is not right or was already used.' }
    }
    await ctx.db.patch(row._id, { usedAt: Date.now() })
    await ctx.db.patch(factor._id, { failedAttempts: 0, lockedUntil: undefined })
    await markSessionVerified(ctx, user, 'recovery_code')
    await insertAuditLog(ctx, {
      userId: user._id,
      companyId: user.companyId,
      actionType: 'mfa_verify',
      tableName: 'mfaRecoveryCodes',
      recordId: row._id,
      newValues: { method: 'recovery_code' },
    })
    return { ok: true, error: null }
  },
})

/** New recovery codes (old ones stop working). Needs a current app code. */
export const regenerateRecoveryCodes = mutation({
  args: { code: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), recoveryCodes: v.array(v.string()) }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx, { ignoreActAs: true })
    const checked = await checkCode(ctx, user, code)
    if (!checked.ok) return checked
    const recoveryCodes = await issueRecoveryCodes(ctx, user._id)
    await insertAuditLog(ctx, {
      userId: user._id,
      companyId: user.companyId,
      actionType: 'mfa_recovery_codes_regenerated',
      tableName: 'mfaTotp',
      recordId: checked.factor._id,
    })
    return { ok: true as const, recoveryCodes }
  },
})

/** Remove the authenticator app. Needs a current app code; only from a verified session. */
export const disable = mutation({
  args: { code: v.string() },
  returns: result,
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx, { ignoreActAs: true })
    const checked = await checkCode(ctx, user, code)
    if (!checked.ok) return { ok: false, error: checked.error }
    await ctx.db.delete(checked.factor._id)
    await deleteRecoveryCodes(ctx, user._id)
    await ctx.db.patch(user._id, { totpEnabledAt: undefined })
    await insertAuditLog(ctx, {
      userId: user._id,
      companyId: user.companyId,
      actionType: 'mfa_totp_disable',
      tableName: 'mfaTotp',
      recordId: checked.factor._id,
    })
    return { ok: true, error: null }
  },
})
