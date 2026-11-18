/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { eventsForUnit } from './lib/productionEngine'

const modules = import.meta.glob('./**/*.ts')

/** Broodstock, spawning, incubation and hatch (HAT-001, HAT-002). */
async function hatcherySetup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Hatch Farm',
      code: 'HATCH',
      status: 'approved',
      createdAt: Date.now(),
    })
    const otherCompanyId = await ctx.db.insert('companies', {
      name: 'Other',
      code: 'OTH',
      status: 'approved',
      createdAt: Date.now(),
    })
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCompanyId })
    const unit = (name: string, unitType?: 'incubator' | 'hatchery_tank' | 'tank' | 'pond', cid = companyId) =>
      ctx.db.insert('cages', {
        name,
        status: 'empty',
        currentCount: 0,
        capacity: 1_000_000,
        unitType,
        companyId: cid,
        updatedAt: Date.now(),
      })
    const units = {
      brood: await unit('Brood 1', 'tank'),
      inc1: await unit('Incubator 1', 'incubator'),
      inc2: await unit('Incubator 2', 'incubator'),
      larval1: await unit('Larval 1', 'hatchery_tank'),
      larval2: await unit('Larval 2', 'hatchery_tank'),
      nursery1: await unit('Nursery 1', 'tank'),
      nursery2: await unit('Nursery 2', 'tank'),
      growout: await unit('Cage 7'),
      otherCo: await unit('Their tank', 'tank', otherCompanyId),
    }
    return { companyId, otherCompanyId, adminId, staffId, outsiderId, units }
  })
  const as = t.withIdentity({ subject: `${ids.adminId}|s` })
  const asStaff = t.withIdentity({ subject: `${ids.staffId}|s` })
  const asOutsider = t.withIdentity({ subject: `${ids.outsiderId}|s` })

  const brood = async () => {
    const f1 = await asStaff.mutation(api.hatchery.createBroodstock, {
      kind: 'individual',
      code: 'F-001',
      sex: 'female',
      origin: 'farm',
      weightG: 1200,
      speciesCode: 'tilapia',
      unitId: ids.units.brood,
    })
    const f2 = await asStaff.mutation(api.hatchery.createBroodstock, {
      kind: 'individual',
      code: 'F-002',
      sex: 'female',
      origin: 'farm',
      weightG: 800,
      speciesCode: 'tilapia',
    })
    const males = await asStaff.mutation(api.hatchery.createBroodstock, {
      kind: 'group',
      code: 'M-GROUP-A',
      sex: 'male',
      count: 5,
      origin: 'purchased',
      weightG: 900,
      speciesCode: 'tilapia',
    })
    return { f1, f2, males }
  }

  /** Spawning → eggs → one incubation lot → hatch. Returns the hatched batch. */
  const hatchBatch = async (larvae = 40_000, unitId: Id<'cages'> = ids.units.larval1) => {
    const b = await brood()
    const spawningEventId = await asStaff.mutation(api.hatchery.recordSpawning, {
      spawnDate: '2026-10-01',
      method: 'induced',
      hormone: 'Ovaprim',
      hormoneDose: '0.5 ml/kg',
      femaleIds: [b.f1, b.f2],
      maleIds: [b.males],
      eggsCollected: 60_000,
      fertilizationPct: 80,
    })
    const lotId = await asStaff.mutation(api.hatchery.startIncubation, {
      spawningEventId,
      unitId: ids.units.inc1,
      startedOn: '2026-10-01',
      eggs: 50_000,
    })
    const hatch = await asStaff.mutation(api.hatchery.recordHatch, {
      lotId,
      hatchedOn: '2026-10-04',
      larvaeCount: larvae,
      larvalUnitId: unitId,
    })
    return { ...b, spawningEventId, lotId, ...hatch }
  }
  const ledger = (unitId: Id<'cages'>) =>
    t.run(async (ctx) => {
      const cage = (await ctx.db.get(unitId))!
      return [cage.currentCount ?? 0, (await eventsForUnit(ctx, unitId)).reduce((s, e) => s + e.qtyDelta, 0)]
    })
  return { t, as, asStaff, asOutsider, ids, brood, hatchBatch, ledger }
}

describe('broodstock registry (HAT-001)', () => {
  test('registers individuals and groups and lists them per unit', async () => {
    const { as, ids, brood } = await hatcherySetup()
    await brood()
    const all = await as.query(api.hatchery.listBroodstock, {})
    expect(all.map((b) => b.code).sort()).toEqual(['F-001', 'F-002', 'M-GROUP-A'])
    const group = all.find((b) => b.code === 'M-GROUP-A')!
    expect(group).toMatchObject({ kind: 'group', count: 5, total_kg: 4.5, status: 'ready' })
    const inUnit = await as.query(api.hatchery.listBroodstock, { unitId: ids.units.brood })
    expect(inUnit.map((b) => b.code)).toEqual(['F-001'])
    expect(inUnit[0].unit_name).toBe('Brood 1')
  })

  test('refuses duplicate codes, a group-sized individual and mixed-sex individuals', async () => {
    const { as, brood } = await hatcherySetup()
    await brood()
    await expect(
      as.mutation(api.hatchery.createBroodstock, { kind: 'individual', code: 'F-001', sex: 'female', origin: 'wild' }),
    ).rejects.toThrow(/already exists/)
    await expect(
      as.mutation(api.hatchery.createBroodstock, { kind: 'individual', code: 'X', sex: 'female', origin: 'wild', count: 3 }),
    ).rejects.toThrow(/one fish/)
    await expect(
      as.mutation(api.hatchery.createBroodstock, { kind: 'individual', code: 'Y', sex: 'mixed', origin: 'wild' }),
    ).rejects.toThrow(/mixed sex/)
    await expect(
      as.mutation(api.hatchery.createBroodstock, { kind: 'group', code: 'G', sex: 'mixed', origin: 'wild', count: 0 }),
    ).rejects.toThrow(/whole number/)
  })

  test('conditioning sets a start date; other companies cannot see or edit', async () => {
    const { as, asOutsider, brood } = await hatcherySetup()
    const { f1 } = await brood()
    await as.mutation(api.hatchery.updateBroodstock, { id: f1, status: 'conditioning', weightG: 1300 })
    const b = await as.query(api.hatchery.getBroodstock, { id: f1 })
    expect(b.status).toBe('conditioning')
    expect(b.conditioning_started_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(b.weight_g).toBe(1300)
    await expect(asOutsider.query(api.hatchery.getBroodstock, { id: f1 })).rejects.toThrow(/not found/)
    await expect(asOutsider.mutation(api.hatchery.updateBroodstock, { id: f1, notes: 'x' })).rejects.toThrow(/not found/)
    expect(await asOutsider.query(api.hatchery.listBroodstock, {})).toEqual([])
  })
})

describe('spawning, incubation and hatch (HAT-002)', () => {
  test('a spawning snapshots female weight and marks broodstock spent', async () => {
    const { as, brood } = await hatcherySetup()
    const b = await brood()
    const id = await as.mutation(api.hatchery.recordSpawning, {
      spawnDate: '2026-10-01',
      method: 'natural',
      femaleIds: [b.f1, b.f2],
      maleIds: [b.males],
    })
    const s = await as.query(api.hatchery.getSpawning, { id })
    expect(s).toMatchObject({ female_weight_kg: 2, species: 'tilapia', status: 'spawned', female_codes: ['F-001', 'F-002'] })
    const f1 = await as.query(api.hatchery.getBroodstock, { id: b.f1 })
    expect(f1).toMatchObject({ status: 'spent', last_spawned_on: '2026-10-01', spawn_count: 1 })
    expect(f1.spawnings.map((x) => x.id)).toEqual([id])
  })

  test('refuses induced spawning without hormone, males as females and dead fish', async () => {
    const { as, brood } = await hatcherySetup()
    const b = await brood()
    const base = { spawnDate: '2026-10-01', femaleIds: [b.f1], maleIds: [b.males] }
    await expect(as.mutation(api.hatchery.recordSpawning, { ...base, method: 'induced' })).rejects.toThrow(/hormone/)
    await expect(
      as.mutation(api.hatchery.recordSpawning, { ...base, method: 'natural', femaleIds: [b.males], maleIds: [] }),
    ).rejects.toThrow(/is male, not female/)
    await as.mutation(api.hatchery.updateBroodstock, { id: b.f2, status: 'dead' })
    await expect(
      as.mutation(api.hatchery.recordSpawning, { ...base, method: 'natural', femaleIds: [b.f2] }),
    ).rejects.toThrow(/dead/)
  })

  test('incubation is limited to collected eggs and to incubation units', async () => {
    const { as, ids, brood } = await hatcherySetup()
    const b = await brood()
    const spawningEventId = await as.mutation(api.hatchery.recordSpawning, {
      spawnDate: '2026-10-01',
      method: 'natural',
      femaleIds: [b.f1],
      maleIds: [],
    })
    await as.mutation(api.hatchery.recordEggCollection, {
      spawningEventId,
      collectedOn: '2026-10-01',
      eggsCollected: 10_000,
      fertilizationPct: 90,
    })
    await expect(
      as.mutation(api.hatchery.startIncubation, {
        spawningEventId,
        unitId: ids.units.growout,
        startedOn: '2026-10-01',
        eggs: 1000,
      }),
    ).rejects.toThrow(/incubate in an incubator/)
    await as.mutation(api.hatchery.startIncubation, { spawningEventId, unitId: ids.units.inc1, startedOn: '2026-10-01', eggs: 7000 })
    await expect(
      as.mutation(api.hatchery.startIncubation, { spawningEventId, unitId: ids.units.inc2, startedOn: '2026-10-01', eggs: 4000 }),
    ).rejects.toThrow(/Only 3,000/)
    await expect(
      as.mutation(api.hatchery.startIncubation, { spawningEventId, unitId: ids.units.otherCo, startedOn: '2026-10-01', eggs: 10 }),
    ).rejects.toThrow(/not found/)
    const board = await as.query(api.hatchery.incubationBoard, {})
    expect(board).toHaveLength(1)
    expect(board[0]).toMatchObject({ status: 'incubating', eggs: 7000, unit_name: 'Incubator 1', fertilization_pct: 90 })
  })

  test('a hatch opens a larval batch through the engine with its broodstock', async () => {
    const { t, as, ids, hatchBatch, ledger } = await hatcherySetup()
    const h = await hatchBatch(40_000)
    expect(h.hatchPct).toBe(80)
    expect(await ledger(ids.units.larval1)).toEqual([40_000, 40_000])
    const batch = await t.run((ctx) => ctx.db.get(h.batchId))
    expect(batch).toMatchObject({ origin: 'hatchery', status: 'active', openedOn: '2026-10-04', speciesCode: 'tilapia' })
    expect(batch!.batchNumber).toBe('HAT-LARVAL1-20261004')
    expect(batch!.spawningEventId).toBe(h.spawningEventId)
    expect(batch!.broodstockIds).toEqual([h.f1, h.f2, h.males])
    const cage = await t.run((ctx) => ctx.db.get(ids.units.larval1))
    expect(cage).toMatchObject({ status: 'active', currentBatchId: h.batchId, species: 'tilapia' })

    const s = await as.query(api.hatchery.getSpawning, { id: h.spawningEventId })
    expect(s).toMatchObject({ status: 'hatched', larvae: 40_000, hatch_pct: 80, fry_per_kg_female: 20_000, eggs_per_kg_female: 30_000 })
    const k = await as.query(api.hatchery.kpis, {})
    expect(k).toMatchObject({
      spawnings: 1,
      eggs_collected: 60_000,
      fertilization_pct: 80,
      hatch_rate_pct: 80,
      larvae_hatched: 40_000,
      fry_per_kg_female: 20_000,
      larval_survival_pct: 100,
      broodstock_total: 7,
    })
    const origin = await as.query(api.hatchery.batchOrigin, { batchId: h.batchId })
    expect(origin).toMatchObject({ hatched_batch_id: h.batchId, generations: 0 })
    expect(origin!.spawning.female_codes).toEqual(['F-001', 'F-002'])

    const events = await t.run((ctx) => eventsForUnit(ctx, ids.units.larval1))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'stock_in', sourceTable: 'incubationLots', sourceId: h.lotId })
  })

  test('a hatch into a unit holding another batch is refused and nothing is written', async () => {
    const { t, as, ids, hatchBatch } = await hatcherySetup()
    await hatchBatch(40_000)
    const b2 = await as.mutation(api.hatchery.createBroodstock, { kind: 'individual', code: 'F-9', sex: 'female', origin: 'wild' })
    const s2 = await as.mutation(api.hatchery.recordSpawning, { spawnDate: '2026-10-02', method: 'natural', femaleIds: [b2], maleIds: [] })
    const lot2 = await as.mutation(api.hatchery.startIncubation, { spawningEventId: s2, unitId: ids.units.inc2, startedOn: '2026-10-02', eggs: 1000 })
    await expect(
      as.mutation(api.hatchery.recordHatch, { lotId: lot2, hatchedOn: '2026-10-05', larvaeCount: 500, larvalUnitId: ids.units.larval1 }),
    ).rejects.toThrow(/two batches/)
    const lot = await t.run((ctx) => ctx.db.get(lot2))
    expect(lot!.status).toBe('incubating')
  })

  test('a replayed hatch returns the first result without a second batch', async () => {
    const { t, as, ids, brood } = await hatcherySetup()
    const b = await brood()
    const s = await as.mutation(api.hatchery.recordSpawning, { spawnDate: '2026-10-01', method: 'natural', femaleIds: [b.f1], maleIds: [] })
    const lotId = await as.mutation(api.hatchery.startIncubation, { spawningEventId: s, unitId: ids.units.inc1, startedOn: '2026-10-01', eggs: 1000 })
    const args = { lotId, hatchedOn: '2026-10-03', larvaeCount: 900, clientMutationId: 'hatch-1' }
    const first = await as.mutation(api.hatchery.recordHatch, args)
    const again = await as.mutation(api.hatchery.recordHatch, args)
    expect(again).toEqual(first)
    const batches = await t.run((ctx) => ctx.db.query('batches').collect())
    expect(batches).toHaveLength(1)
    // Larvae stay in the incubator when no larval unit is given.
    expect(batches[0].batchNumber).toBe('HAT-INCUBATOR1-20261003')
  })

  test('reversing a hatch is admin-only and empties the unit', async () => {
    const { t, as, asStaff, ids, hatchBatch, ledger } = await hatcherySetup()
    const h = await hatchBatch(40_000)
    await expect(asStaff.mutation(api.hatchery.reverseHatch, { lotId: h.lotId, reason: 'typo' })).rejects.toThrow(
      /Insufficient permissions/,
    )
    await as.mutation(api.hatchery.reverseHatch, { lotId: h.lotId, reason: 'typo' })
    expect(await ledger(ids.units.larval1)).toEqual([0, 0])
    const batch = await t.run((ctx) => ctx.db.get(h.batchId))
    expect(batch!.status).toBe('closed')
    const s = await as.query(api.hatchery.getSpawning, { id: h.spawningEventId })
    expect(s.status).toBe('incubating')
    // The lot can hatch again.
    await as.mutation(api.hatchery.recordHatch, { lotId: h.lotId, hatchedOn: '2026-10-04', larvaeCount: 39_000, larvalUnitId: ids.units.larval1 })
    expect(await ledger(ids.units.larval1)).toEqual([39_000, 39_000])
  })

  test('a failed lot fails the spawning', async () => {
    const { as, ids, brood } = await hatcherySetup()
    const b = await brood()
    const s = await as.mutation(api.hatchery.recordSpawning, { spawnDate: '2026-10-01', method: 'natural', femaleIds: [b.f1], maleIds: [] })
    const lotId = await as.mutation(api.hatchery.startIncubation, { spawningEventId: s, unitId: ids.units.inc1, startedOn: '2026-10-01', eggs: 1000 })
    await as.mutation(api.hatchery.markLotFailed, { lotId, date: '2026-10-03', reason: 'Fungus' })
    const sp = await as.query(api.hatchery.getSpawning, { id: s })
    expect(sp.status).toBe('failed')
    expect(sp.lots[0]).toMatchObject({ status: 'failed', hatch_pct: 0 })
  })
})

describe('larval rearing and live feed (HAT-003)', () => {
  test('deaths and survival counts post to the ledger; saving the day again replaces it', async () => {
    const { t, as, asStaff, ids, hatchBatch, ledger } = await hatcherySetup()
    const h = await hatchBatch(40_000)
    const first = await asStaff.mutation(api.nursery.saveLarvalLog, {
      unitId: ids.units.larval1,
      logDate: '2026-10-05',
      mortality: 1000,
      countedAlive: 30_000,
      liveFeed: [{ kind: 'rotifer', quantity: 20, unit: 'million' }],
      temperatureC: 28,
    })
    expect(first).toMatchObject({ batchId: h.batchId, alive: 30_000, adjusted: -9_000 })
    expect(await ledger(ids.units.larval1)).toEqual([30_000, 30_000])

    const again = await asStaff.mutation(api.nursery.saveLarvalLog, {
      unitId: ids.units.larval1,
      logDate: '2026-10-05',
      mortality: 500,
      countedAlive: 35_000,
      liveFeed: [{ kind: 'artemia', quantity: 5, unit: 'million' }],
    })
    expect(again.logId).toBe(first.logId)
    expect(await ledger(ids.units.larval1)).toEqual([35_000, 35_000])
    const logs = await as.query(api.nursery.listLarvalLogs, { batchId: h.batchId })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      mortality: 500,
      counted_alive: 35_000,
      live_feed: [{ kind: 'artemia', quantity: 5, unit: 'million' }],
    })

    await asStaff.mutation(api.nursery.recordLiveFeed, {
      date: '2026-10-05',
      kind: 'artemia',
      movement: 'produced',
      quantity: 12,
      unit: 'million',
      culture: 'Hatching cone 1',
      inputNote: '50 g cysts',
    })
    const lf = await as.query(api.nursery.liveFeed, {})
    expect(lf.balances).toEqual([{ kind: 'artemia', unit: 'million', produced: 12, used: 5, discarded: 0, on_hand: 7 }])
    expect(lf.entries.filter((e) => e.from_larval_log)).toHaveLength(1)

    const batches = await as.query(api.nursery.larvalBatches, {})
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({
      stage: 'larvae',
      count: 35_000,
      stocked: 40_000,
      survival_pct: 87.5,
      last_log_date: '2026-10-05',
    })
    const events = await t.run((ctx) => eventsForUnit(ctx, ids.units.larval1))
    expect(events.filter((e) => e.sourceTable === 'larvalLogs' && e.type === 'reversal')).toHaveLength(2)
  })

  test('a replayed offline log writes once; a unit without larvae is refused', async () => {
    const { as, ids, hatchBatch, ledger } = await hatcherySetup()
    await hatchBatch(40_000)
    const args = { unitId: ids.units.larval1, logDate: '2026-10-05', mortality: 100, clientMutationId: 'log-1' }
    const a = await as.mutation(api.nursery.saveLarvalLog, args)
    const b = await as.mutation(api.nursery.saveLarvalLog, args)
    expect(b).toEqual(a)
    expect(await ledger(ids.units.larval1)).toEqual([39_900, 39_900])
    await expect(
      as.mutation(api.nursery.saveLarvalLog, { unitId: ids.units.larval2, logDate: '2026-10-05', mortality: 1 }),
    ).rejects.toThrow(/holds no batch/)
    await expect(
      as.mutation(api.nursery.saveLarvalLog, { unitId: ids.units.larval1, logDate: '2026-10-06', mortality: 50_000 }),
    ).rejects.toThrow(/Not enough fish/)
  })
})

describe('grading and fingerlings out (NUR-001, HAT-004, NUR-002)', () => {
  async function graded() {
    const s = await hatcherySetup()
    const h = await s.hatchBatch(40_000)
    await s.as.mutation(api.nursery.saveLarvalLog, {
      unitId: s.ids.units.larval1,
      logDate: '2026-10-10',
      countedAlive: 30_000,
    })
    const g = await s.as.mutation(api.nursery.gradeFingerlings, {
      unitId: s.ids.units.larval1,
      date: '2026-10-25',
      outputs: [
        { unitId: s.ids.units.nursery1, quantity: 20_000, abwG: 1.2 },
        { unitId: s.ids.units.nursery2, quantity: 9_000, abwG: 0.6 },
      ],
      culls: 500,
    })
    return { ...s, h, g }
  }

  test('grading conserves fish and opens fingerling batches with the larval batch as parent', async () => {
    const { t, as, asStaff, ids, h, g, ledger } = await graded()
    expect(g.unaccounted).toBe(500)
    expect(await ledger(ids.units.larval1)).toEqual([0, 0])
    expect(await ledger(ids.units.nursery1)).toEqual([20_000, 20_000])
    expect(await ledger(ids.units.nursery2)).toEqual([9_000, 9_000])
    const [c1, c2] = await t.run(async (ctx) => Promise.all(g.childBatchIds.map((id) => ctx.db.get(id))))
    expect(c1).toMatchObject({
      origin: 'grading_split',
      parentBatchIds: [h.batchId],
      batchNumber: 'HAT-LARVAL1-20261004-A',
    })
    expect(c2!.parentBatchIds).toEqual([h.batchId])
    const parent = await t.run((ctx) => ctx.db.get(h.batchId))
    expect(parent!.status).toBe('closed')
    await expect(
      asStaff.mutation(api.nursery.gradeFingerlings, {
        unitId: ids.units.nursery1,
        date: '2026-10-26',
        outputs: [{ unitId: ids.units.nursery2, quantity: 1, abwG: 1 }],
      }),
    ).rejects.toThrow(/Insufficient permissions/)
    const list = await as.query(api.nursery.larvalBatches, {})
    expect(list.map((b) => b.stage).sort()).toEqual(['fingerlings', 'fingerlings'])
    expect(list.every((b) => b.hatched_batch_number === 'HAT-LARVAL1-20261004')).toBe(true)
  })

  test('fingerlings transferred to grow-out keep their hatchery lineage', async () => {
    const { t, as, ids, g, h, ledger } = await graded()
    const r = await as.mutation(api.nursery.transferFingerlings, {
      sourceUnitId: ids.units.nursery1,
      date: '2026-11-01',
      lines: [{ destinationUnitId: ids.units.growout, quantity: 15_000, abwG: 2 }],
    })
    expect(r.lines[0]).toMatchObject({ kind: 'move', targetBatchId: g.childBatchIds[0] })
    expect(await ledger(ids.units.nursery1)).toEqual([5_000, 5_000])
    expect(await ledger(ids.units.growout)).toEqual([15_000, 15_000])
    const cage = await t.run((ctx) => ctx.db.get(ids.units.growout))
    expect(cage).toMatchObject({ status: 'active', currentBatchId: g.childBatchIds[0] })
    const stocking = await t.run((ctx) =>
      ctx.db
        .query('stockingHistory')
        .withIndex('by_cage', (q) => q.eq('cageId', ids.units.growout))
        .collect(),
    )
    expect(stocking).toHaveLength(1)
    expect(stocking[0]).toMatchObject({ fishCount: 15_000, batchId: g.childBatchIds[0], status: 'approved' })

    // From the grow-out cage's batch back to the spawning and its broodstock.
    const origin = await as.query(api.hatchery.batchOrigin, { batchId: cage!.currentBatchId! })
    expect(origin).toMatchObject({ hatched_batch_id: h.batchId, generations: 1 })
    expect(origin!.spawning.female_codes).toEqual(['F-001', 'F-002'])
    expect(origin!.spawning.male_codes).toEqual(['M-GROUP-A'])
  })

  test('a sale by count reduces the batch and is reversed from the hatchery only', async () => {
    const { t, as, asStaff, ids, g, ledger } = await graded()
    const args = {
      kind: 'sale' as const,
      unitId: ids.units.nursery2,
      date: '2026-11-01',
      quantity: 4_000,
      abwG: 0.8,
      pricePerUnit: 0.5,
      customerName: 'Volta fish farm',
    }
    await expect(asStaff.mutation(api.nursery.dispatchFingerlings, args)).rejects.toThrow(/Insufficient permissions/)
    const r = await as.mutation(api.nursery.dispatchFingerlings, args)
    expect(await ledger(ids.units.nursery2)).toEqual([5_000, 5_000])
    const sale = await t.run((ctx) => ctx.db.get(r.saleId!))
    expect(sale).toMatchObject({
      unitCount: 4_000,
      pricePerUnit: 0.5,
      totalAmount: 2_000,
      weightKg: 3.2,
      batchId: g.childBatchIds[1],
    })
    await expect(as.mutation(api.sales.removeSale, { id: r.saleId! })).rejects.toThrow(/fingerling sale/)

    await as.mutation(api.nursery.reverseMovement, { id: r.movementId, reason: 'Buyer cancelled' })
    expect(await ledger(ids.units.nursery2)).toEqual([9_000, 9_000])
    expect(await t.run((ctx) => ctx.db.get(r.saleId!))).toBeNull()
    const moves = await as.query(api.nursery.listMovements, {})
    expect(moves[0]).toMatchObject({ kind: 'sale', status: 'reversed' })
  })

  test('a dispatch to another farm needs the farm and cannot exceed the stock', async () => {
    const { as, ids, ledger } = await graded()
    const base = { kind: 'external' as const, unitId: ids.units.nursery2, date: '2026-11-01', abwG: 0.8 }
    await expect(as.mutation(api.nursery.dispatchFingerlings, { ...base, quantity: 10 })).rejects.toThrow(
      /receiving farm/,
    )
    await expect(
      as.mutation(api.nursery.dispatchFingerlings, { ...base, quantity: 10_000, destinationFarm: 'Akosombo' }),
    ).rejects.toThrow(/Not enough fish/)
    await as.mutation(api.nursery.dispatchFingerlings, { ...base, quantity: 9_000, destinationFarm: 'Akosombo' })
    expect(await ledger(ids.units.nursery2)).toEqual([0, 0])
  })
})
