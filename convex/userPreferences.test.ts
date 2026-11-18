/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { anonymizeUser } from './governance'
import { cleanPreferences, resolvePreferences } from './lib/userPreferences'

const modules = import.meta.glob('./**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', { name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now })
    const member = async (email: string) => {
      const userId = await ctx.db.insert('users', { email, name: email, role: 'user', companyId })
      await ctx.db.insert('memberships', { userId, companyId, roleKey: 'field_staff', allLocations: true, status: 'active', updatedAt: now })
      return userId
    }
    return { a: await member('a@x.com'), b: await member('b@x.com') }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  return { t, as, ...ids }
}

describe('userPreferences (CUSTOM-007)', () => {
  test('saves per user; another user sees only their own', async () => {
    const { as, a, b } = await setup()
    expect(await as(a).query(api.userPreferences.mine, {})).toBeNull()
    await as(a).mutation(api.userPreferences.update, { dateFormat: 'YYYY-MM-DD', mobileShortcuts: ['/daily-entry', '/harvest'] })
    await as(a).mutation(api.userPreferences.update, { timeFormat: '24h' })
    expect(await as(a).query(api.userPreferences.mine, {})).toMatchObject({
      dateFormat: 'YYYY-MM-DD',
      timeFormat: '24h',
      mobileShortcuts: ['/daily-entry', '/harvest'],
    })
    expect(await as(b).query(api.userPreferences.mine, {})).toBeNull()
  })

  test('null shortcuts go back to the defaults', async () => {
    const { as, a } = await setup()
    await as(a).mutation(api.userPreferences.update, { mobileShortcuts: ['/cages'] })
    await as(a).mutation(api.userPreferences.update, { mobileShortcuts: null })
    const row = await as(a).query(api.userPreferences.mine, {})
    expect(row?.mobileShortcuts).toBeUndefined()
  })

  test('rejects invalid values and more than five shortcuts', async () => {
    const { as, a } = await setup()
    await expect(as(a).mutation(api.userPreferences.update, { dateFormat: 'dd.mm' })).rejects.toThrow(/dateFormat/)
    await expect(
      as(a).mutation(api.userPreferences.update, { mobileShortcuts: ['/a', '/b', '/c', '/d', '/e', '/f'] }),
    ).rejects.toThrow(/mobileShortcuts/)
    await expect(
      as(a).mutation(api.userPreferences.update, { mobileShortcuts: ['https://evil.example'] }),
    ).rejects.toThrow(/mobileShortcuts/)
    expect(await as(a).query(api.userPreferences.mine, {})).toBeNull()
  })

  test('device import runs once and never overwrites saved preferences', async () => {
    const { as, a } = await setup()
    const legacy = { language: 'fr', dateFormat: 'MM/DD/YYYY', currency: 'USD', timeFormat: 'bogus' }
    expect(await as(a).mutation(api.userPreferences.importFromDevice, { settings: legacy })).toBe(true)
    expect(await as(a).mutation(api.userPreferences.importFromDevice, { settings: { dateFormat: 'YYYY-MM-DD' } })).toBe(false)
    const row = await as(a).query(api.userPreferences.mine, {})
    expect(row).toMatchObject({ dateFormat: 'MM/DD/YYYY', currency: 'USD' })
    expect(row?.timeFormat).toBeUndefined()
  })

  test('requires a signed-in user', async () => {
    const { t } = await setup()
    await expect(t.query(api.userPreferences.mine, {})).rejects.toThrow()
  })

  test('account deletion removes the preferences', async () => {
    const { t, as, a } = await setup()
    await as(a).mutation(api.userPreferences.update, { currency: 'EUR' })
    await t.run(async (ctx) => {
      await anonymizeUser(ctx, a)
      expect(await ctx.db.query('userPreferences').collect()).toHaveLength(0)
    })
  })
})

describe('preference helpers', () => {
  test('cleanPreferences keeps valid fields and drops the rest', () => {
    expect(
      cleanPreferences({
        dateFormat: 'YYYY-MM-DD',
        currency: 'usd',
        notifications: { email: true },
        mobileShortcuts: ['/a', '/a', 'b', '/c?x=1', '/d'],
        extra: 1,
      }),
    ).toEqual({ dateFormat: 'YYYY-MM-DD', mobileShortcuts: ['/a', '/d'] })
    expect(cleanPreferences('nope')).toEqual({})
  })

  test('resolvePreferences layers saved values over defaults', () => {
    const p = resolvePreferences({ dateFormat: 'MM/DD/YYYY' }, { timeFormat: '24h', dateFormat: 'bad' })
    expect(p).toMatchObject({ dateFormat: 'MM/DD/YYYY', timeFormat: '24h', currency: 'GHS', mobileShortcuts: null })
  })
})
