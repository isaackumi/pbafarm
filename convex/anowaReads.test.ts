/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import type { FarmReadArgs, FarmReadTool } from './anowa/reads'

const modules = import.meta.glob('./**/*.ts')

/**
 * Ask Anowa farm read tools (convex/anowa/reads.ts): permission, site scope
 * and tenant isolation per tool, and bounded reads on a 1,000-unit farm.
 */
const OPENED = '2026-05-04'
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const TODAY = addDays(OPENED, 14 * 8)
const NOW = Date.parse(`${TODAY}T10:00:00Z`)
const abwAt = (d: number) => (Math.cbrt(10) + (1.2 * 28 * 0.9 * d) / 1000) ** 3

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const company = (name: string, code: string) =>
      ctx.db.insert('companies', { name, code, status: 'approved', createdAt: now, settings: { aiAssistantEnabled: true } })
    const companyA = await company('Lake', 'LAKE')
    const companyB = await company('River', 'RIVER')
    const north = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'North', active: true, updatedAt: now })
    const south = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'South', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: companyB, name: 'B site', active: true, updatedAt: now })
    const member = async (email: string, companyId: Id<'companies'>, roleKey: string, perms?: string[], sites?: Id<'farmLocations'>[]) => {
      const userId = await ctx.db.insert('users', { email, name: email.split('@')[0], role: 'user', companyId })
      const roleId = perms
        ? await ctx.db.insert('roles', { companyId, key: roleKey, name: roleKey, archived: false, updatedAt: now, permissions: perms as never })
        : undefined
      await ctx.db.insert('memberships', {
        userId, companyId, roleKey, roleId, allLocations: !sites, locationIds: sites, status: 'active', updatedAt: now,
      })
      return userId
    }
    const owner = await member('kofi@a.com', companyA, 'owner')
    // Sees North only; may ask Anowa and view production, nothing else.
    const clerk = await member('ama@a.com', companyA, 'clerk', ['org.view', 'ai.use', 'production.view'], [north])
    // Approves at North only.
    const approver = await member('yaw@a.com', companyA, 'approver', ['org.view', 'ai.use', 'production.view', 'production.stocking.approve', 'finance.view', 'hatchery.view', 'reports.view', 'production.plan.manage'], [north])
    const ownerB = await member('esi@b.com', companyB, 'owner')
    const cage = (name: string, companyId: Id<'companies'>, locationId: Id<'farmLocations'>) =>
      ctx.db.insert('cages', { name, status: 'empty', currentCount: 0, capacity: 100000, species: 'nile_tilapia', companyId, locationId, updatedAt: now })
    const N1 = await cage('N1', companyA, north)
    const S1 = await cage('S1', companyA, south)
    const B1 = await cage('B1', companyB, siteB)
    const feedTypeId = await ctx.db.insert('feedTypes', {
      name: 'Grower', currentStock: 100000, minimumStock: 0, pricePerKg: 2, active: true, companyId: companyA, updatedAt: now,
    })
    return { companyA, companyB, north, south, siteB, owner, clerk, approver, ownerB, N1, S1, B1, feedTypeId }
  })
  const as = (userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|s` })
  const read = async (userId: Id<'users'>, tool: FarmReadTool, args: FarmReadArgs = {}, siteId?: Id<'farmLocations'>) => {
    const r = await as(userId).query(internal.anowa.reads.read, { tool, args, now: NOW, siteId })
    return r.ok ? { ok: true as const, data: JSON.parse(r.data) } : r
  }
  return { t, as, read, ...ids }
}

type S = Awaited<ReturnType<typeof setup>>

/** A real cycle in N1: stocked, eight samples and daily records, rollups built. */
async function grow(s: S) {
  const owner = s.as(s.owner)
  const id = await owner.mutation(api.stocking.createStocking, {
    cageId: s.N1, stockingDate: OPENED, fishCount: 1000, initialAbw: 10, initialBiomass: 10, species: 'nile_tilapia',
  })
  const st = await s.t.run(async (ctx) => await ctx.db.get(id))
  if (st?.status === 'pending_approval') await owner.mutation(api.stocking.approveStocking, { id })
  for (let w = 1; w <= 8; w++) {
    const date = addDays(OPENED, 14 * w)
    await owner.mutation(api.biweeklyRecords.create, {
      cageId: s.N1, date, batchCode: `S-${date}`, averageBodyWeight: Math.round(abwAt(14 * w) * 10) / 10, totalFishCount: 50, totalWeight: 1,
    })
    await owner.mutation(api.dailyRecords.create, {
      cageId: s.N1, date, feedAmount: 120, feedTypeId: s.feedTypeId, feedPrice: 2, feedCost: 240, mortality: 2, temperatureC: 28,
    })
  }
  await s.t.mutation(internal.rollups.processDirty, {})
}

describe('forecast and planner', () => {
  test('forecast_unit gives the harvest date range; site scope and tenant hold', async () => {
    const s = await setup()
    await grow(s)
    const r = await s.read(s.owner, 'forecast_unit', { unit: 'n1', targetG: 400 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.unit).toBe('N1')
    expect(r.data.targetG).toBe(400)
    expect(r.data.targetFrom).toBe('input')
    expect(r.data.reachesTarget.expected).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(r.data.method).toBe('fitted')
    // The North clerk sees N1; South's S1 and the other company's B1 do not match.
    expect((await s.read(s.clerk, 'forecast_unit', { unit: 'N1' })).ok).toBe(true)
    expect(await s.read(s.clerk, 'forecast_unit', { unit: 'S1' })).toEqual({ ok: false, error: 'No such unit in your sites.' })
    expect(await s.read(s.ownerB, 'forecast_unit', { unit: 'N1' })).toEqual({ ok: false, error: 'No such unit in your sites.' })
  })

  test('harvest_planner needs reports.view and lists units reaching target', async () => {
    const s = await setup()
    await grow(s)
    expect(await s.read(s.clerk, 'harvest_planner')).toEqual({ ok: false, error: 'You do not have reports.view permission.' })
    const r = await s.read(s.owner, 'harvest_planner', { weeks: 26, targetG: 300 })
    if (!r.ok) throw new Error(r.error)
    expect(r.data.units.map((u: { unit: string }) => u.unit)).toEqual(['N1'])
    const b = await s.read(s.ownerB, 'harvest_planner', { weeks: 26 })
    if (!b.ok) throw new Error(b.error)
    expect(b.data.units).toEqual([])
  })
})

describe('sampling and water', () => {
  test('sampling_history: ABW trend with ADG, scoped to the member', async () => {
    const s = await setup()
    await grow(s)
    const r = await s.read(s.clerk, 'sampling_history', { unit: 'N1' })
    if (!r.ok) throw new Error(r.error)
    expect(r.data.samples).toHaveLength(8)
    expect(r.data.samples[1].adgGDay).toBeGreaterThan(0)
    expect(r.data.trend.abwGainG).toBeGreaterThan(0)
    // A sample batch code works too, and not across tenants.
    const code = `S-${addDays(OPENED, 14)}`
    const byCode = await s.read(s.owner, 'sampling_history', { batch: code })
    if (!byCode.ok) throw new Error(byCode.error)
    expect(byCode.data.samples).toHaveLength(1)
    const other = await s.read(s.ownerB, 'sampling_history', { batch: code })
    expect(other.ok && other.data.samples).toEqual([])
  })

  test('water_quality: latest, DO trend and low-DO events; farm-wide view scoped', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      for (const [unitId, companyId, locationId, dox] of [
        [s.N1, s.companyA, s.north, 2.1],
        [s.N1, s.companyA, s.north, 6.0],
        [s.S1, s.companyA, s.south, 1.5],
        [s.B1, s.companyB, s.siteB, 1.0],
      ] as const) {
        await ctx.db.insert('waterQualityReadings', {
          companyId, locationId, unitId, measuredAt: NOW - 3600_000, date: TODAY, dissolvedOxygen: dox, temperatureC: 29,
          source: 'manual', breachCount: dox < 3 ? 1 : 0,
        })
      }
    })
    const r = await s.read(s.clerk, 'water_quality', { unit: 'N1' })
    if (!r.ok) throw new Error(r.error)
    expect(r.data.doMgL).toMatchObject({ min: 2.1, max: 6, n: 2 })
    expect(r.data.lowDoEvents).toBe(1)
    const farm = await s.read(s.clerk, 'water_quality')
    if (!farm.ok) throw new Error(farm.error)
    expect(farm.data.units.map((u: { unit: string }) => u.unit)).toEqual(['N1'])
    const all = await s.read(s.owner, 'water_quality')
    if (!all.ok) throw new Error(all.error)
    expect(all.data.units.map((u: { unit: string }) => u.unit).sort()).toEqual(['N1', 'S1'])
  })
})

describe('money, movements and approvals', () => {
  test('sales_summary needs finance.view; revenue, outstanding and P&L per tenant and site', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      const sale = (companyId: Id<'companies'>, locationId: Id<'farmLocations'>, weightKg: number, price: number, paid: boolean) =>
        ctx.db.insert('sales', {
          companyId, locationId, saleDate: TODAY, weightKg, pricePerKg: price, totalAmount: weightKg * price,
          paymentStatus: paid ? 'paid' : 'pending', customerName: 'Market', updatedAt: Date.now(),
        })
      await sale(s.companyA, s.north, 100, 30, true)
      await sale(s.companyA, s.south, 50, 30, false)
      await sale(s.companyB, s.siteB, 999, 99, false)
      await ctx.db.insert('expenses', { companyId: s.companyA, locationId: s.north, category: 'labour', amount: 500, currency: 'GHS', date: TODAY, updatedAt: Date.now() })
    })
    expect(await s.read(s.clerk, 'sales_summary')).toEqual({ ok: false, error: 'You do not have finance.view permission.' })
    const own = await s.read(s.owner, 'sales_summary')
    if (!own.ok) throw new Error(own.error)
    expect(own.data.sales).toMatchObject({ count: 2, kg: 150, revenue: 4500, revenuePerKg: 30 })
    expect(own.data.outstanding.total).toBe(1500)
    expect(own.data.costs.expenses).toBe(500)
    expect(own.data.profit).toBe(4000)
    const north = await s.read(s.approver, 'sales_summary')
    if (!north.ok) throw new Error(north.error)
    expect(north.data.sales.revenue).toBe(3000)
    expect(north.data.outstanding.total).toBe(0)
  })

  test('pending_approvals: only requests the member may decide, flags their own', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      const pending = (cageId: Id<'cages'>, companyId: Id<'companies'>, locationId: Id<'farmLocations'>, createdBy: Id<'users'>) =>
        ctx.db.insert('stockingHistory', {
          cageId, batchNumber: `B-${cageId}`, stockingDate: TODAY, fishCount: 5000, initialAbw: 5, initialBiomass: 25,
          status: 'pending_approval', companyId, locationId, createdBy,
        })
      await pending(s.N1, s.companyA, s.north, s.approver)
      await pending(s.S1, s.companyA, s.south, s.owner)
      await pending(s.B1, s.companyB, s.siteB, s.ownerB)
    })
    expect(await s.read(s.clerk, 'pending_approvals')).toEqual({ ok: false, error: 'You cannot approve stockings or transfers.' })
    const r = await s.read(s.approver, 'pending_approvals')
    if (!r.ok) throw new Error(r.error)
    expect(r.data.requests).toHaveLength(1)
    expect(r.data.requests[0]).toMatchObject({ kind: 'stocking', unit: 'N1', fish: 5000, youRequested: true })
    expect(typeof r.data.requests[0].ref).toBe('string')
    const own = await s.read(s.owner, 'pending_approvals')
    if (!own.ok) throw new Error(own.error)
    expect(own.data.requests.map((x: { unit: string }) => x.unit).sort()).toEqual(['N1', 'S1'])
  })

  test('stocking_transfers lists the period, scoped', async () => {
    const s = await setup()
    await grow(s)
    const r = await s.read(s.owner, 'stocking_transfers', { from: OPENED, to: TODAY })
    if (!r.ok) throw new Error(r.error)
    expect(r.data.stockings.count).toBe(1)
    const b = await s.read(s.ownerB, 'stocking_transfers', { from: OPENED, to: TODAY })
    if (!b.ok) throw new Error(b.error)
    expect(b.data.stockings.count).toBe(0)
  })
})

describe('hatchery, lots, plans and alerts', () => {
  test('hatchery_summary needs hatchery.view and counts the scoped hatchery', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      await ctx.db.insert('broodstock', {
        companyId: s.companyA, locationId: s.north, kind: 'group', code: 'F1', sex: 'female', count: 40, origin: 'farm', status: 'ready', updatedAt: Date.now(),
      })
      await ctx.db.insert('broodstock', {
        companyId: s.companyB, locationId: s.siteB, kind: 'group', code: 'F1', sex: 'female', count: 99, origin: 'farm', status: 'ready', updatedAt: Date.now(),
      })
      await ctx.db.insert('spawningEvents', {
        companyId: s.companyA, locationId: s.north, spawnDate: TODAY, method: 'natural', femaleIds: [], maleIds: [], eggsCollected: 20000, status: 'spawned', updatedAt: Date.now(),
      })
    })
    expect(await s.read(s.clerk, 'hatchery_summary')).toEqual({ ok: false, error: 'You do not have hatchery.view permission.' })
    const r = await s.read(s.approver, 'hatchery_summary')
    if (!r.ok) throw new Error(r.error)
    expect(r.data.broodstock.ready).toEqual({ groups: 1, fish: 40 })
    expect(r.data.spawns).toMatchObject({ count: 1, eggsCollected: 20000 })
  })

  test('lot_lookup: by code, refused outside the site or tenant', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      const harvestId = await ctx.db.insert('harvestRecords', {
        cageId: s.S1, harvestDate: TODAY, averageBodyWeight: 400, totalWeight: 800, estimatedCount: 2000, fcr: 1.4, companyId: s.companyA, locationId: s.south,
      })
      await ctx.db.insert('harvestLots', {
        companyId: s.companyA, locationId: s.south, harvestId, cageId: s.S1, lotCode: 'LOT-S1', harvestDate: TODAY, weightKg: 500, grade: 'A', updatedAt: Date.now(),
      })
    })
    const r = await s.read(s.owner, 'lot_lookup', { code: 'lot-s1' })
    if (!r.ok) throw new Error(r.error)
    expect(r.data).toMatchObject({ lot: 'LOT-S1', unit: 'S1', weightKg: 500, remainingKg: 500 })
    expect(await s.read(s.clerk, 'lot_lookup', { code: 'LOT-S1' })).toEqual({ ok: false, error: 'No lot LOT-S1 in your sites.' })
    expect(await s.read(s.ownerB, 'lot_lookup', { code: 'LOT-S1' })).toEqual({ ok: false, error: 'No lot LOT-S1 in your sites.' })
  })

  test('cycle_plans: production.plan.manage, plans with units out of scope hidden', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      const plan = (name: string, unitIds: Id<'cages'>[], companyId: Id<'companies'>) =>
        ctx.db.insert('cyclePlans', {
          companyId, name, unitIds,
          inputs: { stockOn: TODAY, fishPerUnit: 5000, stockAbwG: 10, harvestAbwG: 400, feedPricePerBag: 300, bagKg: 25, salePricePerKg: 30, fingerlingPrice: 1 },
          assumptions: { speciesKey: 'nile_tilapia', cycles: 0, survivalPct: 85, fcr: 1.5, tgc: 1.2, tempC: 28, monthlyTempC: null, sources: { survival: 'default', fcr: 'default', growth: 'default' } },
          createdBy: s.owner, createdAt: Date.now(), updatedBy: s.owner, updatedAt: Date.now(),
        })
      await plan('North plan', [s.N1], s.companyA)
      await plan('Both', [s.N1, s.S1], s.companyA)
      await plan('Other', [s.B1], s.companyB)
    })
    expect(await s.read(s.clerk, 'cycle_plans')).toEqual({ ok: false, error: 'You do not have production.plan.manage permission.' })
    const r = await s.read(s.approver, 'cycle_plans')
    if (!r.ok) throw new Error(r.error)
    expect(r.data.plans.map((p: { name: string }) => p.name)).toEqual(['North plan'])
    const own = await s.read(s.owner, 'cycle_plans')
    if (!own.ok) throw new Error(own.error)
    expect(own.data.plans).toHaveLength(2)
  })

  test('sensor_alerts: open alerts in scope only', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      const alert = (unitId: Id<'cages'>, unitName: string, companyId: Id<'companies'>, locationId: Id<'farmLocations'>) =>
        ctx.db.insert('farmAlerts', {
          companyId, locationId, unitId, unitName, rule: 'low_oxygen', severity: 'critical', status: 'open', date: TODAY, lastSeenDate: TODAY,
          evidence: { minDo: 1.9 }, createdAt: Date.now(), updatedAt: Date.now(),
        })
      await alert(s.N1, 'N1', s.companyA, s.north)
      await alert(s.S1, 'S1', s.companyA, s.south)
      await alert(s.B1, 'B1', s.companyB, s.siteB)
    })
    const r = await s.read(s.clerk, 'sensor_alerts')
    if (!r.ok) throw new Error(r.error)
    expect(r.data.alerts.map((a: { unit: string }) => a.unit)).toEqual(['N1'])
    // The chosen site narrows an all-sites member too.
    const south = await s.read(s.owner, 'sensor_alerts', {}, s.south)
    if (!south.ok) throw new Error(south.error)
    expect(south.data.alerts.map((a: { unit: string }) => a.unit)).toEqual(['S1'])
  })

  test('a member without ai.use is refused', async () => {
    const s = await setup()
    const viewer = await s.t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { email: 'v@a.com', role: 'user', companyId: s.companyA })
      await ctx.db.insert('memberships', { userId, companyId: s.companyA, roleKey: 'viewer', allLocations: true, status: 'active', updatedAt: Date.now() })
      return userId
    })
    await expect(s.read(viewer, 'sensor_alerts')).rejects.toThrow()
  })
})

describe('1,000 units', () => {
  test('reads stay bounded and capped', async () => {
    const s = await setup()
    await grow(s)
    await s.t.run(async (ctx) => {
      const template = (await ctx.db.query('batchStats').first())!
      const { _id, _creationTime, ...stats } = template
      for (let i = 0; i < 1000; i++) {
        const unitId = await ctx.db.insert('cages', {
          name: `C-${String(i).padStart(4, '0')}`, status: 'active', currentCount: 1000, species: 'nile_tilapia',
          companyId: s.companyA, locationId: s.north, updatedAt: Date.now(),
        })
        await ctx.db.insert('batchStats', { ...stats, unitId })
        await ctx.db.insert('waterQualityReadings', {
          companyId: s.companyA, locationId: s.north, unitId, measuredAt: NOW - 60_000 * (i + 1), date: TODAY, dissolvedOxygen: 2, source: 'sensor', breachCount: 1,
        })
        if (i < 600) {
          await ctx.db.insert('stockingHistory', {
            cageId: unitId, batchNumber: `P-${i}`, stockingDate: TODAY, fishCount: 100, initialAbw: 5, initialBiomass: 0.5,
            status: 'pending_approval', companyId: s.companyA, locationId: s.north, createdBy: s.owner,
          })
        }
      }
    })
    const planner = await s.read(s.owner, 'harvest_planner', { weeks: 26 })
    if (!planner.ok) throw new Error(planner.error)
    expect(planner.data.partial).toBe(true)
    expect(planner.data.units.length).toBeLessThanOrEqual(25)
    const water = await s.read(s.owner, 'water_quality')
    if (!water.ok) throw new Error(water.error)
    expect(water.data.units).toHaveLength(15)
    expect(water.data.partial).toBe(true)
    const approvals = await s.read(s.approver, 'pending_approvals')
    if (!approvals.ok) throw new Error(approvals.error)
    expect(approvals.data.requests).toHaveLength(20)
    expect(approvals.data.more).toBeGreaterThan(0)
    // A unit past the first few hundred still matches by name.
    const late = await s.read(s.owner, 'forecast_unit', { unit: 'C-0999' })
    if (!late.ok) throw new Error(late.error)
    expect(late.data.unit).toBe('C-0999')
    const w = await s.read(s.owner, 'water_quality', { unit: 'C-0999' })
    if (!w.ok) throw new Error(w.error)
    expect(w.data.lowDoEvents).toBe(1)
  }, 120_000)
})
