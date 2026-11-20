/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'
import { UNSCOPED_TABLES } from './migrations'

const modules = import.meta.glob('./**/*.ts')

/** The live shape: no companies, company-less users and farm rows. */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const owner = await ctx.db.insert('users', { email: 'owner@x.com', role: 'super_admin' })
    const staff = await ctx.db.insert('users', { email: 'staff@x.com', role: 'user' })
    const gone = await ctx.db.insert('users', { email: 'gone@x.com', role: 'user', active: false })
    const loc = await ctx.db.insert('farmLocations', { name: 'Main farm', active: true, updatedAt: now })
    await ctx.db.patch(staff, { activeLocationId: loc })
    const cage = await ctx.db.insert('cages', { name: 'C1', status: 'active', locationId: loc, updatedAt: now })
    const feedTypeId = await ctx.db.insert('feedTypes', {
      name: 'Grower', currentStock: 100, minimumStock: 0, pricePerKg: 10, active: true, updatedAt: now,
    })
    await ctx.db.insert('dailyRecords', {
      cageId: cage, date: '2026-11-18', feedAmount: 5, feedPrice: 10, feedCost: 50, mortality: 0,
    })
    const harvestId = await ctx.db.insert('harvestRecords', {
      cageId: cage, harvestDate: '2026-11-18', averageBodyWeight: 400, totalWeight: 40, estimatedCount: 100, fcr: 1.4,
    })
    await ctx.db.insert('harvestSampling', { harvestId, samples: [] })
    await ctx.db.insert('notifications', { userId: staff, title: 't', message: 'm', read: false })

    // Another tenant that must not be touched.
    const otherCo = await ctx.db.insert('companies', {
      name: 'Other', code: 'OTHER', status: 'approved', createdAt: now,
    })
    const otherUser = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCo })
    const otherCage = await ctx.db.insert('cages', { name: 'O1', status: 'active', companyId: otherCo, updatedAt: now })
    return { owner, staff, gone, loc, cage, feedTypeId, otherCo, otherUser, otherCage }
  })
  return { t, ...ids }
}

const args = (dryRun?: boolean) => ({ name: 'PBA Farm', code: 'pba', ...(dryRun === undefined ? {} : { dryRun }) })

async function snapshot(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const out: Record<string, unknown[]> = {}
    for (const table of [...UNSCOPED_TABLES, 'users', 'companies'] as const) {
      out[table] = await (ctx.db as any).query(table).collect()
    }
    return out
  })
}

describe('M1 assignUnscopedToCompany', () => {
  test('the table list covers every table with an optional companyId', () => {
    const fromSchema = Object.entries((schema as any).tables)
      .filter(([name, def]: [string, any]) => {
        const field = def.validator?.fields?.companyId
        // dataRequests: an account deletion of a company-less user has no company by design.
        // mfaSessions: a company-less account (super_admin) verifies in platform scope.
        // platformEvents: platform-wide console events have no company by design.
        // aiAlerts / aiBreakers / aiSpend (D-023): platform and server-key rows have no company by design.
        const platformScope = ['users', 'dataRequests', 'mfaSessions', 'platformEvents', 'aiAlerts', 'aiBreakers', 'aiSpend']
        return !platformScope.includes(name) && field && field.isOptional === 'optional'
      })
      .map(([name]) => name)
      .sort()
    expect([...UNSCOPED_TABLES].sort()).toEqual(fromSchema)
  })

  test('preflight counts unscoped rows and company-less users', async () => {
    const { t } = await setup()
    const r = await t.query(internal.migrations.preflightUnscoped, {})
    expect(r.tables.cages).toBe(1)
    expect(r.tables.farmLocations).toBe(1)
    expect(r.tables.harvestSampling).toBe(1)
    expect(r.tables.notifications).toBe(1)
    expect(r.totalRows).toBe(7)
    expect(r.users).toMatchObject({ companyless: 3, companylessSuperAdmins: 1, companylessInactive: 1 })
    expect(r.complete).toBe(true)
  })

  test('a dry run (the default) reports and changes nothing', async () => {
    const { t } = await setup()
    const before = await snapshot(t)
    const r = await t.mutation(internal.migrations.assignUnscopedToCompany, args())
    expect(r.dryRun).toBe(true)
    expect(r.company).toMatchObject({ action: 'create', code: 'PBA' })
    expect((r as any).wouldAssign.totalRows).toBe(7)
    expect((r as any).wouldAssign.users.companyless).toBe(3)
    expect(await snapshot(t)).toEqual(before)
  })

  test('a real run assigns every row and user to one approved company', async () => {
    const { t, owner, staff, gone, loc } = await setup()
    const r = await t.mutation(internal.migrations.assignUnscopedToCompany, args(false))
    expect(r.complete).toBe(true)
    const companyId = r.company.companyId!
    const after = await t.query(internal.migrations.preflightUnscoped, {})
    expect(after.totalRows).toBe(0)
    expect(after.users.companyless).toBe(0)

    await t.run(async (ctx) => {
      const company = await ctx.db.get(companyId)
      expect(company).toMatchObject({ name: 'PBA Farm', code: 'PBA', status: 'approved' })
      const o = await ctx.db.get(owner)
      expect(o).toMatchObject({ companyId, role: 'super_admin', activeLocationId: loc })
      expect(await ctx.db.get(staff)).toMatchObject({ companyId, role: 'user', activeLocationId: loc })
      expect(await ctx.db.get(gone)).toMatchObject({ companyId, active: false })
      const audit = await ctx.db
        .query('auditLogs')
        .withIndex('by_table', (q) => q.eq('tableName', 'companies'))
        .collect()
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({ actionType: 'migration_m1_assign_company', companyId })
      expect(audit[0].newValues.assigned).toMatchObject({ totalRows: 7, users: 3 })
    })
  })

  test('running it again changes nothing', async () => {
    const { t } = await setup()
    const first = await t.mutation(internal.migrations.assignUnscopedToCompany, args(false))
    const before = await snapshot(t)
    const second = await t.mutation(internal.migrations.assignUnscopedToCompany, args(false))
    expect(second.company).toMatchObject({ action: 'reuse', companyId: first.company.companyId })
    expect((second as any).assigned.totalRows).toBe(0)
    expect((second as any).assigned.users).toBe(0)
    expect(await snapshot(t)).toEqual(before)
  })

  test("another company's users and rows are untouched", async () => {
    const { t, otherCo, otherUser, otherCage } = await setup()
    await t.mutation(internal.migrations.assignUnscopedToCompany, args(false))
    await t.run(async (ctx) => {
      expect((await ctx.db.get(otherUser))?.companyId).toBe(otherCo)
      expect((await ctx.db.get(otherCage))?.companyId).toBe(otherCo)
      const companies = await ctx.db.query('companies').collect()
      expect(companies).toHaveLength(2)
    })
  })

  test('refuses to reuse a company that is not approved', async () => {
    const { t } = await setup()
    await t.run((ctx) =>
      ctx.db.insert('companies', { name: 'P', code: 'PBA', status: 'pending', createdAt: Date.now() }),
    )
    await expect(
      t.mutation(internal.migrations.assignUnscopedToCompany, args(false)),
    ).rejects.toThrow(/status "pending"/)
  })
})
