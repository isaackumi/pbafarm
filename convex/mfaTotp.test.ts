/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { toBase64 } from './lib/crypto'
import { base32Decode, base32Encode, hotp, totpStep, verifyTotp } from './lib/totp'

const modules = import.meta.glob('./**/*.ts')
const TEST_KEY = toBase64(new Uint8Array(32).map((_, i) => i + 3))

/** ENT-003: authenticator-app (TOTP) two-step verification and recovery codes. */
describe('TOTP (RFC 6238)', () => {
  const rfcSecret = base32Encode(new TextEncoder().encode('12345678901234567890'))

  test('matches the RFC 6238 SHA-1 vectors', async () => {
    const key = base32Decode(rfcSecret)
    expect(await hotp(key, totpStep(59_000), 8)).toBe('94287082')
    expect(await hotp(key, totpStep(1_111_111_109_000), 8)).toBe('07081804')
    expect(await hotp(key, totpStep(2_000_000_000_000), 8)).toBe('69279037')
  })

  test('accepts ±1 step, refuses replays and junk', async () => {
    const key = base32Decode(rfcSecret)
    const now = 1_700_000_000_000
    const prev = await hotp(key, totpStep(now) - 1)
    expect(await verifyTotp(rfcSecret, prev, now)).toBe(totpStep(now) - 1)
    expect(await verifyTotp(rfcSecret, await hotp(key, totpStep(now) - 2), now)).toBeNull()
    expect(await verifyTotp(rfcSecret, prev, now, totpStep(now) - 1)).toBeNull()
    expect(await verifyTotp(rfcSecret, 'abcdef', now)).toBeNull()
  })
})

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', { name: 'A', code: 'AA', status: 'approved', createdAt: now })
    const companyB = await ctx.db.insert('companies', { name: 'B', code: 'BB', status: 'approved', createdAt: now })
    const userA = await ctx.db.insert('users', { email: 'a@a.com', role: 'admin', companyId: companyA })
    const userB = await ctx.db.insert('users', { email: 'b@b.com', role: 'admin', companyId: companyB })
    const session = (userId: Id<'users'>) => ctx.db.insert('authSessions', { userId, expirationTime: now + 86_400_000 })
    return { companyA, companyB, userA, userB, s1: await session(userA), s2: await session(userA), sB: await session(userB) }
  })
  const as = (userId: Id<'users'>, sessionId: Id<'authSessions'>) => t.withIdentity({ subject: `${userId}|${sessionId}` })
  return { t, as, ...ids }
}

const codeAt = async (secret: string, ms = Date.now(), offset = 0) => hotp(base32Decode(secret), totpStep(ms) + offset)

describe('mfaTotp', () => {
  beforeEach(() => vi.stubEnv('INTEGRATIONS_ENCRYPTION_KEY', TEST_KEY))
  afterEach(() => vi.unstubAllEnvs())

  test('enrol, then every new session must verify; replay, wrong codes and recovery codes', async () => {
    const s = await setup()
    const a1 = s.as(s.userA, s.s1)
    const { secret, uri } = await a1.action(api.mfaTotp.startEnrolment, {})
    expect(uri).toMatch(/^otpauth:\/\/totp\/PBA%20Farm%3Aa%40a\.com\?secret=/)
    // Secret is stored encrypted, never in plain text.
    const row = await s.t.run((ctx) => ctx.db.query('mfaTotp').first())
    expect(JSON.stringify(row)).not.toContain(secret)

    expect(await a1.mutation(api.mfaTotp.confirmEnrolment, { code: '000000' })).toMatchObject({ ok: false })
    const confirmed = await a1.mutation(api.mfaTotp.confirmEnrolment, { code: await codeAt(secret) })
    if (!confirmed.ok) throw new Error(confirmed.error)
    expect(confirmed.recoveryCodes).toHaveLength(10)
    // Recovery codes are stored hashed.
    const stored = await s.t.run((ctx) => ctx.db.query('mfaRecoveryCodes').collect())
    expect(stored.map((r) => r.codeHash)).not.toContain(confirmed.recoveryCodes[0])

    // Enrolling session is verified; a new session is not.
    expect(await a1.query(api.users.listDirectory, {})).toBeTruthy()
    const a2 = s.as(s.userA, s.s2)
    await expect(a2.query(api.users.listDirectory, {})).rejects.toThrow(/MFA_REQUIRED/)
    expect(await a2.query(api.users.current, {})).toMatchObject({ mfaRequired: true, mfaTotp: true })

    // The code used to enrol cannot be replayed.
    expect(await a2.mutation(api.mfaTotp.verify, { code: await codeAt(secret) })).toMatchObject({ ok: false })
    expect(await a2.mutation(api.mfaTotp.verify, { code: await codeAt(secret, Date.now(), 1) })).toEqual({ ok: true, error: null })
    expect(await a2.query(api.users.listDirectory, {})).toBeTruthy()

    // Recovery code: single use.
    const s3 = await s.t.run((ctx) => ctx.db.insert('authSessions', { userId: s.userA, expirationTime: Date.now() + 1e7 }))
    const a3 = s.as(s.userA, s3)
    const rc = confirmed.recoveryCodes[0].toUpperCase()
    expect(await a3.mutation(api.mfaTotp.redeemRecoveryCode, { code: rc })).toEqual({ ok: true, error: null })
    const s4 = await s.t.run((ctx) => ctx.db.insert('authSessions', { userId: s.userA, expirationTime: Date.now() + 1e7 }))
    expect(await s.as(s.userA, s4).mutation(api.mfaTotp.redeemRecoveryCode, { code: rc })).toMatchObject({ ok: false })
    expect(await a3.query(api.mfaTotp.status, {})).toMatchObject({ enrolled: true, recoveryCodesLeft: 9 })

    // Another company's user is unaffected and cannot use A's codes.
    const b = s.as(s.userB, s.sB)
    expect(await b.query(api.users.listDirectory, {})).toBeTruthy()
    expect(await b.mutation(api.mfaTotp.redeemRecoveryCode, { code: confirmed.recoveryCodes[1] })).toMatchObject({ ok: false })
    expect(await b.mutation(api.mfaTotp.verify, { code: await codeAt(secret, Date.now(), -1) })).toMatchObject({ ok: false })

    // Audit trail.
    const audit = await s.t.run((ctx) => ctx.db.query('auditLogs').collect())
    expect(audit.map((r) => r.actionType)).toEqual(expect.arrayContaining(['mfa_totp_enrol', 'mfa_verify']))
  })

  test('five wrong codes lock the factor', async () => {
    const s = await setup()
    const a1 = s.as(s.userA, s.s1)
    const { secret } = await a1.action(api.mfaTotp.startEnrolment, {})
    await a1.mutation(api.mfaTotp.confirmEnrolment, { code: await codeAt(secret) })
    const a2 = s.as(s.userA, s.s2)
    for (let i = 0; i < 5; i++) await a2.mutation(api.mfaTotp.verify, { code: '000000' })
    const res = await a2.mutation(api.mfaTotp.verify, { code: await codeAt(secret, Date.now(), 1) })
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) })
  })

  test('disable needs a valid code and clears the requirement', async () => {
    const s = await setup()
    const a1 = s.as(s.userA, s.s1)
    const { secret } = await a1.action(api.mfaTotp.startEnrolment, {})
    await a1.mutation(api.mfaTotp.confirmEnrolment, { code: await codeAt(secret) })
    expect(await a1.mutation(api.mfaTotp.disable, { code: '123456' })).toMatchObject({ ok: false })
    expect(await a1.mutation(api.mfaTotp.disable, { code: await codeAt(secret, Date.now(), 1) })).toEqual({ ok: true, error: null })
    expect(await s.as(s.userA, s.s2).query(api.users.listDirectory, {})).toBeTruthy()
    expect(await s.t.run((ctx) => ctx.db.query('mfaRecoveryCodes').collect())).toEqual([])
  })

  test('a company that requires two-step accepts an authenticator app instead of a phone', async () => {
    const s = await setup()
    await s.t.run((ctx) =>
      ctx.db.patch(s.companyA, { settings: { aiAssistantEnabled: false, security: { require2fa: true } } }),
    )
    const a1 = s.as(s.userA, s.s1)
    await expect(a1.query(api.users.listDirectory, {})).rejects.toThrow(/MFA_REQUIRED/)
    // No phone and no channel: enrolling an app is allowed and verifies the session.
    const { secret } = await a1.action(api.mfaTotp.startEnrolment, {})
    expect((await a1.mutation(api.mfaTotp.confirmEnrolment, { code: await codeAt(secret) })).ok).toBe(true)
    expect(await a1.query(api.users.listDirectory, {})).toBeTruthy()
  })
})
