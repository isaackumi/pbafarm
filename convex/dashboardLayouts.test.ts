/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { DEFAULT_DASHBOARD, cleanDashboard, dashboardProblems } from './lib/dashboardLayout'

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

describe('dashboard layout rules (CUSTOM-005)', () => {
  test('validation and cleaning', () => {
    expect(dashboardProblems(DEFAULT_DASHBOARD)).toEqual([])
    expect(dashboardProblems([{ widget: 'nope', size: 'sm' }]).join()).toMatch(/Unknown widget/)
    expect(dashboardProblems([{ widget: 'insights', size: 'sm' }, { widget: 'insights', size: 'lg' }]).join()).toMatch(/twice/)
    expect(cleanDashboard([{ widget: 'nope', size: 'sm' }, { widget: 'insights', size: 'lg' }, { widget: 'insights', size: 'sm' }])).toEqual([
      { widget: 'insights', size: 'lg' },
    ])
    expect(cleanDashboard(null)).toEqual([])
  })
})

describe('dashboard layout functions', () => {
  test('user override beats the org default, which beats the built-in one; companies are isolated', async () => {
    const { as, admin, viewer, outsider } = await setup()
    expect((await as(viewer).query(api.dashboardLayouts.get, { key: 'home' })).source).toBe('default')

    const org = [{ widget: 'insights', size: 'full' as const }, { widget: 'stat.biomass', size: 'sm' as const }]
    await as(admin).mutation(api.dashboardLayouts.save, { key: 'home', scope: 'org', widgets: org })
    const seen = await as(viewer).query(api.dashboardLayouts.get, { key: 'home' })
    expect(seen.source).toBe('org')
    expect(seen.widgets).toEqual(org)

    // Viewers can arrange their own dashboard but not the organization's.
    await expect(as(viewer).mutation(api.dashboardLayouts.save, { key: 'home', scope: 'org', widgets: org })).rejects.toThrow(/FORBIDDEN|Insufficient/)
    const mine = [{ widget: 'chart.feedTrend', size: 'full' as const }]
    await as(viewer).mutation(api.dashboardLayouts.save, { key: 'home', scope: 'me', widgets: mine })
    expect(await as(viewer).query(api.dashboardLayouts.get, { key: 'home' })).toMatchObject({ source: 'me', widgets: mine, hasOrgDefault: true })
    expect((await as(admin).query(api.dashboardLayouts.get, { key: 'home' })).source).toBe('org')

    // Wrong company: another organization never sees these layouts.
    const theirs = await as(outsider).query(api.dashboardLayouts.get, { key: 'home' })
    expect(theirs.source).toBe('default')
    expect(theirs.hasOrgDefault).toBe(false)
    await as(outsider).mutation(api.dashboardLayouts.reset, { key: 'home', scope: 'org' })
    expect((await as(admin).query(api.dashboardLayouts.get, { key: 'home' })).source).toBe('org')

    await expect(
      as(admin).mutation(api.dashboardLayouts.save, { key: 'home', scope: 'me', widgets: [{ widget: 'bogus', size: 'sm' }] }),
    ).rejects.toThrow(/Unknown widget/)
    await expect(as(admin).mutation(api.dashboardLayouts.save, { key: 'other', scope: 'me', widgets: mine })).rejects.toThrow()

    await as(viewer).mutation(api.dashboardLayouts.reset, { key: 'home', scope: 'me' })
    expect((await as(viewer).query(api.dashboardLayouts.get, { key: 'home' })).source).toBe('org')
    await as(admin).mutation(api.dashboardLayouts.reset, { key: 'home', scope: 'org' })
    expect((await as(viewer).query(api.dashboardLayouts.get, { key: 'home' })).source).toBe('default')
  })
})
