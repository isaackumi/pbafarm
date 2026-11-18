/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { TERM_KEYS, isTermKey, normalizeTerminology, terminologyOf } from './lib/terminology'

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
    return { companyId, other, admin, viewer, outsider }
  })
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` })
  return { t, as, ...ids }
}

describe('organization words (CUSTOM-003)', () => {
  test('the allow-list covers every built-in unit type and daily noun', () => {
    expect(TERM_KEYS).toContain('cage')
    expect(TERM_KEYS).toContain('cagePlural')
    expect(TERM_KEYS).toContain('feed')
    expect(TERM_KEYS).toContain('harvest')
    expect(TERM_KEYS).toContain('sampling')
    expect(isTermKey('cage')).toBe(true)
    expect(isTermKey('bogus')).toBe(false)
  })

  test('normalization trims, drops blanks, and refuses unknown, long or control-character values', () => {
    expect(normalizeTerminology({ cage: '  Pen ', cagePlural: 'Pens', pond: '   ' })).toEqual({
      cage: 'Pen',
      cagePlural: 'Pens',
    })
    expect(() => normalizeTerminology({ bogus: 'x' })).toThrow(/Unknown word setting/)
    expect(() => normalizeTerminology({ cage: 'x'.repeat(41) })).toThrow(/longer than 40/)
    expect(() => normalizeTerminology({ cage: 'bad\u0007word' })).toThrow(/control character/)
    expect(() => normalizeTerminology([] as any)).toThrow(/key\/value/)
  })

  test('stored words are read defensively', () => {
    expect(terminologyOf(null)).toEqual({})
    expect(terminologyOf({ terminology: { cage: 'Pen', bogus: 'x', feed: '  ' } })).toEqual({ cage: 'Pen' })
    expect(terminologyOf({ terminology: { cage: '  Pen  ' } })).toEqual({ cage: 'Pen' })
  })
})

describe('terminology settings', () => {
  test('an admin renames words for their own company; viewers cannot write', async () => {
    const { t, as, companyId, admin, viewer, outsider } = await setup()

    expect(await as(admin).query(api.terminology.get, {})).toEqual({})
    const saved = await as(admin).mutation(api.terminology.update, {
      terms: { cage: 'Pen', cagePlural: 'Pens', feed: 'Ration', feedPlural: 'Rations' },
    })
    expect(saved).toEqual({ cage: 'Pen', cagePlural: 'Pens', feed: 'Ration', feedPlural: 'Rations' })
    expect(await as(admin).query(api.terminology.get, {})).toEqual(saved)

    const company = await t.run((ctx) => ctx.db.get(companyId as any))
    expect((company as any).terminology).toEqual(saved)

    // Other companies are unaffected, and their admins only see their own.
    expect(await as(outsider).query(api.terminology.get, {})).toEqual({})
    await as(outsider).mutation(api.terminology.update, { terms: { cage: 'Hapa' } })
    expect(await as(admin).query(api.terminology.get, {})).toEqual(saved)

    await expect(
      as(viewer).mutation(api.terminology.update, { terms: { cage: 'Pen' } }),
    ).rejects.toThrow(/FORBIDDEN|Insufficient/)

    // The settings query used by the app carries the words too.
    const effective = await as(admin).query(api.companies.getEffectiveSettings, {})
    expect(effective.company.terminology).toEqual(saved)

    // Emptying the record restores the built-in labels.
    expect(await as(admin).mutation(api.terminology.update, { terms: {} })).toEqual({})
    expect(await as(admin).query(api.terminology.get, {})).toEqual({})
    expect((await t.run((ctx) => ctx.db.get(companyId as any)) as any).terminology).toBeUndefined()
  })

  test('the change is audited and invalid keys are refused', async () => {
    const { t, as, companyId, admin } = await setup()
    await as(admin).mutation(api.terminology.update, { terms: { harvest: 'Catch' } })
    await expect(
      as(admin).mutation(api.terminology.update, { terms: { bogus: 'x' } }),
    ).rejects.toThrow(/Unknown word setting/)
    const audits = await t.run((ctx) =>
      ctx.db.query('auditLogs').withIndex('by_company', (q) => q.eq('companyId', companyId as any)).collect(),
    )
    const entry = audits.find((a: any) => a.actionType === 'update_terminology')
    expect(entry).toMatchObject({ tableName: 'companies', newValues: { harvest: 'Catch' } })
  })
})
