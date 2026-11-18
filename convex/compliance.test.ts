/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { isoWeek, periodOf } from './lib/compliance'

const modules = import.meta.glob('./**/*.ts')

/** Biosecurity log, compliance checklists and the document register (TRACE-005, TRACE-006). */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', { name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: Date.now() })
    const otherCompanyId = await ctx.db.insert('companies', { name: 'Other', code: 'OTH', status: 'approved', createdAt: Date.now() })
    const siteId = await ctx.db.insert('farmLocations', { companyId, name: 'Kpeve', active: true, updatedAt: Date.now() })
    const otherSiteId = await ctx.db.insert('farmLocations', { companyId: otherCompanyId, name: 'Elsewhere', active: true, updatedAt: Date.now() })
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCompanyId })
    const cageId = await ctx.db.insert('cages', { name: 'C1', status: 'active', currentCount: 100, companyId, locationId: siteId, updatedAt: Date.now() })
    const treatmentId = await ctx.db.insert('healthTreatments', {
      cageId,
      date: '2026-11-01',
      treatment: 'Salt bath',
      companyId,
      locationId: siteId,
      updatedAt: Date.now(),
    })
    return { companyId, siteId, otherSiteId, adminId, staffId, outsiderId, treatmentId }
  })
  return {
    t,
    ids,
    as: t.withIdentity({ subject: `${ids.adminId}|s` }),
    asStaff: t.withIdentity({ subject: `${ids.staffId}|s` }),
    asOutsider: t.withIdentity({ subject: `${ids.outsiderId}|s` }),
  }
}

async function errorOf(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    const raw = (e as { data?: unknown }).data
    const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { code?: string; message: string } | undefined
    return data ?? { message: String((e as Error).message) }
  }
  throw new Error('expected a rejection')
}

describe('periods', () => {
  test('daily, ISO week and month', () => {
    expect(periodOf('daily', '2026-11-18')).toBe('2026-11-18')
    expect(isoWeek('2026-11-18')).toBe('2026-W47')
    expect(isoWeek('2027-01-01')).toBe('2026-W53')
    expect(isoWeek('2026-01-01')).toBe('2026-W01')
    expect(periodOf('monthly', '2026-11-18')).toBe('2026-11')
  })
})

describe('biosecurity log', () => {
  test('staff log visitors per site; other companies see nothing and cannot write to the site', async () => {
    const { as, asStaff, asOutsider, ids } = await setup()
    await asStaff.mutation(api.compliance.logBiosecurity, {
      locationId: ids.siteId,
      date: '2026-11-18',
      kind: 'visitor',
      person: 'Ama Mensah',
      organisation: 'Fisheries Commission',
      entryControlsDone: true,
    })
    expect(
      await errorOf(asStaff.mutation(api.compliance.logBiosecurity, { locationId: ids.siteId, date: '2026-11-18', kind: 'vehicle' })),
    ).toMatchObject({ code: 'VALIDATION' })
    await expect(
      asOutsider.mutation(api.compliance.logBiosecurity, { locationId: ids.siteId, date: '2026-11-18', kind: 'other' }),
    ).rejects.toThrow(/not found/)
    const rows = await as.query(api.compliance.listBiosecurity, { locationId: ids.siteId })
    expect(rows).toEqual([expect.objectContaining({ person: 'Ama Mensah', site_name: 'Kpeve', entry_controls_done: true })])
    expect(await asOutsider.query(api.compliance.listBiosecurity, {})).toEqual([])
    await expect(asStaff.mutation(api.compliance.removeBiosecurity, { id: rows[0].id })).rejects.toThrow(/permission/i)
  })
})

describe('compliance checklists', () => {
  test('seeding is idempotent; a checklist is done once per period and site', async () => {
    const { as, asStaff, asOutsider, ids } = await setup()
    await expect(asStaff.mutation(api.compliance.seedDefaultTemplates, {})).rejects.toThrow(/permission/i)
    expect((await as.mutation(api.compliance.seedDefaultTemplates, {})).added).toHaveLength(3)
    expect((await as.mutation(api.compliance.seedDefaultTemplates, {})).added).toHaveLength(0)

    const due = await asStaff.query(api.compliance.due, { locationId: ids.siteId, today: '2026-11-18' })
    expect(due.map((d) => [d.template.frequency, d.period, d.done])).toEqual([
      ['daily', '2026-11-18', null],
      ['weekly', '2026-W47', null],
      ['monthly', '2026-11', null],
    ])

    const weekly = due[1].template
    const answers = weekly.items.map((i, n) => ({ itemId: i.id, ok: n !== 0, note: n === 0 ? 'Hole in C3 net' : undefined }))
    const res = await asStaff.mutation(api.compliance.complete, {
      templateId: weekly.id,
      locationId: ids.siteId,
      date: '2026-11-16',
      answers,
    })
    expect(res).toMatchObject({ period: '2026-W47', passed: false })
    expect(
      await errorOf(
        asStaff.mutation(api.compliance.complete, { templateId: weekly.id, locationId: ids.siteId, date: '2026-11-20', answers }),
      ),
    ).toMatchObject({ code: 'DUPLICATE' })
    expect(
      await errorOf(
        asStaff.mutation(api.compliance.complete, {
          templateId: due[0].template.id,
          locationId: ids.siteId,
          date: '2026-11-18',
          answers: answers.slice(0, 1),
        }),
      ),
    ).toMatchObject({ code: 'VALIDATION' })

    const after = await asStaff.query(api.compliance.due, { locationId: ids.siteId, today: '2026-11-18' })
    expect(after[1].done).toMatchObject({ completed_on: '2026-11-16', passed: false })
    const records = await as.query(api.compliance.listRecords, {})
    expect(records[0]).toMatchObject({ template_name: 'Weekly net inspection', site_name: 'Kpeve' })
    expect(records[0].answers[0]).toMatchObject({ ok: false, note: 'Hole in C3 net' })

    expect(await asOutsider.query(api.compliance.due, { locationId: ids.siteId, today: '2026-11-18' })).toEqual([])
    expect(await asOutsider.query(api.compliance.listRecords, {})).toEqual([])
    await expect(
      asOutsider.mutation(api.compliance.complete, { templateId: weekly.id, locationId: ids.otherSiteId, date: '2026-11-18', answers }),
    ).rejects.toThrow(/not found/)
  })

  test('switched-off templates are not due; admins can add their own', async () => {
    const { as, ids } = await setup()
    const id = await as.mutation(api.compliance.createTemplate, {
      name: 'Feed store check',
      frequency: 'weekly',
      items: ['Bags off the floor', ' ', 'No rodents'],
    })
    const [tpl] = await as.query(api.compliance.listTemplates, {})
    expect(tpl.items).toHaveLength(2)
    await as.mutation(api.compliance.setTemplateActive, { id, active: false })
    expect(await as.query(api.compliance.due, { locationId: ids.siteId, today: '2026-11-18' })).toEqual([])
  })

  test('the migration seeds every approved company once', async () => {
    const { t } = await setup()
    expect(await t.mutation(internal.migrations.seedComplianceTemplates, {})).toMatchObject({ dryRun: true, count: 2 })
    expect(await t.run((c) => c.db.query('complianceTemplates').collect())).toHaveLength(0)
    await t.mutation(internal.migrations.seedComplianceTemplates, { dryRun: false })
    expect(await t.run((c) => c.db.query('complianceTemplates').collect())).toHaveLength(6)
    expect(await t.mutation(internal.migrations.seedComplianceTemplates, { dryRun: false })).toMatchObject({ count: 0 })
  })
})

describe('document register', () => {
  const upload = (t: Awaited<ReturnType<typeof setup>>['t'], type: string, bytes = 1000) =>
    t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)], { type })))

  test('attach, list, download with a short-lived token, and remove — only for the owning company', async () => {
    const { t, as, asStaff, asOutsider, ids } = await setup()
    const ref = { entityType: 'healthTreatments' as const, entityId: ids.treatmentId }

    expect(typeof (await asStaff.mutation(api.files.generateUploadUrl, ref))).toBe('string')
    await expect(asOutsider.mutation(api.files.generateUploadUrl, ref)).rejects.toThrow(/not found/)

    const storageId = await upload(t, 'application/pdf')
    const attached = await asStaff.mutation(api.files.attach, { ...ref, storageId, name: 'Vet report.pdf' })
    if (!attached.ok) throw new Error(attached.message)
    const fileId = attached.id
    // The same stored file cannot be attached twice (or to another record).
    expect(await errorOf(asStaff.mutation(api.files.attach, { ...ref, storageId, name: 'again.pdf' }))).toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(await as.query(api.files.list, ref)).toEqual([
      expect.objectContaining({ name: 'Vet report.pdf', mime: 'application/pdf', size: 1000 }),
    ])
    expect(await asOutsider.query(api.files.list, ref)).toEqual([])

    await expect(asOutsider.mutation(api.files.requestDownload, { fileId })).rejects.toThrow(/not found/i)
    const { path } = await asStaff.mutation(api.files.requestDownload, { fileId })
    const res = await t.fetch(path, { method: 'GET' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toContain('Vet report.pdf')
    expect((await res.arrayBuffer()).byteLength).toBe(1000)
    expect((await t.fetch('/files/download?token=' + 'a'.repeat(64), { method: 'GET' })).status).toBe(404)

    // Tokens expire.
    await t.run(async (ctx) => {
      for (const g of await ctx.db.query('fileDownloadTokens').collect()) await ctx.db.patch(g._id, { expiresAt: Date.now() - 1 })
    })
    expect((await t.fetch(path, { method: 'GET' })).status).toBe(404)
    expect(await t.mutation(internal.files.pruneDownloadTokens, {})).toMatchObject({ deleted: 1 })

    await expect(asOutsider.mutation(api.files.remove, { fileId })).rejects.toThrow(/not found/)
    await as.mutation(api.files.remove, { fileId })
    expect(await as.query(api.files.list, ref)).toEqual([])
  })

  test('refuses disallowed types and oversized files, and deletes them', async () => {
    const { t, asStaff, ids } = await setup()
    const ref = { entityType: 'healthTreatments' as const, entityId: ids.treatmentId }
    const exe = await upload(t, 'application/x-msdownload')
    expect(await asStaff.mutation(api.files.attach, { ...ref, storageId: exe, name: 'x.exe' })).toMatchObject({
      ok: false,
      code: 'VALIDATION',
    })
    expect(await t.run((ctx) => ctx.db.system.get(exe))).toBeNull()
    const big = await upload(t, 'image/png', 10 * 1024 * 1024 + 1)
    expect(await asStaff.mutation(api.files.attach, { ...ref, storageId: big, name: 'big.png' })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/10 MB/),
    })
    expect(await t.run((ctx) => ctx.db.system.get(big))).toBeNull()
    // An unknown record id is refused before anything is uploaded.
    await expect(
      asStaff.mutation(api.files.generateUploadUrl, { entityType: 'harvestLots', entityId: 'nope' }),
    ).rejects.toThrow(/not found/)
  })
})
