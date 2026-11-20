/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { PasswordProvider } from './auth'
import { oidcProviderFromEnv, oidcProfile } from './lib/sso'

const modules = import.meta.glob('./**/*.ts')

/** CF-003: Turnstile tickets on the public forms. */
async function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { email: 'new@x.com', role: 'user' })
    const sessionId = await ctx.db.insert('authSessions', { userId, expirationTime: Date.now() + 1e7 })
    return { userId, sessionId }
  })
  return { t, ...ids, as: t.withIdentity({ subject: `${ids.userId}|${ids.sessionId}` }) }
}

function mockSiteverify(body: Record<string, unknown>) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const company = (code: string, humanTicket?: string) => ({ name: `Farm ${code}`, code, humanTicket })

describe('human checks', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('off when TURNSTILE_SECRET_KEY is unset: no ticket needed, Cloudflare not called', async () => {
    const s = await setup()
    const fetch = mockSiteverify({ success: true })
    expect(await s.t.action(api.humanVerification.verify, { token: 't', purpose: 'signup' })).toEqual({ ticket: null })
    expect(fetch).not.toHaveBeenCalled()
    expect(await s.as.mutation(api.companies.register, company('ONE'))).toBeTruthy()
  })

  describe('with Turnstile on', () => {
    beforeEach(() => vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk'))

    test('register needs a fresh ticket for that purpose, used once', async () => {
      const s = await setup()
      await expect(s.as.mutation(api.companies.register, company('ONE'))).rejects.toThrow(/human check/)

      mockSiteverify({ success: true, action: 'register_company' })
      const { ticket } = await s.t.action(api.humanVerification.verify, { token: 't', purpose: 'register_company' })
      expect(ticket).toEqual(expect.any(String))
      // Only a hash is stored.
      const rows = await s.t.run((ctx) => ctx.db.query('humanTickets').collect())
      expect(JSON.stringify(rows)).not.toContain(ticket!)

      expect(await s.as.mutation(api.companies.register, company('ONE', ticket!))).toBeTruthy()
      await expect(s.as.mutation(api.companies.register, company('TWO', ticket!))).rejects.toThrow(/human check/)
    })

    test('a ticket for another purpose, or an expired one, is refused', async () => {
      const s = await setup()
      mockSiteverify({ success: true, action: 'signup' })
      const { ticket } = await s.t.action(api.humanVerification.verify, { token: 't', purpose: 'signup' })
      await expect(s.as.mutation(api.companies.register, company('ONE', ticket!))).rejects.toThrow(/human check/)

      mockSiteverify({ success: true, action: 'register_company' })
      const fresh = await s.t.action(api.humanVerification.verify, { token: 't', purpose: 'register_company' })
      await s.t.run(async (ctx) => {
        for (const r of await ctx.db.query('humanTickets').collect()) await ctx.db.patch(r._id, { expiresAt: Date.now() - 1 })
      })
      await expect(s.as.mutation(api.companies.register, company('ONE', fresh.ticket!))).rejects.toThrow(/human check/)
    })

    test('a failed challenge yields no ticket', async () => {
      const s = await setup()
      mockSiteverify({ success: false, 'error-codes': ['invalid-input-response'] })
      await expect(s.t.action(api.humanVerification.verify, { token: 't', purpose: 'signup' })).rejects.toThrow(
        /could not confirm you are human/,
      )
      expect(await s.t.run((ctx) => ctx.db.query('humanTickets').collect())).toEqual([])
    })

    test('password sign-up and reset consume a ticket; sign-in does not', async () => {
      const s = await setup()
      const options = (PasswordProvider as unknown as {
        options: { authorize: (p: Record<string, unknown>, ctx: unknown) => Promise<unknown> }
      }).options
      const ctx = { runMutation: (ref: any, args: any) => s.t.mutation(ref, args) }
      await expect(options.authorize({ flow: 'signUp', email: 'a@b.c', password: 'secret12' }, ctx)).rejects.toThrow(
        /human check/,
      )
      await expect(options.authorize({ flow: 'reset', email: 'a@b.c' }, ctx)).rejects.toThrow(/human check/)
      // signIn is not gated: it fails later, inside the library, not on the ticket.
      await expect(options.authorize({ flow: 'signIn', email: 'a@b.c', password: 'x' }, ctx)).rejects.not.toThrow(
        /human check/,
      )
      mockSiteverify({ success: true, action: 'password_reset' })
      const { ticket } = await s.t.action(api.humanVerification.verify, { token: 't', purpose: 'password_reset' })
      await s.t.mutation(internal.humanVerification.consumeTicket, { ticket: ticket!, purpose: 'password_reset' })
      await expect(
        s.t.mutation(internal.humanVerification.consumeTicket, { ticket: ticket!, purpose: 'password_reset' }),
      ).rejects.toThrow(/human check/)
    })
  })
})

type Authorize = (p: Record<string, unknown>, ctx: unknown) => Promise<unknown>
const authorizeOf = () => (PasswordProvider as unknown as { options: { authorize: Authorize } }).options.authorize
const ctxOf = (s: Awaited<ReturnType<typeof setup>>) => ({ runMutation: (ref: any, args: any) => s.t.mutation(ref, args) })
const failures = (s: Awaited<ReturnType<typeof setup>>, email: string) =>
  s.t.run(async (ctx) => (await ctx.db.query('signInFailures').withIndex('by_email', (q) => q.eq('email', email)).unique())?.count ?? 0)

describe('password sign-in hardening (CF-003)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
  const wrong = (email = 'Who@X.com', humanTicket?: string) => ({ flow: 'signIn', email, password: 'nope', humanTicket })

  test('Turnstile off: failures are counted per email but no human check is asked for', async () => {
    const s = await setup()
    const authorize = authorizeOf()
    for (let i = 0; i < 5; i++) {
      await expect(authorize(wrong(), ctxOf(s))).rejects.not.toThrow(/human check/)
    }
    expect(await failures(s, 'who@x.com')).toBe(5)
  })

  test('Turnstile on: after 3 failures the next attempt needs a signin ticket; success resets', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk')
    const s = await setup()
    const authorize = authorizeOf()
    for (let i = 0; i < 3; i++) {
      await expect(authorize(wrong(), ctxOf(s))).rejects.not.toThrow(/human check/)
    }
    await expect(authorize(wrong(), ctxOf(s))).rejects.toThrow(/human check/)
    // Refused before the password was checked: not counted again.
    expect(await failures(s, 'who@x.com')).toBe(3)
    // Another email is unaffected.
    await expect(authorize(wrong('other@x.com'), ctxOf(s))).rejects.not.toThrow(/human check/)

    mockSiteverify({ success: true, action: 'signin' })
    const { ticket } = await s.t.action(api.humanVerification.verify, { token: 't', purpose: 'signin' })
    await expect(authorize(wrong('who@x.com', ticket!), ctxOf(s))).rejects.not.toThrow(/human check/)
    expect(await failures(s, 'who@x.com')).toBe(4)

    await s.t.mutation(internal.authGuard.recordPasswordSignIn, { email: 'who@x.com', ok: true })
    expect(await failures(s, 'who@x.com')).toBe(0)
    await expect(
      s.t.mutation(internal.authGuard.beforePasswordSignIn, { email: 'who@x.com' }),
    ).resolves.toBeNull()
  })

  test('too many failures for one email are refused outright', async () => {
    const s = await setup()
    for (let i = 0; i < 20; i++) {
      await s.t.mutation(internal.authGuard.recordPasswordSignIn, { email: 'who@x.com', ok: false })
    }
    await expect(authorizeOf()(wrong(), ctxOf(s))).rejects.toThrow(/Too many failed sign-in attempts/)
    await expect(authorizeOf()(wrong('other@x.com'), ctxOf(s))).rejects.not.toThrow(/Too many/)
  })
})

describe('sign-up ticket grant (CF-003)', () => {
  beforeEach(() => vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk'))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  async function signupTicket(s: Awaited<ReturnType<typeof setup>>) {
    mockSiteverify({ success: true, action: 'signup' })
    return (await s.t.action(api.humanVerification.verify, { token: 't', purpose: 'signup' })).ticket!
  }
  const consume = (s: Awaited<ReturnType<typeof setup>>, ticket: string, email?: string) =>
    s.t.mutation(internal.humanVerification.consumeTicket, { ticket, purpose: 'signup', email })

  test('a failed sign-up can resend the same ticket for the same email', async () => {
    const s = await setup()
    const ticket = await signupTicket(s)
    // Too short a password: the sign-up fails after the ticket was used…
    await expect(
      authorizeOf()({ flow: 'signUp', email: 'New@X.com', password: '123', humanTicket: ticket }, ctxOf(s)),
    ).rejects.toThrow(/at least 6 characters/)
    // …and the same ticket still passes the human check for that email.
    await expect(consume(s, ticket, 'new@x.com')).resolves.toBeNull()
    // Not for another email, nor without one.
    await expect(consume(s, ticket, 'else@x.com')).rejects.toThrow(/human check/)
    await expect(consume(s, ticket)).rejects.toThrow(/human check/)
  })

  test('the grant expires after a few minutes and is limited in uses', async () => {
    const s = await setup()
    const ticket = await signupTicket(s)
    await consume(s, ticket, 'new@x.com')
    for (let i = 0; i < 5; i++) await consume(s, ticket, 'new@x.com')
    await expect(consume(s, ticket, 'new@x.com')).rejects.toThrow(/human check/)

    const other = await signupTicket(s)
    await consume(s, other, 'b@x.com')
    await s.t.run(async (ctx) => {
      for (const r of await ctx.db.query('humanTickets').collect()) await ctx.db.patch(r._id, { grantExpiresAt: Date.now() - 1 })
    })
    await expect(consume(s, other, 'b@x.com')).rejects.toThrow(/human check/)
  })

  test('overlong emails are refused, so long addresses cannot share one grant', async () => {
    const s = await setup()
    const ticket = await signupTicket(s)
    const long = (tail: string) => `${'a'.repeat(330)}${tail}@x.com`
    for (const email of [long('1'), long('2')]) {
      await expect(
        authorizeOf()({ flow: 'signUp', email, password: 'secret123', humanTicket: ticket }, ctxOf(s)),
      ).rejects.toThrow(/valid email/)
    }
    await expect(
      authorizeOf()({ flow: 'signUp', email: 'not-an-email', password: 'secret123', humanTicket: ticket }, ctxOf(s)),
    ).rejects.toThrow(/valid email/)
    // Refused before the ticket was touched: it still works once for a real address.
    await expect(consume(s, ticket, 'real@x.com')).resolves.toBeNull()
  })

  test('tickets for other purposes get no grant', async () => {
    const s = await setup()
    mockSiteverify({ success: true, action: 'password_reset' })
    const { ticket } = await s.t.action(api.humanVerification.verify, { token: 't', purpose: 'password_reset' })
    await s.t.mutation(internal.humanVerification.consumeTicket, { ticket: ticket!, purpose: 'password_reset', email: 'a@x.com' })
    await expect(
      s.t.mutation(internal.humanVerification.consumeTicket, { ticket: ticket!, purpose: 'password_reset', email: 'a@x.com' }),
    ).rejects.toThrow(/human check/)
  })
})

describe('SSO (ENT-003)', () => {
  test('no provider unless issuer, id and secret are all set', () => {
    expect(oidcProviderFromEnv({})).toEqual([])
    expect(oidcProviderFromEnv({ AUTH_OIDC_ISSUER: 'https://idp.example', AUTH_OIDC_ID: 'id' })).toEqual([])
    const [p] = oidcProviderFromEnv({
      AUTH_OIDC_ISSUER: 'https://idp.example/',
      AUTH_OIDC_ID: 'id',
      AUTH_OIDC_SECRET: 'secret',
      AUTH_OIDC_NAME: 'Contoso',
    })
    expect(p).toMatchObject({ id: 'oidc', type: 'oidc', name: 'Contoso', issuer: 'https://idp.example', clientId: 'id' })
  })

  test('profile never carries a role and links by email only when the IdP verified it', () => {
    expect(oidcProfile({ sub: 's1', email: 'A@X.com', email_verified: true, name: 'A' })).toEqual({
      id: 's1',
      email: 'a@x.com',
      name: 'A',
      emailVerified: true,
    })
    expect(oidcProfile({ sub: 's2', email: 'b@x.com' })).toMatchObject({ emailVerified: false })
    expect(oidcProfile({ sub: 's3', email: 'c@x.com', email_verified: true })).not.toHaveProperty('role')
  })
})
