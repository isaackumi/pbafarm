/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

/** Parent (GRP), subsidiary (SUB) and an unrelated organization (OTH). */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const company = (name: string, code: string) =>
      ctx.db.insert('companies', { name, code, status: 'approved', createdAt: now } as any)
    const parentCo = await company('Group Holdings', 'GRP')
    const childCo = await company('Lake Sub', 'SUB')
    const otherCo = await company('Other', 'OTH')
    const site = (companyId: any, name: string) => ctx.db.insert('farmLocations', { companyId, name, active: true, updatedAt: now })
    const siteA = await site(parentCo, 'North A')
    const siteB = await site(parentCo, 'South B')
    const childSite = await site(childCo, 'Sub site')
    const otherSite = await site(otherCo, 'Other site')
    const cage = (companyId: any, locationId: any, currentCount: number) =>
      ctx.db.insert('cages', { name: 'C', status: 'active', currentCount, companyId, locationId, updatedAt: now })
    await cage(parentCo, siteA, 100)
    await cage(parentCo, siteB, 50)
    await cage(childCo, childSite, 700)
    await cage(otherCo, otherSite, 9000)
    const user = (email: string, role: string, companyId: any, extra: object = {}) =>
      ctx.db.insert('users', { email, role, companyId, ...extra } as any)
    const adminId = await user('admin@grp.com', 'admin', parentCo)
    const managerId = await user('mgr@grp.com', 'user', parentCo)
    const staffId = await user('staff@grp.com', 'user', parentCo, { locationIds: [siteA] })
    const childAdminId = await user('admin@sub.com', 'admin', childCo)
    const otherAdminId = await user('admin@oth.com', 'admin', otherCo)
    return { parentCo, childCo, otherCo, siteA, siteB, childSite, otherSite, adminId, managerId, staffId, childAdminId, otherAdminId }
  })
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` })
  return {
    t,
    ...ids,
    admin: as(ids.adminId),
    manager: as(ids.managerId),
    staff: as(ids.staffId),
    childAdmin: as(ids.childAdminId),
    otherAdmin: as(ids.otherAdminId),
  }
}

const range = { from: '2026-01-01', to: '2026-12-31' }

describe('business units and regions (FARM-004 / ENT-001)', () => {
  test('nesting, cycles, site assignment and unit-filtered report', async () => {
    const { admin, manager, otherAdmin, siteA, siteB, otherSite } = await setup()
    await expect(manager.mutation(api.businessUnits.create, { name: 'X', kind: 'region' })).rejects.toThrow(/Insufficient/)
    const north = await admin.mutation(api.businessUnits.create, { name: 'North', kind: 'region' })
    const unit = await admin.mutation(api.businessUnits.create, { name: 'Grow-out', kind: 'business_unit', parentId: north })
    await expect(admin.mutation(api.businessUnits.update, { id: north, patch: { parentId: unit } })).rejects.toThrow(/inside itself|cycle|own/i)
    await expect(otherAdmin.mutation(api.businessUnits.assignSites, { businessUnitId: unit, siteIds: [otherSite] })).rejects.toThrow(/not found/i)
    await expect(admin.mutation(api.businessUnits.assignSites, { businessUnitId: unit, siteIds: [otherSite] })).rejects.toThrow(/not found/i)
    await admin.mutation(api.businessUnits.assignSites, { businessUnitId: unit, siteIds: [siteA] })
    await expect(admin.mutation(api.businessUnits.remove, { id: unit })).rejects.toThrow()

    const all = await admin.query(api.businessUnits.list, {})
    expect(all.find((u: any) => u._id === unit)).toMatchObject({ siteCount: 1 })
    expect(await otherAdmin.query(api.businessUnits.list, {})).toEqual([])

    // Filtering by the region includes its descendant unit's site only.
    const report = await manager.query(api.businessUnits.siteReport, { ...range, businessUnitId: north })
    expect(report!.sites.map((s: any) => s.siteId)).toEqual([siteA])
    expect(report!.totals.fish).toBe(100)
    const full = await manager.query(api.businessUnits.siteReport, range)
    expect(full!.sites.map((s: any) => s.siteId).sort()).toEqual([siteA, siteB].sort())
    await expect(otherAdmin.query(api.businessUnits.siteReport, { ...range, businessUnitId: north })).rejects.toThrow(/not found/i)
  })
})

describe('subsidiaries and consolidated reporting (ENT-001 / ENT-002)', () => {
  test('handshake: only active, sharing, linked subsidiaries appear, and only for group.reports.view', async () => {
    const { admin, manager, childAdmin, otherAdmin, childCo, otherCo } = await setup()

    // Before any link: only the caller's own organization.
    let rows = (await admin.query(api.groupReports.overview, range)).rows
    expect(rows.map((r: any) => r.code)).toEqual(['GRP'])
    expect(rows[0]).toMatchObject({ isSelf: true, fish: 150 })
    await expect(admin.query(api.groupReports.subsidiarySites, { ...range, childCompanyId: otherCo })).rejects.toThrow(/not found/i)

    const linkId = await admin.mutation(api.companyLinks.request, { childCode: 'sub' })
    await expect(admin.mutation(api.companyLinks.request, { childCode: 'GRP' })).rejects.toThrow()
    // Pending: nothing yet; the parent cannot accept on the child's behalf.
    expect((await admin.query(api.groupReports.overview, range)).rows).toHaveLength(1)
    await expect(admin.mutation(api.companyLinks.respond, { linkId, accept: true })).rejects.toThrow()
    await expect(otherAdmin.mutation(api.companyLinks.respond, { linkId, accept: true })).rejects.toThrow()
    expect((await childAdmin.query(api.companyLinks.overview, {})).parents).toMatchObject([{ status: 'pending', code: 'GRP' }])

    // Accepted without sharing: still nothing.
    await childAdmin.mutation(api.companyLinks.respond, { linkId, accept: true, shareReports: false })
    expect((await admin.query(api.groupReports.overview, range)).rows).toHaveLength(1)
    await expect(admin.query(api.groupReports.subsidiarySites, { ...range, childCompanyId: childCo })).rejects.toThrow(/not found/i)

    // Sharing on: the subsidiary rolls up.
    await childAdmin.mutation(api.companyLinks.setShareReports, { linkId, shareReports: true })
    rows = (await admin.query(api.groupReports.overview, range)).rows
    expect(rows.map((r: any) => [r.code, r.fish])).toEqual([['GRP', 150], ['SUB', 700]])
    const detail = await admin.query(api.groupReports.subsidiarySites, { ...range, childCompanyId: childCo })
    expect(detail.sites).toMatchObject([{ name: 'Sub site', fish: 700 }])
    // Never the unrelated organization.
    await expect(admin.query(api.groupReports.subsidiarySites, { ...range, childCompanyId: otherCo })).rejects.toThrow(/not found/i)

    // No group role → nothing.
    await expect(manager.query(api.groupReports.overview, range)).rejects.toThrow(/Insufficient/)
    await expect(manager.query(api.groupReports.subsidiarySites, { ...range, childCompanyId: childCo })).rejects.toThrow(/Insufficient/)
    // The subsidiary does not see its parent's figures.
    expect((await childAdmin.query(api.groupReports.overview, range)).rows.map((r: any) => r.code)).toEqual(['SUB'])
    // Another organization sees only itself.
    expect((await otherAdmin.query(api.groupReports.overview, range)).rows.map((r: any) => r.code)).toEqual(['OTH'])

    // Ending the link stops the rollup.
    await childAdmin.mutation(api.companyLinks.end, { linkId })
    expect((await admin.query(api.groupReports.overview, range)).rows).toHaveLength(1)
  })

  test('a subsidiary has at most one active parent; no reverse links', async () => {
    const { admin, childAdmin, otherAdmin } = await setup()
    const linkId = await admin.mutation(api.companyLinks.request, { childCode: 'SUB' })
    await childAdmin.mutation(api.companyLinks.respond, { linkId, accept: true, shareReports: true })
    await expect(otherAdmin.mutation(api.companyLinks.request, { childCode: 'SUB' })).rejects.toThrow()
    await expect(childAdmin.mutation(api.companyLinks.request, { childCode: 'GRP' })).rejects.toThrow()
  })
})

describe('teams, departments and workforce (ENT-004)', () => {
  test('teams: wrong company refused; lead can message the team; team tasks', async () => {
    const { t, admin, manager, staff, otherAdmin, managerId, staffId, otherAdminId, siteA } = await setup()
    await expect(manager.mutation(api.teams.create, { name: 'X', kind: 'team' })).rejects.toThrow(/Insufficient/)
    const ops = await admin.mutation(api.teams.create, { name: 'Operations', kind: 'department' })
    const crew = await admin.mutation(api.teams.create, { name: 'Feed crew', kind: 'team', parentId: ops, locationId: siteA })
    await expect(admin.mutation(api.teams.setMember, { teamId: crew, userId: otherAdminId, role: 'member' })).rejects.toThrow(/not found/i)
    await expect(otherAdmin.mutation(api.teams.setMember, { teamId: crew, userId: otherAdminId, role: 'member' })).rejects.toThrow(/not found/i)
    await admin.mutation(api.teams.setMember, { teamId: crew, userId: managerId, role: 'lead' })
    await admin.mutation(api.teams.setMember, { teamId: crew, userId: staffId, role: 'member' })
    expect(await otherAdmin.query(api.teams.list, {})).toEqual([])

    // A plain member cannot message the team; the lead can.
    await expect(staff.mutation(api.teams.notify, { teamId: crew, title: 'Hi', message: 'm' })).rejects.toThrow()
    const res = await manager.mutation(api.teams.notify, { teamId: crew, title: 'Feeding', message: 'Start at 7' })
    expect(res.notified).toBe(1)
    const notes = await t.run((ctx) => ctx.db.query('notifications').collect())
    expect(notes.filter((n) => n.userId === staffId && n.title === 'Feed crew: Feeding')).toHaveLength(1)

    // Task assigned to the team: every member sees and can close it.
    await expect(otherAdmin.mutation(api.tasks.create, { title: 'X', teamId: crew })).rejects.toThrow(/not found/i)
    await expect(admin.mutation(api.tasks.create, { title: 'X' })).rejects.toThrow(/person or a team/)
    await admin.mutation(api.tasks.create, { title: 'Clean nets', teamId: crew })
    const mine = await staff.query(api.tasks.mine, {})
    expect(mine.open).toMatchObject([{ title: 'Clean nets', teamName: 'Feed crew' }])
    expect(await staff.query(api.tasks.openCount, {})).toBe(1)
    expect((await otherAdmin.query(api.tasks.mine, {})).open).toEqual([])
    await staff.mutation(api.tasks.setStatus, { taskId: mine.open[0]._id, status: 'done' })
    expect(await manager.query(api.tasks.openCount, {})).toBe(0)

    // A team with tasks or children cannot be removed.
    await expect(admin.mutation(api.teams.remove, { id: ops })).rejects.toThrow()
  })

  test('roster: contact details only for workforce.manage; site scope; wrong company', async () => {
    const { admin, manager, staff, otherAdmin, siteA, siteB, otherSite } = await setup()
    await expect(manager.mutation(api.workforce.create, { fullName: 'X' })).rejects.toThrow(/Insufficient/)
    await expect(admin.mutation(api.workforce.create, { fullName: 'X', locationId: otherSite })).rejects.toThrow(/not found/i)
    await expect(admin.mutation(api.workforce.create, { fullName: 'X', email: 'nope' })).rejects.toThrow(/email/)
    const a = await admin.mutation(api.workforce.create, {
      fullName: 'Ama Mensah', jobTitle: 'Feeder', locationId: siteA, phone: '+233 20 000 0000', email: 'ama@x.com',
    })
    await admin.mutation(api.workforce.create, { fullName: 'Kofi B', locationId: siteB })

    const full = await admin.query(api.workforce.list, {})
    expect(full.staff.find((s: any) => s._id === a)).toMatchObject({ phone: '+233 20 000 0000', email: 'ama@x.com' })
    const limited = await manager.query(api.workforce.list, {})
    expect(limited.staff).toHaveLength(2)
    for (const s of limited.staff) expect(s).not.toHaveProperty('phone')
    // Site-limited member sees only staff at their sites.
    expect((await staff.query(api.workforce.list, {})).staff.map((s: any) => s.fullName)).toEqual(['Ama Mensah'])
    expect((await otherAdmin.query(api.workforce.list, {})).staff).toEqual([])
    await expect(otherAdmin.mutation(api.workforce.update, { id: a, patch: { jobTitle: 'X' } })).rejects.toThrow(/not found/i)
    await admin.mutation(api.workforce.update, { id: a, patch: { status: 'inactive' } })
    expect((await admin.query(api.workforce.list, {})).staff).toHaveLength(1)
  })
})

describe('asset maintenance reminders (INV-012)', () => {
  test('asset fields; due items notify site managers once a day; retired and other companies skipped', async () => {
    const { t, admin, otherAdmin, parentCo, adminId, otherAdminId } = await setup()
    await expect(admin.mutation(api.equipment.create, { name: 'Boat', kind: 'boat', purchaseCost: -1 })).rejects.toThrow(/cost/)
    await expect(admin.mutation(api.equipment.create, { name: 'Boat', kind: 'boat', purchasedOn: '2026-13-01' })).rejects.toThrow()
    const boat = await admin.mutation(api.equipment.create, {
      name: 'Boat 1', kind: 'boat', assetTag: ' B-01 ', purchasedOn: '2025-05-01', purchaseCost: 12000, nextMaintenanceDue: '2026-03-02',
    })
    expect(await t.run((ctx) => ctx.db.get(boat))).toMatchObject({ assetTag: 'B-01', purchaseCost: 12000 })
    const van = await admin.mutation(api.equipment.create, { name: 'Old van', kind: 'vehicle', nextMaintenanceDue: '2026-02-01' })
    await admin.mutation(api.equipment.update, { id: van, patch: { status: 'retired' } })
    await admin.mutation(api.equipment.create, { name: 'Far off', kind: 'generator', nextMaintenanceDue: '2026-06-01' })
    await otherAdmin.mutation(api.equipment.create, { name: 'Their pump', kind: 'pump', nextMaintenanceDue: '2026-03-01' })

    const r1 = await t.mutation(internal.equipment.companyMaintenanceReminders, { companyId: parentCo, date: '2026-03-01' })
    expect(r1).toMatchObject({ items: 1 })
    expect(r1.notified).toBeGreaterThan(0)
    const r2 = await t.mutation(internal.equipment.companyMaintenanceReminders, { companyId: parentCo, date: '2026-03-01' })
    expect(r2.notified).toBe(0)
    const notes = await t.run((ctx) => ctx.db.query('notifications').collect())
    const mine = notes.filter((n) => n.userId === adminId)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ title: 'Maintenance due soon', link: '/maintenance' })
    expect(mine[0].message).toContain('Boat 1')
    expect(notes.some((n) => n.userId === otherAdminId)).toBe(false)

    // The paging cron schedules one job per approved company.
    const page = await t.mutation(internal.equipment.maintenanceReminders, {})
    expect(page).toMatchObject({ done: true })
    expect(page.scheduled).toBeGreaterThanOrEqual(3)
  })
})
