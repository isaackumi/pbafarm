/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { toBase64 } from './lib/crypto'
import { authorizePhoneOtp } from './phoneAuth'
import { socialAvailability, socialProvidersFromEnv } from './lib/sso'

const modules = import.meta.glob('./**/*.ts')
const PHONE = '+233244123456'

function stubWhatsapp() {
  vi.stubEnv('PLATFORM_WHATSAPP_PROVIDER', 'whatsapp_cloud')
  vi.stubEnv('PLATFORM_META_ACCESS_TOKEN', 'token')
  vi.stubEnv('PLATFORM_META_PHONE_NUMBER_ID', '123')
  vi.stubEnv('PLATFORM_META_OTP_TEMPLATE', 'otp')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('INTEGRATIONS_ENCRYPTION_KEY', toBase64(new Uint8Array(32).fill(7)))
  vi.stubEnv('PLATFORM_SMS_PROVIDER', 'hubtel')
  vi.stubEnv('PLATFORM_SMS_SENDER', 'Anowa')
  vi.stubEnv('PLATFORM_HUBTEL_CLIENT_ID', 'pid')
  vi.stubEnv('PLATFORM_HUBTEL_CLIENT_SECRET', 'psecret')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('authOptions.available (Paper 15 sign-in buttons)', () => {
  test('every optional method is off until its provider is configured', async () => {
    const t = convexTest(schema, modules)
    expect(await t.query(api.authOptions.available, {})).toEqual({ google: false, microsoft: false, sso: false, whatsapp: false })
  })

  test('each flag follows its env, and nothing secret is returned', async () => {
    vi.stubEnv('AUTH_GOOGLE_ID', 'gid')
    vi.stubEnv('AUTH_GOOGLE_SECRET', 'gsecret')
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_ID', 'mid')
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_SECRET', 'msecret')
    stubWhatsapp()
    const t = convexTest(schema, modules)
    const r = await t.query(api.authOptions.available, {})
    expect(r).toEqual({ google: true, microsoft: true, sso: false, whatsapp: true })
    expect(JSON.stringify(r)).not.toMatch(/secret|gid|mid/)
  })

  test('a provider needs both its id and secret', () => {
    expect(socialAvailability({ AUTH_GOOGLE_ID: 'x' })).toEqual({ google: false, microsoft: false })
    expect(socialProvidersFromEnv({})).toEqual([])
    const [google, microsoft] = socialProvidersFromEnv({
      AUTH_GOOGLE_ID: 'g', AUTH_GOOGLE_SECRET: 's', AUTH_MICROSOFT_ENTRA_ID_ID: 'm', AUTH_MICROSOFT_ENTRA_ID_SECRET: 's',
    })
    expect(google).toMatchObject({ id: 'google', allowDangerousEmailAccountLinking: false })
    expect(microsoft).toMatchObject({ id: 'microsoft-entra-id', name: 'Microsoft', allowDangerousEmailAccountLinking: false })
    // An unverified email never links to an existing account; no role is set.
    expect(google.profile!({ sub: '1', email: 'A@X.com', email_verified: false } as never, {} as never)).toEqual({
      id: '1', email: 'a@x.com', emailVerified: false,
    })
  })
})

describe('"Send via WhatsApp instead" (Paper 15b)', () => {
  async function setup() {
    const t = convexTest(schema, modules)
    rateLimiterTest.register(t)
    await t.run(async (ctx) => {
      const now = Date.now()
      const companyId = await ctx.db.insert('companies', {
        name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now,
        settings: { aiAssistantEnabled: false, security: { allowPhoneLogin: true } },
      })
      await ctx.db.insert('users', { email: 's@a.com', role: 'user', companyId, phone: PHONE, phoneVerificationTime: now })
    })
    const authorize = (params: Record<string, unknown>) =>
      authorizePhoneOtp(params, { runMutation: (ref: any, args: any) => t.mutation(ref, args) } as any)
    const channels = () =>
      t.run(async (ctx) =>
        (await ctx.db.system.query('_scheduled_functions').collect())
          .filter((f) => f.name.includes('deliverLoginCode'))
          .map((f) => (f.args[0] as { channel: string }).channel),
      )
    return { authorize, channels }
  }

  test('the code goes by WhatsApp when asked and the company can send it', async () => {
    stubWhatsapp()
    const s = await setup()
    await s.authorize({ flow: 'send', phone: PHONE, channel: 'whatsapp' })
    expect(await s.channels()).toEqual(['whatsapp'])
  })

  test('without WhatsApp it falls back to the policy channel (SMS); other values are ignored', async () => {
    const s = await setup()
    await s.authorize({ flow: 'send', phone: PHONE, channel: 'whatsapp' })
    await s.authorize({ flow: 'send', phone: PHONE, channel: 'carrier-pigeon' })
    expect(await s.channels()).toEqual(['sms', 'sms'])
  })
})
