/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { gradingCv, sampleStats } from './lib/gradingMath'

const modules = import.meta.glob('./**/*.ts')

/** Grading drafts, the source view and recent gradings (Paper 52). */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', { name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: Date.now() })
    const otherCompanyId = await ctx.db.insert('companies', { name: 'Other', code: 'OTH', status: 'approved', createdAt: Date.now() })
    const siteA = await ctx.db.insert('farmLocations', { name: 'A', companyId, active: true, updatedAt: Date.now() })
    const siteB = await ctx.db.insert('farmLocations', { name: 'B', companyId, active: true, updatedAt: Date.now() })
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', name: 'Ama Admin', role: 'admin', companyId })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId })
    const siteAdminId = await ctx.db.insert('users', { email: 'b@x.com', role: 'admin', companyId, locationIds: [siteA] })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCompanyId })
    const cage = (name: string, locationId: Id<'farmLocations'>, extra: Record<string, number> = {}) =>
      ctx.db.insert('cages', { name, status: 'empty', currentCount: 0, capacity: 100000, companyId, locationId, updatedAt: Date.now(), ...extra })
    const cages = {
      C1: await cage('C1', siteA, { netVolumeM3: 200 }),
      C2: await cage('C2', siteA, { volumeM3: 100 }),
      C3: await cage('C3', siteA),
      CB: await cage('CB', siteB),
    }
    const otherCage = await ctx.db.insert('cages', { name: 'X1', status: 'empty', companyId: otherCompanyId, updatedAt: Date.now() })
    return { companyId, adminId, staffId, siteAdminId, outsiderId, cages, otherCage }
  })
  const as = t.withIdentity({ subject: `${ids.adminId}|s` })
  const asStaff = t.withIdentity({ subject: `${ids.staffId}|s` })
  const asSiteAdmin = t.withIdentity({ subject: `${ids.siteAdminId}|s` })
  const asOutsider = t.withIdentity({ subject: `${ids.outsiderId}|s` })
  const stock = async (cageId: Id<'cages'>, fishCount: number, date: string) => {
    const id = await as.mutation(api.stocking.createStocking, {
      cageId,
      stockingDate: date,
      fishCount,
      initialAbw: 20,
      initialBiomass: (fishCount * 20) / 1000,
    })
    await as.mutation(api.stocking.approveStocking, { id })
  }
  return { t, as, asStaff, asSiteAdmin, asOutsider, ids, stock }
}

const LARGE = [[280, 300, 320], [290, 310, 300]]
const SMALL = [[110, 120, 130]]

describe('grading drafts', () => {
  test('save, resume, replace and discard a draft; samples record who weighed them', async () => {
    const { as, ids, stock } = await setup()
    await stock(ids.cages.C1, 4000, '2026-08-01')
    const draft = {
      cageId: ids.cages.C1,
      date: '2026-11-21',
      graderBars: ' 18 / 24 mm ',
      classes: [
        { cageId: ids.cages.C1, quantity: 1000, abw: 300, samples: LARGE },
        { cageId: ids.cages.C2, quantity: 2950, samples: [[110, -1, 120, 130], []] },
      ],
      culls: 50,
      reason: 'Routine',
    }
    const saved = await as.mutation(api.grading.saveDraft, draft)

    const v1 = await as.query(api.grading.view, { cageId: ids.cages.C1, asOf: '2026-11-21' })
    expect(v1.source).toMatchObject({ cage_name: 'C1', count: 4000, day: 112, abw_g: 20, biomass_kg: 80 })
    expect(v1.source!.batch_number).toBeTruthy()
    expect(v1.draft).toMatchObject({
      date: '2026-11-21',
      grader_bars: '18 / 24 mm',
      culls: 50,
      reason: 'Routine',
      sampled_by: 'Ama Admin',
      sampled_at: saved.updatedAt,
      updated_at: saved.updatedAt,
    })
    // Bad weights and empty rounds are dropped.
    expect(v1.draft!.classes[1].samples).toEqual(SMALL)
    expect(await as.query(api.grading.drafts, {})).toEqual([{ cage_id: ids.cages.C1, updated_at: saved.updatedAt }])

    // Saving again without touching the samples keeps who weighed them and when.
    await new Promise((r) => setTimeout(r, 5))
    const again = await as.mutation(api.grading.saveDraft, { ...draft, culls: 60 })
    const v2 = await as.query(api.grading.view, { cageId: ids.cages.C1, asOf: '2026-11-21' })
    expect(v2.draft).toMatchObject({ culls: 60, sampled_at: saved.updatedAt, updated_at: again.updatedAt })
    expect(await as.query(api.grading.drafts, {})).toHaveLength(1)

    await as.mutation(api.grading.discardDraft, { cageId: ids.cages.C1 })
    expect((await as.query(api.grading.view, { cageId: ids.cages.C1, asOf: '2026-11-21' })).draft).toBeNull()
    expect(await as.query(api.grading.drafts, {})).toEqual([])
  })

  test('refuses members without the grading permission, other companies and sites out of scope', async () => {
    const { t, asStaff, asSiteAdmin, asOutsider, as, ids } = await setup()
    const draft = { cageId: ids.cages.C1, date: '2026-11-21', classes: [] }
    await expect(asStaff.mutation(api.grading.saveDraft, draft)).rejects.toThrow(/Insufficient permissions/)
    await expect(asStaff.query(api.grading.view, { cageId: ids.cages.C1, asOf: '2026-11-21' })).rejects.toThrow(
      /Insufficient permissions/,
    )
    await expect(asOutsider.mutation(api.grading.saveDraft, draft)).rejects.toThrow(/Cage not found/)
    await expect(
      as.mutation(api.grading.saveDraft, { ...draft, classes: [{ cageId: ids.otherCage, samples: [] }] }),
    ).rejects.toThrow(/Cage not found/)
    await expect(asSiteAdmin.mutation(api.grading.saveDraft, { ...draft, cageId: ids.cages.CB })).rejects.toThrow(
      /access to this site/,
    )

    await as.mutation(api.grading.saveDraft, draft)
    await as.mutation(api.grading.saveDraft, { ...draft, cageId: ids.cages.CB })
    // Other companies and other sites see nothing.
    expect((await asOutsider.query(api.grading.view, { cageId: ids.cages.C1, asOf: '2026-11-21' })).source).toBeNull()
    expect(await asOutsider.query(api.grading.drafts, {})).toEqual([])
    expect(await asSiteAdmin.query(api.grading.drafts, {})).toEqual([
      expect.objectContaining({ cage_id: ids.cages.C1 }),
    ])
    expect((await asSiteAdmin.query(api.grading.view, { cageId: ids.cages.CB, asOf: '2026-11-21' })).draft).toBeNull()
    await expect(asSiteAdmin.mutation(api.grading.discardDraft, { cageId: ids.cages.CB })).rejects.toThrow(
      /access to this site/,
    )
    await asOutsider.mutation(api.grading.discardDraft, { cageId: ids.cages.C1 })
    expect(await t.run((ctx) => ctx.db.query('gradingDrafts').collect())).toHaveLength(2)
  })

  test('validates bounds', async () => {
    const { as, ids } = await setup()
    const base = { cageId: ids.cages.C1, date: '2026-11-21' }
    const many = Array.from({ length: 21 }, () => ({ samples: [] }))
    await expect(as.mutation(api.grading.saveDraft, { ...base, classes: many })).rejects.toThrow(/At most 20 classes/)
    await expect(
      as.mutation(api.grading.saveDraft, { ...base, classes: [{ samples: Array.from({ length: 11 }, () => [1]) }] }),
    ).rejects.toThrow(/weighing rounds/)
    await expect(
      as.mutation(api.grading.saveDraft, { ...base, classes: [{ samples: [Array.from({ length: 201 }, () => 1)] }] }),
    ).rejects.toThrow(/fish per weighing round/)
    await expect(as.mutation(api.grading.saveDraft, { ...base, date: '2026-13-01', classes: [] })).rejects.toThrow(
      /grading date/,
    )
    await expect(as.mutation(api.grading.saveDraft, { ...base, culls: 1.5, classes: [] })).rejects.toThrow(/Culls/)
  })
})

describe('confirming a grading', () => {
  test('records the size spread from the samples, clears the draft and lists it as recent', async () => {
    const { as, asOutsider, asSiteAdmin, ids, stock } = await setup()
    await stock(ids.cages.C1, 4000, '2026-08-01')
    await as.mutation(api.grading.saveDraft, { cageId: ids.cages.C1, date: '2026-11-21', classes: [] })
    await as.mutation(api.batches.grade, {
      cageId: ids.cages.C1,
      date: '2026-11-21',
      graderBars: '18 / 24 mm',
      outputs: [
        { cageId: ids.cages.C1, quantity: 1000, abw: 300, samples: LARGE },
        { cageId: ids.cages.C2, quantity: 2950, abw: 120, samples: SMALL },
      ],
      culls: 50,
    })
    expect(await as.query(api.grading.drafts, {})).toEqual([])

    const cv = gradingCv([
      { count: 1000, stats: sampleStats(LARGE) },
      { count: 2950, stats: sampleStats(SMALL) },
    ])!
    const recent = await as.query(api.grading.recent, {})
    expect(recent).toHaveLength(1)
    expect(recent[0]).toMatchObject({
      date: '2026-11-21',
      source_name: 'C1',
      destinations: ['C1', 'C2'],
      fish: 3950,
      classes: 2,
      cv_before_pct: Math.round(cv.beforePct * 10) / 10,
      cv_after_pct: Math.round(cv.afterPct * 10) / 10,
    })
    expect(recent[0].batch_id).toBeTruthy()
    expect(await asOutsider.query(api.grading.recent, {})).toEqual([])
    // The grading's site (A) is in this member's scope.
    expect(await asSiteAdmin.query(api.grading.recent, {})).toHaveLength(1)

    // Without samples the spread is unknown, not made up.
    await as.mutation(api.batches.grade, {
      cageId: ids.cages.C2,
      date: '2026-11-22',
      outputs: [{ cageId: ids.cages.C2, quantity: 2950, abw: 125 }],
    })
    const [latest] = await as.query(api.grading.recent, {})
    expect(latest).toMatchObject({ source_name: 'C2', cv_before_pct: null, cv_after_pct: null, classes: 1 })
  })
})
