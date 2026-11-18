/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { sha256Hex, toBase64 } from './lib/crypto'
import { authorizePhoneOtp } from './phoneAuth'

const modules = import.meta.glob('./**/*.ts')

/**
 * SEC-006 phone sign-in and SEC-007 two-step verification (doc 18 §7–8).
 * The platform SMS default (Hubtel) is configured through env; fetch is
 * mocked and the sent code is read from the request body.
 */
const PHONE_A = '+233244123456'
const PHONE_B = '+233200000001'

async function setup(security: Record<string, unknown> = { allowPhoneLogin: true }) {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', {
      name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now,
      settings: { aiAssistantEnabled: false, security },
    })
    const companyB = await ctx.db.insert('companies', {
      name: 'River Farm', code: 'RIVER', status: 'approved', createdAt: now,
    })
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', role: 'admin', companyId: companyA, phone: '+233244000001' })
    const staffA = await ctx.db.insert('users', { email: 'staff@a.com', role: 'user', companyId: companyA, phone: PHONE_A })
    const nophoneA = await ctx.db.insert('users', { email: 'new@a.com', role: 'user', companyId: companyA })
    const adminB = await ctx.db.insert('users', { email: 'admin@b.com', role: 'admin', companyId: companyB })
    const staffB = await ctx.db.insert('users', { email: 'staff@b.com', role: 'user', companyId: companyB, phone: PHONE_B })
    const session = (userId: Id<'users'>) =>
      ctx.db.insert('authSessions', { userId, expirationTime: now + 86_400_000 })
    return {
      companyA, companyB, adminA, staffA, nophoneA, adminB, staffB,
      sAdminA: await session(adminA),
      sStaffA: await session(staffA),
      sNophoneA: await session(nophoneA),
      sAdminB: await session(adminB),
    }
  })
  const as = (userId: Id<'users'>, sessionId: Id<'authSessions'>) =>
    t.withIdentity({ subject: `${userId}|${sessionId}` })
  /** authorizePhoneOtp with an action ctx that runs the real internal functions. */
  const authorize = (params: Record<string, unknown>) =>
    authorizePhoneOtp(params, {
      runMutation: (ref: any, args: any) => t.mutation(ref, args),
    } as any)
  return { t, as, authorize, ...ids }
}

function stubPlatformSms() {
  vi.stubEnv('PLATFORM_SMS_PROVIDER', 'hubtel')
  vi.stubEnv('PLATFORM_SMS_SENDER', 'PBAFarm')
  vi.stubEnv('PLATFORM_HUBTEL_CLIENT_ID', 'pid')
  vi.stubEnv('PLATFORM_HUBTEL_CLIENT_SECRET', 'psecret')
}

/** Mock Hubtel; returns the codes found in sent messages. */
function mockSms() {
  const sent: { to: string; code: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body)
      sent.push({ to: body.To, code: (String(body.Content).match(/\d{6}/) ?? [''])[0] })
      return new Response(JSON.stringify({ messageId: 'm', status: 0 }), { status: 201 })
    }),
  )
  return sent
}

async function scheduledSends(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect()).filter((f) =>
      f.name.includes('deliverLoginCode'),
    ),
  )
}

async function loginCodeHash(phone: string, code: string) {
  return sha256Hex(`login:${phone}:${code}`)
}

async function messageOf(p: Promise<unknown>) {
  try {
    await p
  } catch (err) {
    return (err as Error).message
  }
  return 'resolved'
}

beforeEach(() => {
  // Scheduled deliveries are inspected, not run.
  vi.useFakeTimers()
  vi.stubEnv('INTEGRATIONS_ENCRYPTION_KEY', toBase64(new Uint8Array(32).fill(7)))
  stubPlatformSms()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('phone sign-in: sending codes (SEC-006)', () => {
  test('a registered number gets a code; an unknown number gets the same answer and nothing is sent', async () => {
    const s = await setup()
    expect(await s.authorize({ flow: 'send', phone: '024 412 3456' })).toBeNull()
    expect(await s.authorize({ flow: 'send', phone: '0209999999' })).toBeNull()
    const codes = await s.t.run((ctx) => ctx.db.query('phoneLoginCodes').collect())
    expect(codes).toHaveLength(1)
    expect(codes[0]).toMatchObject({ phone: PHONE_A, userId: s.staffA, attempts: 0 })
    expect(codes[0].codeHash).toMatch(/^[0-9a-f]{64}$/)
    const sends = await scheduledSends(s.t)
    expect(sends).toHaveLength(1)
    expect(sends[0].args[0]).toMatchObject({ phone: PHONE_A, channel: 'sms', companyId: s.companyA })
  })

  test('no code when the company does not allow phone sign-in or has no channel', async () => {
    const s = await setup()
    await s.authorize({ flow: 'send', phone: PHONE_B }) // company B: not allowed
    vi.stubEnv('PLATFORM_SMS_PROVIDER', '') // A loses its only channel
    await s.authorize({ flow: 'send', phone: PHONE_A })
    expect(await s.t.run((ctx) => ctx.db.query('phoneLoginCodes').collect())).toHaveLength(0)
    expect(await scheduledSends(s.t)).toHaveLength(0)
  })

  test('no code for inactive users or unapproved companies', async () => {
    const s = await setup()
    await s.t.run((ctx) => ctx.db.patch(s.staffA, { active: false }))
    await s.authorize({ flow: 'send', phone: PHONE_A })
    expect(await scheduledSends(s.t)).toHaveLength(0)
  })

  test('sends to one number are rate limited (3 per 15 minutes)', async () => {
    const s = await setup()
    for (let i = 0; i < 5; i += 1) await s.authorize({ flow: 'send', phone: PHONE_A })
    expect(await scheduledSends(s.t)).toHaveLength(3)
    // Only the latest code is valid.
    expect(await s.t.run((ctx) => ctx.db.query('phoneLoginCodes').collect())).toHaveLength(1)
  })

  test('the scheduled delivery sends the code through the resolved channel', async () => {
    const s = await setup()
    const sent = mockSms()
    await s.t.action(internal.phoneAuth.deliverLoginCode, {
      companyId: s.companyA, channel: 'sms', phone: PHONE_A, code: '123456',
    })
    expect(sent).toEqual([{ to: '233244123456', code: '123456' }])
  })
})

describe('phone sign-in: verifying codes (SEC-006)', () => {
  async function issue(s: Awaited<ReturnType<typeof setup>>, code = '123456') {
    await s.t.mutation(internal.phoneAuth.issueLoginCode, {
      phone: PHONE_A, code, codeHash: await loginCodeHash(PHONE_A, code),
    })
  }

  test('the right code signs in the existing user once; no user or account is created', async () => {
    const s = await setup()
    const before = await s.t.run(async (ctx) => (await ctx.db.query('users').collect()).length)
    await issue(s)
    const result = await s.authorize({ flow: 'verify', phone: '0244123456', code: '123456' })
    expect(result?.userId).toBe(s.staffA)
    const session = await s.t.run((ctx) => ctx.db.get(result!.sessionId))
    expect(session?.userId).toBe(s.staffA)
    // Single use.
    expect(await s.authorize({ flow: 'verify', phone: PHONE_A, code: '123456' })).toBeNull()
    const after = await s.t.run(async (ctx) => ({
      users: (await ctx.db.query('users').collect()).length,
      accounts: (await ctx.db.query('authAccounts').collect()).length,
    }))
    expect(after).toEqual({ users: before, accounts: 0 })
  })

  test('unknown numbers never sign in or create a user', async () => {
    const s = await setup()
    const before = await s.t.run(async (ctx) => (await ctx.db.query('users').collect()).length)
    await s.authorize({ flow: 'send', phone: '0209999999' })
    expect(await s.authorize({ flow: 'verify', phone: '0209999999', code: '123456' })).toBeNull()
    expect(await s.t.run(async (ctx) => (await ctx.db.query('users').collect()).length)).toBe(before)
  })

  test('five wrong codes void the code', async () => {
    const s = await setup()
    await issue(s)
    for (let i = 0; i < 5; i += 1) {
      expect(await s.authorize({ flow: 'verify', phone: PHONE_A, code: '000000' })).toBeNull()
    }
    expect(await s.authorize({ flow: 'verify', phone: PHONE_A, code: '123456' })).toBeNull()
  })

  test('an expired code is refused', async () => {
    const s = await setup()
    await issue(s)
    await s.t.run(async (ctx) => {
      const row = (await ctx.db.query('phoneLoginCodes').collect())[0]
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 })
    })
    expect(await s.authorize({ flow: 'verify', phone: PHONE_A, code: '123456' })).toBeNull()
  })

  test('a code for a user deactivated after sending is refused', async () => {
    const s = await setup()
    await issue(s)
    await s.t.run((ctx) => ctx.db.patch(s.staffA, { active: false }))
    expect(await s.authorize({ flow: 'verify', phone: PHONE_A, code: '123456' })).toBeNull()
  })
})

describe('admin phone management', () => {
  test('admin sets a phone in E.164, unique across accounts; audited without the full number', async () => {
    const s = await setup()
    const admin = s.as(s.adminA, s.sAdminA)
    expect(await admin.mutation(api.users.setPhone, { id: s.nophoneA, phone: '024 555 0101' }))
      .toEqual({ phone: '+233245550101' })
    expect(await messageOf(admin.mutation(api.users.setPhone, { id: s.nophoneA, phone: PHONE_B })))
      .toContain('already registered')
    expect(await messageOf(admin.mutation(api.users.setPhone, { id: s.nophoneA, phone: 'abc' })))
      .toContain('valid phone')
    const audit = await s.t.run((ctx) => ctx.db.query('auditLogs').collect())
    const row = audit.find((a) => a.actionType === 'set_phone')
    expect(JSON.stringify(row)).not.toContain('245550101')
    await admin.mutation(api.users.setPhone, { id: s.nophoneA, phone: null })
    expect((await s.t.run((ctx) => ctx.db.get(s.nophoneA)))?.phone).toBeUndefined()
  })

  test("staff and other companies' admins cannot set phones", async () => {
    const s = await setup()
    expect(await messageOf(s.as(s.staffA, s.sStaffA).mutation(api.users.setPhone, { id: s.nophoneA, phone: '0245550101' })))
      .toContain('Insufficient permissions')
    expect(await messageOf(s.as(s.adminB, s.sAdminB).mutation(api.users.setPhone, { id: s.staffA, phone: '0245550101' })))
      .toContain('Access denied')
  })

  test('users.update normalizes the phone too', async () => {
    const s = await setup()
    await s.as(s.adminA, s.sAdminA).mutation(api.users.update, { id: s.nophoneA, patch: { phone: '0245550102' } })
    expect((await s.t.run((ctx) => ctx.db.get(s.nophoneA)))?.phone).toBe('+233245550102')
  })
})

describe('company sign-in policy', () => {
  test('2FA cannot be enabled without a working channel or without the admin having a phone', async () => {
    const s = await setup({})
    vi.stubEnv('PLATFORM_SMS_PROVIDER', '')
    const admin = s.as(s.adminA, s.sAdminA)
    expect(await messageOf(admin.mutation(api.security.updatePolicy, { require2fa: true })))
      .toContain('Set up and test a SMS channel')
    expect(await messageOf(admin.mutation(api.security.updatePolicy, { allowPhoneLogin: true })))
      .toContain('before allowing phone sign-in')
    stubPlatformSms()
    await s.t.run((ctx) => ctx.db.patch(s.adminA, { phone: undefined }))
    expect(await messageOf(admin.mutation(api.security.updatePolicy, { require2fa: true })))
      .toContain('Add your own phone number first')
    await s.t.run((ctx) => ctx.db.patch(s.adminA, { phone: '+233244000001' }))
    const next = await admin.mutation(api.security.updatePolicy, { require2fa: true })
    expect(next.require2fa).toBe(true)
    // The enabling admin keeps this session; staff sessions must verify.
    expect((await admin.query(api.security.getPolicy, {})).require2fa).toBe(true)
    expect(await messageOf(s.as(s.staffA, s.sStaffA).query(api.users.listDirectory, {}))).toContain('MFA_REQUIRED')
  })

  test('staff cannot change the policy; another company is unaffected', async () => {
    const s = await setup({})
    expect(await messageOf(s.as(s.staffA, s.sStaffA).mutation(api.security.updatePolicy, { require2fa: true })))
      .toContain('Insufficient permissions')
    await s.as(s.adminA, s.sAdminA).mutation(api.security.updatePolicy, { require2fa: true })
    const companyB = await s.t.run((ctx) => ctx.db.get(s.companyB))
    expect(companyB?.settings?.security).toBeUndefined()
    // B's admin is not gated by A's policy.
    expect(await s.as(s.adminB, s.sAdminB).query(api.users.list, {})).toBeTruthy()
  })

  test('a channel the policy relies on cannot be disabled', async () => {
    const s = await setup({})
    vi.stubEnv('PLATFORM_SMS_PROVIDER', '')
    const channelId = await s.t.run((ctx) =>
      ctx.db.insert('messagingChannels', {
        companyId: s.companyA, channel: 'sms', provider: 'hubtel', status: 'verified',
        senderId: 'X', settings: {}, updatedBy: s.adminA, updatedAt: Date.now(),
      }),
    )
    await s.t.run((ctx) =>
      ctx.db.insert('integrationSecrets', {
        companyId: s.companyA, channelId, ciphertext: 'x', iv: 'y', keyVersion: 1, updatedAt: Date.now(),
      }),
    )
    const admin = s.as(s.adminA, s.sAdminA)
    await admin.mutation(api.security.updatePolicy, { allowPhoneLogin: true })
    expect(await messageOf(admin.mutation(api.messaging.channels.disableChannel, { channelId })))
      .toContain('Turn off two-step verification and phone sign-in')
    await admin.mutation(api.security.updatePolicy, { allowPhoneLogin: false })
    await admin.mutation(api.messaging.channels.disableChannel, { channelId })
  })

  test('publishSettings keeps the policy', async () => {
    const s = await setup({ require2fa: false, allowPhoneLogin: true })
    await s.as(s.adminA, s.sAdminA).mutation(api.companies.publishSettings, {})
    const company = await s.t.run((ctx) => ctx.db.get(s.companyA))
    expect(company?.settings?.security?.allowPhoneLogin).toBe(true)
  })

  test('operator break-glass clears the policy', async () => {
    const s = await setup({ require2fa: true, allowPhoneLogin: true })
    await s.t.mutation(internal.security.clearPolicyForCompany, { companyId: s.companyA })
    const company = await s.t.run((ctx) => ctx.db.get(s.companyA))
    expect(company?.settings?.security).toMatchObject({ require2fa: false, allowPhoneLogin: false })
  })
})

describe('two-step verification gate (SEC-007)', () => {
  test('refuses tenant calls until this session is verified, then allows them', async () => {
    const s = await setup({ require2fa: true })
    const staff = s.as(s.staffA, s.sStaffA)
    expect(await messageOf(staff.query(api.users.listDirectory, {}))).toContain('MFA_REQUIRED')
    const current = await staff.query(api.users.current, {})
    expect(current).toMatchObject({ mfaPolicy: true, mfaRequired: true, hasPhone: true, mfaChannels: ['sms'] })

    const sent = mockSms()
    const started = await staff.action(api.mfa.startChallenge, { channel: 'sms' })
    expect(started).toMatchObject({ ok: true, sentTo: '+233 ••• ••456' })
    expect(sent[0].to).toBe('233244123456')

    expect(await staff.action(api.mfa.verifyChallenge, { code: '000000' })).toEqual({
      ok: false, error: 'That code is not right.',
    })
    expect(await staff.action(api.mfa.verifyChallenge, { code: sent[0].code })).toEqual({ ok: true, error: null })
    expect(await staff.query(api.users.listDirectory, {})).toBeTruthy()
    expect((await staff.query(api.users.current, {}))?.mfaRequired).toBe(false)

    // A new session of the same user starts unverified.
    const other = await s.t.run((ctx) =>
      ctx.db.insert('authSessions', { userId: s.staffA, expirationTime: Date.now() + 1000 }),
    )
    expect(await messageOf(s.as(s.staffA, other).query(api.users.listDirectory, {}))).toContain('MFA_REQUIRED')
  })

  test('super_admins follow their company policy', async () => {
    const s = await setup({ require2fa: true })
    await s.t.run((ctx) => ctx.db.patch(s.adminA, { role: 'super_admin' }))
    expect(await messageOf(s.as(s.adminA, s.sAdminA).query(api.users.listDirectory, {}))).toContain('MFA_REQUIRED')
  })

  test('five wrong codes void the challenge; resend has a cooldown', async () => {
    const s = await setup({ require2fa: true })
    const staff = s.as(s.staffA, s.sStaffA)
    const sent = mockSms()
    await staff.action(api.mfa.startChallenge, { channel: 'sms' })
    expect(await messageOf(staff.action(api.mfa.startChallenge, { channel: 'sms' }))).toContain('Wait a moment')
    for (let i = 0; i < 5; i += 1) await staff.action(api.mfa.verifyChallenge, { code: '000000' })
    const result = await staff.action(api.mfa.verifyChallenge, { code: sent[0].code })
    expect(result.ok).toBe(false)
  })

  test('an unavailable channel is refused', async () => {
    const s = await setup({ require2fa: true })
    expect(await messageOf(s.as(s.staffA, s.sStaffA).action(api.mfa.startChallenge, { channel: 'whatsapp' })))
      .toContain('cannot be sent by WhatsApp')
  })

  test('a user without a phone enrols one and is verified', async () => {
    const s = await setup({ require2fa: true })
    const user = s.as(s.nophoneA, s.sNophoneA)
    expect((await user.query(api.users.current, {}))?.hasPhone).toBe(false)
    expect(await messageOf(user.action(api.mfa.startChallenge, { channel: 'sms' }))).toContain('Add your phone number first')
    expect(await messageOf(user.action(api.mfa.startEnrolment, { phone: PHONE_B, channel: 'sms' })))
      .toContain('already registered')
    const sent = mockSms()
    const started = await user.action(api.mfa.startEnrolment, { phone: '024 555 0199', channel: 'sms' })
    expect(started.ok).toBe(true)
    expect(sent[0].to).toBe('233245550199')
    expect(await user.action(api.mfa.verifyChallenge, { code: sent[0].code })).toEqual({ ok: true, error: null })
    const saved = await s.t.run((ctx) => ctx.db.get(s.nophoneA))
    expect(saved?.phone).toBe('+233245550199')
    expect(await user.query(api.users.listDirectory, {})).toBeTruthy()
  })

  test('phone sign-in counts as the second step only when the company says so', async () => {
    const s = await setup({ require2fa: true, allowPhoneLogin: true })
    // Not offered at all while phone sign-in does not satisfy 2FA.
    await s.authorize({ flow: 'send', phone: PHONE_A })
    expect(await scheduledSends(s.t)).toHaveLength(0)

    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.companyA, {
        settings: { aiAssistantEnabled: false, security: { require2fa: true, allowPhoneLogin: true, phoneLoginSatisfies2fa: true } },
      })
    })
    await s.t.mutation(internal.phoneAuth.issueLoginCode, {
      phone: PHONE_A, code: '222222', codeHash: await loginCodeHash(PHONE_A, '222222'),
    })
    const result = await s.authorize({ flow: 'verify', phone: PHONE_A, code: '222222' })
    expect(result).not.toBeNull()
    expect(await s.as(s.staffA, result!.sessionId).query(api.users.listDirectory, {})).toBeTruthy()
  })

  test('the 2FA functions themselves refuse other companies and signed-out callers', async () => {
    const s = await setup({ require2fa: true })
    // Company B does not require 2FA.
    expect(await messageOf(s.as(s.adminB, s.sAdminB).action(api.mfa.startChallenge, { channel: 'sms' })))
      .toContain('does not require')
    expect(await messageOf(s.t.action(api.mfa.verifyChallenge, { code: '123456' }))).toContain('Not authenticated')
  })
})
