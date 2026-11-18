/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { DEFAULT_TILAPIA_GRADES, gradeProblems, gradeRange } from './lib/species'
import { CURRENCY_CODES, isCurrencyCode } from './lib/currencies'
import { mergeSettings, validateSettingsForPublish } from './lib/farmRules'

const modules = import.meta.glob('./**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now })
    const other = await ctx.db.insert('companies', { name: 'River', code: 'RIV', status: 'approved', createdAt: now })
    const admin = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const viewer = await ctx.db.insert('users', { email: 'v@x.com', role: 'user', companyId })
    await ctx.db.insert('memberships', { userId: viewer, companyId, roleKey: 'viewer', allLocations: true, status: 'active', updatedAt: now })
    const outsider = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: other })
    return { companyId, admin, viewer, outsider }
  })
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` })
  return { t, as, ...ids }
}

describe('species configuration (D-012)', () => {
  test('grade ranges keep the wording the harvest form always showed', () => {
    expect(DEFAULT_TILAPIA_GRADES.map(gradeRange)).toEqual([
      '800g above', '700g-800g', '600g-700g', '500g-600g', '400g-500g', '300g-400g', '200g-300g', 'less than 200g',
    ])
    expect(gradeProblems([{ key: 'A', label: 'A', minG: 5, maxG: 2 }])[0]).toMatch(/lower weight/)
    expect(gradeProblems([{ key: 'A', label: 'A' }, { key: 'A', label: 'B' }])[0]).toMatch(/twice/)
    expect(gradeProblems(Array.from({ length: 13 }, (_, i) => ({ key: `G${i}`, label: 'x' })))[0]).toMatch(/At most 12/)
  })

  test('seed defaults, edit grades, archive; tenant-scoped and permission-guarded', async () => {
    const { as, admin, viewer, outsider } = await setup()
    expect(await as(admin).query(api.species.list, {})).toEqual([])
    expect((await as(admin).mutation(api.species.ensureDefaults, {})).added).toEqual(['nile_tilapia', 'red_tilapia', 'african_catfish'])
    expect((await as(admin).mutation(api.species.ensureDefaults, {})).added).toEqual([])

    const list = await as(viewer).query(api.species.list, {})
    const tilapia = list.find((s: any) => s.key === 'nile_tilapia')!
    expect(tilapia.harvestGrades.map((g: any) => g.key)).toEqual(['S3', 'S2', 'S1', 'Reg', 'Eco', 'SS', 'SB', 'Rej'])
    expect(tilapia.harvestGrades[0].range).toBe('800g above')

    await expect(as(viewer).mutation(api.species.ensureDefaults, {})).rejects.toThrow(/FORBIDDEN|Insufficient/)
    expect(await as(outsider).query(api.species.list, {})).toEqual([])

    await as(admin).mutation(api.species.upsert, {
      id: tilapia.id, key: 'nile_tilapia', name: 'Nile tilapia', targetHarvestAbwG: 450,
      harvestGrades: [{ key: 'L', label: 'Large', minG: 500 }, { key: 'S', label: 'Small', maxG: 500 }],
    })
    await expect(
      as(admin).mutation(api.species.upsert, { key: 'nile_tilapia', name: 'Dup', harvestGrades: [] }),
    ).rejects.toThrow(/already exists/)
    await expect(
      as(admin).mutation(api.species.upsert, {
        key: 'carp', name: 'Carp', harvestGrades: [{ key: 'A', label: 'A', minG: 9, maxG: 1 }],
      }),
    ).rejects.toThrow(/lower weight/)
    await expect(as(outsider).mutation(api.species.upsert, { id: tilapia.id, key: 'nile_tilapia', name: 'X', harvestGrades: [] })).rejects.toThrow(/not found/)

    const after = await as(admin).query(api.species.list, {})
    expect(after.find((s: any) => s.key === 'nile_tilapia')).toMatchObject({ targetHarvestAbwG: 450 })
    await as(admin).mutation(api.species.archive, { id: tilapia.id })
    expect((await as(admin).query(api.species.list, {})).map((s: any) => s.key)).not.toContain('nile_tilapia')
    expect((await as(admin).query(api.species.list, { includeArchived: true })).length).toBe(3)
  })
})

describe('currencies beyond GHS (I18N-003)', () => {
  test('the list is accepted by settings validation and merge', () => {
    expect(CURRENCY_CODES.length).toBeGreaterThan(20)
    expect(isCurrencyCode('KES')).toBe(true)
    expect(isCurrencyCode('ABC')).toBe(false)
    expect(mergeSettings({ locale: { currency: 'NGN' } }).locale.currency).toBe('NGN')
    expect(mergeSettings({ locale: { currency: 'ABC' } }).locale.currency).toBe('GHS')
    expect(() => validateSettingsForPublish({ locale: { currency: 'XOF' } })).not.toThrow()
    expect(() => validateSettingsForPublish({ locale: { currency: 'ABC' } })).toThrow(/ABC is not supported/)
  })
})

describe('users.setLocale (I18N-002)', () => {
  test('stores a supported language on the caller only', async () => {
    const { t, as, admin } = await setup()
    await as(admin).mutation(api.users.setLocale, { locale: 'fr' })
    expect((await t.run((ctx) => ctx.db.get(admin as any))) as any).toMatchObject({ locale: 'fr' })
    expect(((await as(admin).query(api.users.current, {})) as any).locale).toBe('fr')
    await expect(as(admin).mutation(api.users.setLocale, { locale: 'de' })).rejects.toThrow(/not available/)
    await as(admin).mutation(api.users.setLocale, { locale: null })
    expect(((await t.run((ctx) => ctx.db.get(admin as any))) as any).locale).toBeUndefined()
  })
})
