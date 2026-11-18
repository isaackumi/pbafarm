/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { DEFAULT_SETTINGS, densityBasis, densityExcess, densityStatus } from './lib/farmRules'
import { nextStatuses, transitionError } from './lib/unitStatus'

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
    const stocked = await ctx.db.insert('cages', {
      name: 'C1', status: 'active', currentCount: 4000, volumeM3: 100, companyId, locationId: siteA, updatedAt: now,
    })
    const empty = await ctx.db.insert('cages', {
      name: 'C2', status: 'empty', currentCount: 0, companyId, locationId: siteA, updatedAt: now,
    })
    const theirs = await ctx.db.insert('cages', {
      name: 'X1', status: 'empty', companyId: otherCompanyId, updatedAt: now,
    })
    return { companyId, siteA, adminId, staffId, outsiderId, stocked, empty, theirs }
  })
  return {
    t,
    admin: t.withIdentity({ subject: `${ids.adminId}|s` }),
    staff: t.withIdentity({ subject: `${ids.staffId}|s` }),
    outsider: t.withIdentity({ subject: `${ids.outsiderId}|s` }),
    ...ids,
  }
}

describe('unit status state machine (PROD-013)', () => {
  test('pure rules: allowed transitions and fish-count invariants', () => {
    expect(transitionError('empty', 'active', 0)).toMatch(/Stock the unit/)
    expect(transitionError('active', 'harvesting', 100)).toBeNull()
    expect(transitionError('active', 'fallow', 100)).toMatch(/cannot go from Stocked to Fallow/)
    expect(transitionError('harvested', 'fallow', 0)).toBeNull()
    expect(transitionError('harvested', 'fallow', 5)).toMatch(/still holds 5 fish/)
    expect(transitionError('maintenance', 'active', 0)).toMatch(/needs fish/)
    expect(transitionError('maintenance', 'active', 10)).toBeNull()
    const next = nextStatuses('maintenance', 0)
    expect(next.find((s) => s.status === 'active')?.allowed).toBe(false)
    expect(next.find((s) => s.status === 'empty')?.allowed).toBe(true)
  })

  test('setStatus enforces the machine server-side and records the change', async () => {
    const { admin, stocked, empty, t } = await setup()
    await expect(admin.mutation(api.units.setStatus, { id: empty, status: 'active' })).rejects.toThrow(/Stock the unit/)
    await expect(admin.mutation(api.units.setStatus, { id: stocked, status: 'empty' })).rejects.toThrow(/cannot go/)
    await admin.mutation(api.units.setStatus, { id: stocked, status: 'harvesting', reason: 'Buyer booked' })
    await admin.mutation(api.units.setStatus, { id: empty, status: 'maintenance' })
    await admin.mutation(api.units.setStatus, { id: empty, status: 'fallow' })
    const rows = await t.run(async (ctx) => [await ctx.db.get(stocked), await ctx.db.get(empty)])
    expect(rows[0]?.status).toBe('harvesting')
    expect(rows[0]?.statusChangedAt).toBeTypeOf('number')
    expect(rows[1]?.status).toBe('fallow')
    const audits = await t.run((ctx) => ctx.db.query('auditLogs').collect())
    expect(audits.filter((a) => a.actionType === 'status_change')).toHaveLength(3)
  })

  test('cages.update applies the same machine; staff cannot change status', async () => {
    const { admin, staff, stocked } = await setup()
    await expect(admin.mutation(api.cages.update, { id: stocked, patch: { status: 'fallow' } })).rejects.toThrow(/cannot go/)
    await expect(staff.mutation(api.units.setStatus, { id: stocked, status: 'harvesting' })).rejects.toThrow(/Insufficient/)
    await expect(admin.mutation(api.cages.update, { id: stocked, patch: { status: 'maintenance' } })).resolves.toBe(stocked)
  })

  test('another company cannot change a unit status', async () => {
    const { outsider, stocked } = await setup()
    await expect(outsider.mutation(api.units.setStatus, { id: stocked, status: 'harvesting' })).rejects.toThrow(/not found/)
  })

  test('a new unit cannot start stocked without fish', async () => {
    const { admin } = await setup()
    await expect(admin.mutation(api.cages.create, { name: 'N1', status: 'active' })).rejects.toThrow(/initial fish count/)
  })

  test('remove archives instead of deleting, and refuses a stocked unit', async () => {
    const { admin, stocked, empty, t } = await setup()
    await expect(admin.mutation(api.cages.remove, { id: stocked })).rejects.toThrow(/before archiving/)
    await admin.mutation(api.cages.remove, { id: empty })
    const row = await t.run((ctx) => ctx.db.get(empty))
    expect(row?.archivedAt).toBeTypeOf('number')
    const list = await admin.query(api.cages.list, {})
    expect(list.map((c) => c.name)).toEqual(['C1'])
    const withArchived = await admin.query(api.cages.list, { includeArchived: true })
    expect(withArchived).toHaveLength(2)
    await expect(admin.mutation(api.cages.update, { id: empty, patch: { name: 'Z' } })).rejects.toThrow(/archived/)
    await admin.mutation(api.cages.restore, { id: empty })
    expect(await admin.query(api.cages.list, {})).toHaveLength(2)
  })
})

describe('density by unit type (CAGE-001, POND-001, RAS-001)', () => {
  const rules = { ...DEFAULT_SETTINGS.farmRules, maxDensityFishPerM3: 80, maxDensityFishPerM2: 5, maxDensityTankFishPerM3: 150 }

  test('cages use net volume first, ponds area, tanks the tank limit', () => {
    expect(densityBasis({ unitType: 'cage', netVolumeM3: 50, volumeM3: 100 }, rules)).toMatchObject({ size: 50, sizeLabel: 'net volume', max: 80 })
    expect(densityBasis({ volumeM3: 100 }, rules)).toMatchObject({ size: 100, sizeLabel: 'volume' })
    expect(densityBasis({ unitType: 'pond', areaM2: 2000, volumeM3: 3000 }, rules)).toMatchObject({ measure: 'area', size: 2000, max: 5 })
    expect(densityBasis({ unitType: 'tank', volumeM3: 10 }, rules)).toMatchObject({ max: 150 })
    // Unset tank limit falls back to the general m³ limit.
    expect(densityBasis({ unitType: 'tank', volumeM3: 10 }, { ...rules, maxDensityTankFishPerM3: 0 })).toMatchObject({ max: 80 })
    // A unit's own limit wins.
    expect(densityBasis({ unitType: 'tank', volumeM3: 10, maxDensity: 40 }, rules)).toMatchObject({ max: 40 })
  })

  test('status levels: ok, warn at the warning %, over above the limit', () => {
    const cage = { unitType: 'cage', netVolumeM3: 100 }
    expect(densityStatus(cage, 7000, rules).level).toBe('ok')
    expect(densityStatus(cage, 7200, rules)).toMatchObject({ level: 'warn', pctOfMax: 90 })
    expect(densityStatus(cage, 8100, rules).level).toBe('over')
    expect(densityStatus({ unitType: 'pond' }, 10, rules).level).toBe('unknown')
    // Stocking checks use the same basis: net volume, not gross.
    expect(densityExcess({ unitType: 'cage', netVolumeM3: 50, volumeM3: 100 }, 5000, rules)).toMatchObject({ max: 80 })
  })
})

describe('unit groups and water bodies', () => {
  test('admin creates a water body and group, assigns units; board groups them', async () => {
    const { admin, stocked, empty, siteA } = await setup()
    const lake = await admin.mutation(api.units.createWaterBody, { name: 'Volta', kind: 'lake', latitude: 6.3, longitude: 0.05 })
    const group = await admin.mutation(api.units.createGroup, {
      name: 'Line A', kind: 'cage_group', locationId: siteA, waterBodyId: lake,
    })
    await admin.mutation(api.units.assignToGroup, { unitIds: [stocked], groupId: group })
    const groups = await admin.query(api.units.listGroups, {})
    expect(groups[0]).toMatchObject({ name: 'Line A', unitCount: 1, stockedCount: 1, fishCount: 4000, waterBodyName: 'Volta' })
    const board = await admin.query(api.units.board, {})
    expect(board.sections.map((s) => s.name)).toEqual(['Line A', 'Not in a group'])
    expect(board.sections[0].units[0]).toMatchObject({ name: 'C1', densityLevel: 'ok', density: 40 })
    expect(board.sections[1].units[0]._id).toBe(empty)
    const ws = await admin.query(api.units.workspace, { id: stocked })
    expect(ws).toMatchObject({ group: { name: 'Line A' }, waterBody: { name: 'Volta' }, profile: { noun: 'Cage' } })
    expect(ws?.nextStatuses.map((s) => s.status)).toEqual(['harvesting', 'maintenance'])
  })

  test('staff cannot manage groups; another company cannot use them', async () => {
    const { admin, staff, outsider, theirs, stocked } = await setup()
    await expect(staff.mutation(api.units.createGroup, { name: 'G', kind: 'pond_block' })).rejects.toThrow(/Insufficient/)
    const group = await admin.mutation(api.units.createGroup, { name: 'G', kind: 'pond_block' })
    await expect(outsider.mutation(api.units.assignToGroup, { unitIds: [theirs], groupId: group })).rejects.toThrow(/not found/)
    await expect(outsider.mutation(api.cages.update, { id: theirs, patch: { unitGroupId: group } })).rejects.toThrow(/not found/)
    await expect(admin.mutation(api.units.assignToGroup, { unitIds: [theirs], groupId: group })).rejects.toThrow(/not found/)
    expect(await outsider.query(api.units.workspace, { id: stocked })).toBeNull()
    expect(await outsider.query(api.units.listGroups, {})).toEqual([])
  })

  test('coordinates are validated', async () => {
    const { admin } = await setup()
    await expect(admin.mutation(api.units.createWaterBody, { name: 'W', kind: 'lake', latitude: 95, longitude: 0 })).rejects.toThrow(/Latitude/)
    await expect(admin.mutation(api.units.createGroup, { name: 'G', kind: 'cage_group', latitude: 5 })).rejects.toThrow(/both/)
    await expect(admin.mutation(api.cages.create, { name: 'Q', longitude: 200 })).rejects.toThrow(/Longitude/)
  })
})

describe('harvesting units stay in daily pickers', () => {
  test('getActive includes a unit marked harvesting', async () => {
    const { admin, stocked } = await setup()
    await admin.mutation(api.units.setStatus, { id: stocked, status: 'harvesting' })
    const active = await admin.query(api.cages.getActive, {})
    expect(active.map((c) => c.id)).toEqual([stocked])
  })
})

describe('site map points', () => {
  test('placed units, groups and water bodies; unplaced members counted on the group', async () => {
    const { admin, outsider, stocked, empty } = await setup()
    const lake = await admin.mutation(api.units.createWaterBody, { name: 'Volta', kind: 'lake', latitude: 6.3, longitude: 0.05 })
    const group = await admin.mutation(api.units.createGroup, { name: 'Line A', kind: 'cage_group', waterBodyId: lake, latitude: 6.301, longitude: 0.051 })
    await admin.mutation(api.units.assignToGroup, { unitIds: [stocked, empty], groupId: group })
    await admin.mutation(api.cages.update, { id: stocked, patch: { latitude: 6.3012, longitude: 0.0511 } })
    const pts = await admin.query(api.units.mapPoints, {})
    expect(pts.units).toMatchObject([{ name: 'C1', statusLabel: 'Stocked', fish: 4000 }])
    expect(pts.groups).toMatchObject([{ name: 'Line A', unitCount: 2, stocked: 1, unplaced: 1 }])
    expect(pts.waterBodies).toHaveLength(1)
    expect(await outsider.query(api.units.mapPoints, {})).toMatchObject({ units: [], groups: [] })
  })
})
