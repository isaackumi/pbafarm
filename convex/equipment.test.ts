/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { CHECKS } from './automation/checks'
import { mergeSettings } from './lib/farmRules'

const modules = import.meta.glob('./**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now,
    } as any)
    const otherCompanyId = await ctx.db.insert('companies', {
      name: 'Other', code: 'OTH', status: 'approved', createdAt: now,
    } as any)
    const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'Site A', active: true, updatedAt: now })
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId, activeLocationId: siteA })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId, activeLocationId: siteA })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCompanyId })
    const cage = await ctx.db.insert('cages', {
      name: 'C1', status: 'active', currentCount: 1000, companyId, locationId: siteA, updatedAt: now,
    })
    const tank = await ctx.db.insert('cages', {
      name: 'T1', unitType: 'tank', status: 'active', currentCount: 100, volumeM3: 10, companyId, locationId: siteA, updatedAt: now,
    })
    const impeller = await ctx.db.insert('inventoryItems', {
      companyId, name: 'Pump impeller', category: 'spare', unit: 'pcs', minimumStock: 1, active: true, updatedAt: now,
    })
    await ctx.db.insert('inventoryItemStock', { companyId, itemId: impeller, locationId: siteA, quantity: 3, updatedAt: now })
    return { companyId, siteA, adminId, staffId, outsiderId, cage, tank, impeller }
  })
  return {
    t,
    admin: t.withIdentity({ subject: `${ids.adminId}|s` }),
    staff: t.withIdentity({ subject: `${ids.staffId}|s` }),
    outsider: t.withIdentity({ subject: `${ids.outsiderId}|s` }),
    ...ids,
  }
}

describe('equipment registry (RAS-002)', () => {
  test('admin registers equipment linked to a unit with spares; next due from interval', async () => {
    const { admin, staff, tank, impeller, siteA } = await setup()
    await expect(staff.mutation(api.equipment.create, { name: 'P', kind: 'pump' })).rejects.toThrow(/Insufficient/)
    const id = await admin.mutation(api.equipment.create, {
      name: 'Pump 1', kind: 'pump', unitId: tank, maintenanceIntervalDays: 30, lastMaintainedOn: '2026-01-01', sparePartItemIds: [impeller],
    })
    const list = await admin.query(api.equipment.list, { unitId: tank })
    expect(list).toMatchObject([{ _id: id, unitName: 'T1', status: 'in_service', nextMaintenanceDue: '2026-01-31', locationId: siteA }])
  })

  test('another company cannot attach to or see equipment', async () => {
    const { admin, outsider, tank } = await setup()
    await admin.mutation(api.equipment.create, { name: 'Blower', kind: 'blower', unitId: tank })
    await expect(outsider.mutation(api.equipment.create, { name: 'X', kind: 'pump', unitId: tank })).rejects.toThrow(/not found/)
    expect(await outsider.query(api.equipment.list, {})).toEqual([])
  })
})

describe('maintenance and net inspections (CAGE-002)', () => {
  test('maintenance log issues spare parts, moves next due, failure marks faulty', async () => {
    const { admin, staff, t, tank, impeller } = await setup()
    const pump = await admin.mutation(api.equipment.create, {
      name: 'Pump 1', kind: 'pump', unitId: tank, maintenanceIntervalDays: 30, nextMaintenanceDue: '2026-01-01',
    })
    const res = await staff.mutation(api.equipment.logInspection, {
      kind: 'maintenance', equipmentId: pump, date: '2026-01-02', result: 'ok', partsUsed: [{ itemId: impeller, quantity: 1 }],
    })
    expect(res.nextDueOn).toBe('2026-02-01')
    let gear = await t.run((ctx) => ctx.db.get(pump))
    expect(gear).toMatchObject({ lastMaintainedOn: '2026-01-02', nextMaintenanceDue: '2026-02-01', status: 'in_service' })
    const stock = await t.run((ctx) => ctx.db.query('inventoryItemStock').collect())
    expect(stock[0].quantity).toBe(2)
    await staff.mutation(api.equipment.logInspection, { kind: 'inspection', equipmentId: pump, date: '2026-01-03', result: 'failed' })
    gear = await t.run((ctx) => ctx.db.get(pump))
    expect(gear?.status).toBe('faulty')
    const history = await staff.query(api.equipment.listInspections, { equipmentId: pump })
    expect(history.map((h) => h.kind)).toEqual(['inspection', 'maintenance'])
    expect(history[1]).toMatchObject({ unitName: 'T1', equipmentName: 'Pump 1' })
  })

  test('net inspection with a checklist updates the cage; overdue shows in due list', async () => {
    const { staff, t, cage } = await setup()
    await expect(
      staff.mutation(api.equipment.logInspection, {
        kind: 'net_inspection', unitId: cage, date: '2026-01-02', result: 'ok',
        checklist: [{ item: 'Net free of holes and tears', ok: false }],
      }),
    ).rejects.toThrow(/checklist items failed/)
    await staff.mutation(api.equipment.logInspection, {
      kind: 'net_inspection', unitId: cage, date: '2026-01-02', result: 'needs_attention',
      checklist: [{ item: 'Net free of holes and tears', ok: false, note: 'Small tear at seam' }],
      nextDueOn: '2026-01-09',
    })
    const row = await t.run((ctx) => ctx.db.get(cage))
    expect(row).toMatchObject({ lastMaintenanceDate: '2026-01-02', nextMaintenanceDate: '2026-01-09' })
    const due = await staff.query(api.equipment.due, { asOf: '2026-01-10' })
    expect(due.overdue).toMatchObject([{ kind: 'unit', name: 'C1', detail: 'net inspection', due: '2026-01-09' }])
    const soon = await staff.query(api.equipment.due, { asOf: '2026-01-05', days: 7 })
    expect(soon.dueSoon).toHaveLength(1)
  })

  test('refusals: no target, future date, net inspection without a unit, other company', async () => {
    const { staff, outsider, cage } = await setup()
    await expect(staff.mutation(api.equipment.logInspection, { kind: 'maintenance', date: '2026-01-01', result: 'ok' })).rejects.toThrow(/Choose a unit/)
    await expect(staff.mutation(api.equipment.logInspection, { kind: 'net_inspection', unitId: cage, date: '2999-01-01', result: 'ok' })).rejects.toThrow(/future/)
    await expect(outsider.mutation(api.equipment.logInspection, { kind: 'net_inspection', unitId: cage, date: '2026-01-01', result: 'ok' })).rejects.toThrow(/not found/)
  })

  test('maintenance_due automation check lists overdue and due-soon items', async () => {
    const { admin, t, cage, companyId } = await setup()
    await admin.mutation(api.equipment.create, { name: 'Blower 2', kind: 'blower', nextMaintenanceDue: '2026-01-04' })
    await t.run((ctx) => ctx.db.patch(cage, { nextMaintenanceDate: '2026-01-01' }))
    const res = await t.run((ctx) =>
      CHECKS.maintenance_due.run(ctx, companyId, '2026-01-02', { days: 3 }, mergeSettings({})),
    )
    expect(res).toMatchObject({ count: 2, overdue: 1, link: '/maintenance' })
    expect(res.message).toContain('C1 net (overdue 2026-01-01)')
  })

  test('replay with the same client id logs once', async () => {
    const { staff, t, cage } = await setup()
    const args = { kind: 'net_inspection' as const, unitId: cage, date: '2026-01-02', result: 'ok' as const, clientMutationId: 'insp-1' }
    await staff.mutation(api.equipment.logInspection, args)
    await staff.mutation(api.equipment.logInspection, args)
    expect(await t.run((ctx) => ctx.db.query('unitInspections').collect())).toHaveLength(1)
  })
})
