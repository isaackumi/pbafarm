/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import {
  MISSING_KEY_MESSAGE,
  decryptJson,
  encryptJson,
  randomDigits,
  readEncryptionKey,
  secretHint,
  toBase64,
} from './lib/crypto'
import { maskPhone, normalizePhone } from './lib/phone'
import { ADAPTERS, platformChannelFromEnv } from './messaging/providers'
import * as channels from './messaging/channels'
import * as deliver from './messaging/deliver'
import * as webhooks from './webhooks'
import * as inboundWebhooks from './inboundWebhooks'
import * as llmGateway from './llmGateway'
import * as governance from './governance'
import * as botAgent from './bot/agent'

const modules = import.meta.glob('./**/*.ts')

/**
 * INT-001 messaging channels (doc 18). Two approved companies; admins and a
 * staff member of A. Credentials are encrypted with a test key.
 */
const TEST_KEY = toBase64(new Uint8Array(32).map((_, i) => i + 1))
const SECRET = 'super-secret-client-secret-4F2a'

async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', {
      name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now,
    })
    const companyB = await ctx.db.insert('companies', {
      name: 'River Farm', code: 'RIVER', status: 'approved', createdAt: now,
    })
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', role: 'admin', companyId: companyA })
    const staffA = await ctx.db.insert('users', { email: 'staff@a.com', role: 'user', companyId: companyA })
    const adminB = await ctx.db.insert('users', { email: 'admin@b.com', role: 'admin', companyId: companyB })
    return { companyA, companyB, adminA, staffA, adminB }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

async function messageOf(p: Promise<unknown>) {
  try {
    await p
  } catch (err) {
    return (err as Error).message
  }
  return 'resolved'
}

function okResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Hubtel SMS channel for company A with saved credentials. */
async function hubtelChannel(s: Awaited<ReturnType<typeof setup>>) {
  const admin = s.as(s.adminA)
  const channelId = await admin.mutation(api.messaging.channels.saveChannel, {
    channel: 'sms', provider: 'hubtel', senderId: 'Anowa',
  })
  await admin.action(api.messaging.channels.saveCredentials, {
    channelId, credentials: { clientId: 'client-id-123', clientSecret: SECRET },
  })
  return channelId
}

beforeEach(() => {
  vi.stubEnv('INTEGRATIONS_ENCRYPTION_KEY', TEST_KEY)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('encryption (doc 18 §4)', () => {
  test('round-trip, and the ciphertext is bound to its row and key', async () => {
    const key = readEncryptionKey(TEST_KEY)!
    const sealed = await encryptJson({ apiKey: SECRET }, 'companyA:channel1', key)
    expect(sealed.ciphertext).not.toContain(SECRET)
    expect(await decryptJson(sealed, 'companyA:channel1', key)).toEqual({ apiKey: SECRET })
    // Copied onto another company's row: authentication fails.
    await expect(decryptJson(sealed, 'companyB:channel1', key)).rejects.toThrow()
    const otherKey = readEncryptionKey(toBase64(new Uint8Array(32).fill(9)))!
    await expect(decryptJson(sealed, 'companyA:channel1', otherKey)).rejects.toThrow()
    // A fresh IV each time.
    const again = await encryptJson({ apiKey: SECRET }, 'companyA:channel1', key)
    expect(again.iv).not.toBe(sealed.iv)
  })

  test('key must be 32 bytes of base64; missing key refuses to encrypt', async () => {
    expect(readEncryptionKey('')).toBeNull()
    expect(readEncryptionKey(toBase64(new Uint8Array(16)))).toBeNull()
    expect(readEncryptionKey('not base64!!')).toBeNull()
    await expect(encryptJson({}, 'x', null)).rejects.toThrow(MISSING_KEY_MESSAGE)
  })

  test('hints and codes', () => {
    expect(secretHint(SECRET)).toBe('…4F2a')
    expect(secretHint('short')).toBe('…')
    const code = randomDigits(6)
    expect(code).toMatch(/^\d{6}$/)
  })
})

describe('phone numbers', () => {
  test('normalizes local and international forms to E.164', () => {
    expect(normalizePhone('024 412 3456', 'GH')).toBe('+233244123456')
    expect(normalizePhone('+233 24 412 3456', 'GH')).toBe('+233244123456')
    expect(normalizePhone('00233244123456', 'GH')).toBe('+233244123456')
    expect(normalizePhone('233244123456', 'GH')).toBe('+233244123456')
    expect(normalizePhone('244123456', 'GH')).toBe('+233244123456')
    expect(normalizePhone('0803 123 4567', 'NG')).toBe('+2348031234567')
    expect(normalizePhone('(024) 412-3456')).toBe('+233244123456')
    expect(normalizePhone('call me')).toBeNull()
    expect(normalizePhone('123')).toBeNull()
    expect(normalizePhone('+1234567890123456')).toBeNull()
    expect(maskPhone('+233244123456')).toBe('+233 ••• ••456')
  })
})

describe('provider adapters build the documented requests', () => {
  const sms = { to: '+233244123456', body: 'Hello', channel: 'sms' as const }

  test('Hubtel: JSON POST with Basic auth, number without +', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ messageId: 'm-1', status: 0, statusDescription: 'request submitted successfully' }),
    )
    const result = await ADAPTERS.hubtel.send(
      sms, { clientId: 'id', clientSecret: 'secret' }, { senderId: 'Anowa', settings: {} },
      fetchMock as any,
    )
    expect(result).toEqual({ ok: true, providerMessageId: 'm-1' })
    const [url, init] = fetchMock.mock.calls[0] as any
    expect(url).toBe('https://sms.hubtel.com/v1/messages/send')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(`Basic ${btoa('id:secret')}`)
    expect(JSON.parse(init.body)).toEqual({ From: 'Anowa', To: '233244123456', Content: 'Hello' })
  })

  test('Hubtel: non-zero status inside a 201 is a failure', async () => {
    const fetchMock = vi.fn(async () => okResponse({ status: 2, statusDescription: 'invalid source' }))
    const result = await ADAPTERS.hubtel.send(
      sms, { clientId: 'id', clientSecret: 'secret' }, { senderId: 'X', settings: {} }, fetchMock as any,
    )
    expect(result.ok).toBe(false)
  })

  test("Africa's Talking: form POST with apiKey header; per-recipient status checked", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        SMSMessageData: {
          Message: 'Sent to 1/1',
          Recipients: [{ statusCode: 101, status: 'Success', messageId: 'ATXid_1', number: '+233244123456' }],
        },
      }),
    )
    const result = await ADAPTERS.africastalking.send(
      sms, { apiKey: 'at-key' }, { senderId: 'ANOWA', settings: { username: 'farm' } }, fetchMock as any,
    )
    expect(result).toEqual({ ok: true, providerMessageId: 'ATXid_1' })
    const [url, init] = fetchMock.mock.calls[0] as any
    expect(url).toBe('https://api.africastalking.com/version1/messaging')
    expect(init.headers.apiKey).toBe('at-key')
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    const form = new URLSearchParams(init.body)
    expect(form.get('username')).toBe('farm')
    expect(form.get('to')).toBe('+233244123456')
    expect(form.get('message')).toBe('Hello')
    expect(form.get('from')).toBe('ANOWA')

    const sandbox = vi.fn(async () =>
      okResponse({ SMSMessageData: { Recipients: [{ statusCode: 403, status: 'InvalidPhoneNumber' }] } }),
    )
    const failed = await ADAPTERS.africastalking.send(
      sms, { apiKey: 'k' }, { settings: { username: 'sandbox' } }, sandbox as any,
    )
    expect(failed.ok).toBe(false)
    expect((sandbox.mock.calls[0] as any)[0]).toBe('https://api.sandbox.africastalking.com/version1/messaging')
  })

  test('Twilio SMS and WhatsApp: form POST to Messages.json with Basic auth', async () => {
    const fetchMock = vi.fn(async () => okResponse({ sid: 'SM123', status: 'queued' }))
    const creds = { accountSid: 'AC1', authToken: 'tok' }
    const result = await ADAPTERS.twilio.send(sms, creds, { senderId: '+15550001111', settings: {} }, fetchMock as any)
    expect(result).toEqual({ ok: true, providerMessageId: 'SM123' })
    const [url, init] = fetchMock.mock.calls[0] as any
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json')
    expect(init.headers.Authorization).toBe(`Basic ${btoa('AC1:tok')}`)
    const form = new URLSearchParams(init.body)
    expect(form.get('To')).toBe('+233244123456')
    expect(form.get('From')).toBe('+15550001111')
    expect(form.get('Body')).toBe('Hello')

    await ADAPTERS.twilio_whatsapp.send(
      { to: '+233244123456', body: 'Code 123456', channel: 'whatsapp', otpCode: '123456' },
      creds,
      { senderId: '+15550001111', settings: { contentSid: 'HXabc' } },
      fetchMock as any,
    )
    const wa = new URLSearchParams((fetchMock.mock.calls[1] as any)[1].body)
    expect(wa.get('To')).toBe('whatsapp:+233244123456')
    expect(wa.get('From')).toBe('whatsapp:+15550001111')
    expect(wa.get('ContentSid')).toBe('HXabc')
    expect(JSON.parse(wa.get('ContentVariables')!)).toEqual({ 1: '123456' })
    expect(wa.get('Body')).toBeNull()
  })

  test('Twilio error body becomes a short failure', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ status: 400, message: 'No to number is specified', code: 21201 }, 400),
    )
    const result = await ADAPTERS.twilio.send(sms, { accountSid: 'AC1', authToken: 't' }, { settings: {} }, fetchMock as any)
    expect(result).toEqual({ ok: false, error: 'Twilio 21201: No to number is specified', retryable: false })
  })

  test('WhatsApp Cloud: authentication template with the code in body and button', async () => {
    const fetchMock = vi.fn(async () => okResponse({ messages: [{ id: 'wamid.1' }] }, 200))
    const result = await ADAPTERS.whatsapp_cloud.send(
      { to: '+233244123456', body: 'ignored', channel: 'whatsapp', otpCode: '654321' },
      { accessToken: 'EAAG' },
      { settings: { phoneNumberId: '1055', templateName: 'anowa_login', templateLanguage: 'en' } },
      fetchMock as any,
    )
    expect(result).toEqual({ ok: true, providerMessageId: 'wamid.1' })
    const [url, init] = fetchMock.mock.calls[0] as any
    expect(url).toBe('https://graph.facebook.com/v27.0/1055/messages')
    expect(init.headers.Authorization).toBe('Bearer EAAG')
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+233244123456',
      type: 'template',
      template: {
        name: 'anowa_login',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '654321' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '654321' }] },
        ],
      },
    })
  })

  test('Resend: JSON POST with Bearer key and a User-Agent', async () => {
    const fetchMock = vi.fn(async () => okResponse({ id: 'em-1' }, 200))
    const result = await ADAPTERS.resend.send(
      { to: 'a@b.com', body: 'Hi', subject: 'S', channel: 'email' },
      { apiKey: 're_123' },
      { senderId: 'Farm <x@farm.com>', settings: {} },
      fetchMock as any,
    )
    expect(result).toEqual({ ok: true, providerMessageId: 'em-1' })
    const [url, init] = fetchMock.mock.calls[0] as any
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers.Authorization).toBe('Bearer re_123')
    expect(init.headers['User-Agent']).toBeTruthy()
    expect(JSON.parse(init.body)).toEqual({ from: 'Farm <x@farm.com>', to: ['a@b.com'], subject: 'S', text: 'Hi' })
  })

  test('network errors are reported, not thrown', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    })
    const result = await ADAPTERS.hubtel.send(sms, { clientId: 'a', clientSecret: 'b' }, { settings: {} }, fetchMock as any)
    expect(result).toMatchObject({ ok: false, retryable: true })
  })
})

describe('platform default from the environment', () => {
  test('complete configuration resolves; incomplete is ignored', () => {
    const env = {
      PLATFORM_SMS_PROVIDER: 'hubtel',
      PLATFORM_SMS_SENDER: 'Anowa',
      PLATFORM_HUBTEL_CLIENT_ID: 'id',
      PLATFORM_HUBTEL_CLIENT_SECRET: 'secret',
    }
    const resolved = platformChannelFromEnv('sms', env)
    expect(resolved?.adapter.id).toBe('hubtel')
    expect(resolved?.creds).toEqual({ clientId: 'id', clientSecret: 'secret' })
    expect(resolved?.config.senderId).toBe('Anowa')
    expect(platformChannelFromEnv('sms', { ...env, PLATFORM_HUBTEL_CLIENT_SECRET: '' })).toBeNull()
    expect(platformChannelFromEnv('sms', { ...env, PLATFORM_SMS_PROVIDER: 'resend' })).toBeNull()
    expect(platformChannelFromEnv('whatsapp', env)).toBeNull()
  })
})

describe('channel settings (admin only, own company only)', () => {
  test('admin saves a channel and credentials; no query ever returns the secret', async () => {
    const s = await setup()
    const channelId = await hubtelChannel(s)
    const overview = await s.as(s.adminA).query(api.messaging.channels.overview, {})
    expect(overview.encryptionReady).toBe(true)
    expect(overview.channels).toHaveLength(1)
    expect(overview.channels[0]).toMatchObject({
      id: channelId, channel: 'sms', provider: 'hubtel', status: 'draft',
      credentialsConfigured: true, credentialHint: '…4F2a',
    })
    const stored = await s.t.run((ctx) =>
      ctx.db.query('integrationSecrets').withIndex('by_channel', (q) => q.eq('channelId', channelId)).unique(),
    )
    expect(stored).not.toBeNull()
    expect(stored!.ciphertext).not.toContain(SECRET)
    const json = JSON.stringify(overview)
    expect(json).not.toContain(SECRET)
    expect(json).not.toContain('client-id-123')
    expect(json).not.toContain(stored!.ciphertext)
    expect(json).not.toContain(stored!.iv)
    // Audit rows never hold the value either.
    const audit = await s.t.run((ctx) => ctx.db.query('auditLogs').collect())
    expect(JSON.stringify(audit)).not.toContain(SECRET)
    expect(audit.some((a) => a.actionType === 'messaging_credentials_set')).toBe(true)
  })

  test('non-admin is refused everywhere', async () => {
    const s = await setup()
    const channelId = await hubtelChannel(s)
    const staff = s.as(s.staffA)
    const DENIED = 'Insufficient permissions'
    expect(await messageOf(staff.query(api.messaging.channels.overview, {}))).toContain(DENIED)
    expect(
      await messageOf(staff.mutation(api.messaging.channels.saveChannel, { channel: 'sms', provider: 'twilio' })),
    ).toContain(DENIED)
    expect(
      await messageOf(staff.action(api.messaging.channels.saveCredentials, { channelId, credentials: { clientId: 'x', clientSecret: 'y' } })),
    ).toContain(DENIED)
    expect(await messageOf(staff.action(api.messaging.channels.sendTest, { channelId, to: '0244123456' }))).toContain(DENIED)
    expect(await messageOf(staff.mutation(api.messaging.channels.disableChannel, { channelId }))).toContain(DENIED)
    expect(await messageOf(staff.mutation(api.messaging.channels.updatePreferences, { defaultCountryCode: 'NG' }))).toContain(DENIED)
  })

  test("another company's admin cannot see, change, test or overwrite a channel", async () => {
    const s = await setup()
    const channelId = await hubtelChannel(s)
    const adminB = s.as(s.adminB)
    const overviewB = await adminB.query(api.messaging.channels.overview, {})
    expect(overviewB.channels).toHaveLength(0)
    const NOT_FOUND = 'Messaging channel not found'
    expect(
      await messageOf(adminB.action(api.messaging.channels.saveCredentials, { channelId, credentials: { clientId: 'x', clientSecret: 'attacker' } })),
    ).toContain(NOT_FOUND)
    expect(await messageOf(adminB.action(api.messaging.channels.sendTest, { channelId, to: '0244123456' }))).toContain(NOT_FOUND)
    expect(await messageOf(adminB.mutation(api.messaging.channels.disableChannel, { channelId }))).toContain(NOT_FOUND)
    expect(await messageOf(adminB.mutation(api.messaging.channels.removeChannel, { channelId }))).toContain(NOT_FOUND)
    const row = await s.t.run((ctx) => ctx.db.get(channelId))
    expect(row?.status).toBe('draft')
  })

  test('without the encryption key, credentials are refused and everything else works', async () => {
    vi.stubEnv('INTEGRATIONS_ENCRYPTION_KEY', '')
    const s = await setup()
    const admin = s.as(s.adminA)
    const channelId = await admin.mutation(api.messaging.channels.saveChannel, {
      channel: 'sms', provider: 'hubtel', senderId: 'Anowa',
    })
    const overview = await admin.query(api.messaging.channels.overview, {})
    expect(overview.encryptionReady).toBe(false)
    expect(
      await messageOf(admin.action(api.messaging.channels.saveCredentials, { channelId, credentials: { clientId: 'a', clientSecret: SECRET } })),
    ).toContain('INTEGRATIONS_ENCRYPTION_KEY')
    const secrets = await s.t.run((ctx) => ctx.db.query('integrationSecrets').collect())
    expect(secrets).toHaveLength(0)
    await admin.mutation(api.messaging.channels.updatePreferences, { defaultCountryCode: 'NG' })
    expect((await admin.query(api.messaging.channels.overview, {})).defaultCountryCode).toBe('NG')
  })

  test('validation: provider must fit the channel, required fields enforced', async () => {
    const s = await setup()
    const admin = s.as(s.adminA)
    expect(
      await messageOf(admin.mutation(api.messaging.channels.saveChannel, { channel: 'sms', provider: 'resend' })),
    ).toContain('cannot send sms')
    expect(
      await messageOf(admin.mutation(api.messaging.channels.saveChannel, { channel: 'sms', provider: 'hubtel' })),
    ).toContain('required')
    expect(
      await messageOf(admin.mutation(api.messaging.channels.saveChannel, {
        channel: 'whatsapp', provider: 'whatsapp_cloud', settings: { phoneNumberId: '1' },
      })),
    ).toContain('template name is required')
    const id = await hubtelChannel(s)
    expect(
      await messageOf(admin.action(api.messaging.channels.saveCredentials, { channelId: id, credentials: { clientId: 'a' } })),
    ).toContain('Client secret is required')
    expect(
      await messageOf(admin.action(api.messaging.channels.saveCredentials, { channelId: id, credentials: { clientId: 'a', clientSecret: 'b', extra: 'c' } })),
    ).toContain('Unknown credential')
  })

  test('changing provider drops the old credentials and resets to draft', async () => {
    const s = await setup()
    const channelId = await hubtelChannel(s)
    await s.as(s.adminA).mutation(api.messaging.channels.saveChannel, {
      channel: 'sms', provider: 'twilio', senderId: '+15550001111',
    })
    const row = await s.t.run((ctx) => ctx.db.get(channelId))
    expect(row).toMatchObject({ provider: 'twilio', status: 'draft' })
    expect(row?.credentialHint).toBeUndefined()
    const secrets = await s.t.run((ctx) => ctx.db.query('integrationSecrets').collect())
    expect(secrets).toHaveLength(0)
  })
})

describe('test send', () => {
  test('success marks the channel verified and is audited without the secret', async () => {
    const s = await setup()
    const channelId = await hubtelChannel(s)
    const fetchMock = vi.fn(async () => okResponse({ messageId: 'm-9', status: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await s.as(s.adminA).action(api.messaging.channels.sendTest, { channelId, to: '024 412 3456' })
    expect(result).toEqual({ ok: true, error: null })
    const [, init] = fetchMock.mock.calls[0] as any
    expect(init.headers.Authorization).toBe(`Basic ${btoa(`client-id-123:${SECRET}`)}`)
    expect(JSON.parse(init.body).To).toBe('233244123456')
    const row = await s.t.run((ctx) => ctx.db.get(channelId))
    expect(row).toMatchObject({ status: 'verified', lastTestResult: 'ok' })
    const audit = await s.t.run((ctx) => ctx.db.query('auditLogs').collect())
    const testRow = audit.find((a) => a.actionType === 'messaging_channel_test')
    expect(testRow?.newValues).toMatchObject({ ok: true, to: '+233 ••• ••456' })
    expect(JSON.stringify(audit)).not.toContain(SECRET)
  })

  test('failure keeps the channel in draft and shows the provider error', async () => {
    const s = await setup()
    const channelId = await hubtelChannel(s)
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ message: 'Unauthorized' }, 401)))
    const result = await s.as(s.adminA).action(api.messaging.channels.sendTest, { channelId, to: '0244123456' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')
    const row = await s.t.run((ctx) => ctx.db.get(channelId))
    expect(row?.status).toBe('draft')
  })

  test('test sends are rate limited per company', async () => {
    const s = await setup()
    const channelId = await hubtelChannel(s)
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ messageId: 'm', status: 0 })))
    for (let i = 0; i < 10; i += 1) {
      await s.as(s.adminA).action(api.messaging.channels.sendTest, { channelId, to: '0244123456' })
    }
    expect(
      await messageOf(s.as(s.adminA).action(api.messaging.channels.sendTest, { channelId, to: '0244123456' })),
    ).toContain('Too many test messages')
  })
})

describe('routing: company channel, platform default, or none', () => {
  test('verified company channel wins; otherwise platform default unless opted out', async () => {
    const s = await setup()
    // No channel, no platform default.
    expect(await s.t.query(internal.messaging.deliver.resolveRoute, { companyId: s.companyA, channel: 'sms' })).toBeNull()

    vi.stubEnv('PLATFORM_SMS_PROVIDER', 'hubtel')
    vi.stubEnv('PLATFORM_SMS_SENDER', 'Anowa')
    vi.stubEnv('PLATFORM_HUBTEL_CLIENT_ID', 'pid')
    vi.stubEnv('PLATFORM_HUBTEL_CLIENT_SECRET', 'psecret')
    expect(await s.t.query(internal.messaging.deliver.resolveRoute, { companyId: s.companyA, channel: 'sms' }))
      .toEqual({ kind: 'platform', provider: 'hubtel' })

    // A draft (untested) company channel does not replace the default.
    const channelId = await hubtelChannel(s)
    expect((await s.t.query(internal.messaging.deliver.resolveRoute, { companyId: s.companyA, channel: 'sms' }))?.kind)
      .toBe('platform')
    await s.t.run((ctx) => ctx.db.patch(channelId, { status: 'verified' }))
    const route = await s.t.query(internal.messaging.deliver.resolveRoute, { companyId: s.companyA, channel: 'sms' })
    expect(route?.kind).toBe('company')

    // Company B opts out of the platform default.
    await s.as(s.adminB).mutation(api.messaging.channels.updatePreferences, { usePlatformDefaultSms: false })
    expect(await s.t.query(internal.messaging.deliver.resolveRoute, { companyId: s.companyB, channel: 'sms' })).toBeNull()
  })
})

describe('secrets stay server-side (doc 10 §10 meta-test)', () => {
  test('integrationSecrets is only read or written by internal functions', () => {
    const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const users = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.ts') && !path.includes('_generated'))
      .filter(([, src]) => src.includes("'integrationSecrets'"))
      .map(([path]) => path)
      .sort()
    // governance.ts only deletes them, when an organization is purged (internal).
    expect(users).toEqual(['./bot/agent.ts', './governance.ts', './inboundWebhooks.ts', './llmGateway.ts', './messaging/channels.ts', './messaging/deliver.ts', './webhooks.ts'])
    // Every function in those modules that returns secret material is internal.
    for (const fn of [
      channels.storeCredentials, channels.prepareTest, deliver.resolveRoute,
      webhooks.insertEndpoint, webhooks.loadForDelivery,
      governance.purgeCompanyBatch,
      inboundWebhooks.storeSecret, inboundWebhooks.lookup,
      llmGateway.storeCredentialSecret, llmGateway.begin,
      botAgent.prepare,
    ] as any[]) {
      expect(fn.isInternal).toBe(true)
    }
  })
})

describe('company settings publish keeps messaging preferences', () => {
  test('publishSettings does not wipe defaultCountryCode or platform opt-outs', async () => {
    const s = await setup()
    const admin = s.as(s.adminA)
    await admin.mutation(api.messaging.channels.updatePreferences, {
      defaultCountryCode: 'KE', usePlatformDefaultSms: false,
    })
    await admin.mutation(api.companies.publishSettings, {})
    const company = await s.t.run((ctx) => ctx.db.get(s.companyA))
    expect(company?.settings?.defaultCountryCode).toBe('KE')
    expect(company?.settings?.messaging?.usePlatformDefaultSms).toBe(false)
  })
})
