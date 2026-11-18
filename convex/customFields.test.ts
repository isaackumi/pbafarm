/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { checkValues, patternProblem, visibleDefs, type FieldDef } from './lib/customFieldRules'

const modules = import.meta.glob('./**/*.ts')

const def = (over: Partial<FieldDef>): FieldDef => ({
  key: 'f',
  label: 'F',
  type: 'text',
  required: false,
  sortOrder: 10,
  archived: false,
  ...over,
})

describe('custom field rules (pure)', () => {
  test('each type validates and coerces', () => {
    const defs = [
      def({ key: 'n', label: 'Mesh', type: 'number', validation: { min: 5, max: 50 } }),
      def({ key: 'i', label: 'Nets', type: 'number', validation: { integer: true } }),
      def({ key: 'd', label: 'Checked on', type: 'date' }),
      def({ key: 'b', label: 'Netted', type: 'boolean' }),
      def({ key: 's', label: 'Colour', type: 'select', options: [{ value: 'red', label: 'Red' }, { value: 'old', label: 'Old', archived: true }] }),
      def({ key: 'm', label: 'Tags', type: 'multiselect', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }),
      def({ key: 't', label: 'Code', type: 'text', validation: { pattern: '[A-Z]{2}\\d+' } }),
    ]
    const ok = checkValues(defs, { n: '12', i: 3, d: '2026-02-28', b: 'yes', s: 'red', m: 'a;b;a', t: 'AB12' }, { mode: 'create' })
    expect(ok.errors).toEqual([])
    expect(ok.values).toEqual({ n: 12, i: 3, d: '2026-02-28', b: true, s: 'red', m: ['a', 'b'], t: 'AB12' })

    const bad = checkValues(defs, { n: 2, i: 1.5, d: '2026-02-30', b: 'maybe', s: 'old', m: ['z'], t: 'ab12', x: 1 }, { mode: 'create' })
    expect(bad.errors.map((e) => `${e.key} ${e.message}`).sort()).toEqual([
      'b must be yes or no',
      'd must be a real date',
      'i must be a whole number',
      'm has an unknown choice "z"',
      'n must be at least 5',
      's must be one of the choices',
      't is not in the expected format',
      'x is not a field of this record',
    ])
    // An archived choice stays valid on a record that already holds it.
    expect(checkValues(defs, { s: 'old' }, { mode: 'update', previous: { s: 'old' } }).errors).toEqual([])
  })

  test('required, defaults, show-when conditions and site scope', () => {
    const defs = [
      def({ key: 'cond', label: 'Condition', type: 'select', options: [{ value: 'ok', label: 'OK' }, { value: 'torn', label: 'Torn' }], defaultValue: 'ok' }),
      def({ key: 'tear', label: 'Tear size', type: 'number', required: true, conditions: [{ field: 'custom:cond', op: 'eq', value: 'torn' }] }),
      def({ key: 'deep', label: 'Depth note', required: true, conditions: [{ field: 'core:unitType', op: 'eq', value: 'pond' }] }),
      def({ key: 'site', label: 'Site only', required: true, locationIds: ['s1'] }),
    ]
    // Default fills 'cond'; 'tear' hidden; 'deep' hidden for a cage; 'site' out of scope.
    expect(checkValues(defs, {}, { mode: 'create', context: { core: { unitType: 'cage' }, locationId: 's2' } })).toEqual({
      values: { cond: 'ok' },
      errors: [],
    })
    const torn = checkValues(defs, { cond: 'torn', tear: 4 }, { mode: 'create', context: { locationId: 's1', core: { unitType: 'pond' } } })
    expect(torn.errors.map((e) => e.key).sort()).toEqual(['deep', 'site'])
    // A hidden field's value is dropped, never stored.
    expect(checkValues(defs, { cond: 'ok', tear: 4 }, { mode: 'create' }).values).toEqual({ cond: 'ok' })
    expect(visibleDefs(defs, { cond: 'torn' }, { locationId: 's1' }).map((d) => d.key)).toEqual(['cond', 'tear', 'site'])
  })

  test('archived fields keep old values and refuse new ones', () => {
    const defs = [def({ key: 'old', label: 'Old', archived: true, required: true })]
    expect(checkValues(defs, { other: 1 }, { mode: 'update', previous: { old: 'x', other: 1 } })).toEqual({
      values: { old: 'x', other: 1 },
      errors: [],
    })
    expect(checkValues(defs, { old: 'y' }, { mode: 'update', previous: { old: 'x' } }).errors[0].message).toMatch(/archived/)
  })

  test('patterns that could backtrack are refused', () => {
    expect(patternProblem('(a+)+$')).toMatch(/Nested/)
    expect(patternProblem('(\\w*)*')).toMatch(/Nested/)
    expect(patternProblem('(a)\\1')).toMatch(/Back-references/)
    expect(patternProblem('[')).toMatch(/valid/)
    expect(patternProblem('[A-Z]{2}\\d{3}')).toBeNull()
  })
})

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now } as any)
    const otherCompanyId = await ctx.db.insert('companies', { name: 'Other', code: 'OTH', status: 'approved', createdAt: now } as any)
    const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'Site A', active: true, updatedAt: now })
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId, activeLocationId: siteA })
    const staffId = await ctx.db.insert('users', { email: 's@x.com', role: 'user', companyId, activeLocationId: siteA })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherCompanyId })
    const cage = await ctx.db.insert('cages', {
      name: 'C1', status: 'active', currentCount: 1000, initialCount: 1000, companyId, locationId: siteA, updatedAt: now,
    })
    const batch = await ctx.db.insert('batches', {
      companyId, batchNumber: 'B-1', origin: 'stocking', status: 'active', openedOn: '2026-01-01', homeLocationId: siteA, updatedAt: now,
    } as any)
    return { companyId, siteA, adminId, staffId, outsiderId, cage, batch }
  })
  return {
    t,
    admin: t.withIdentity({ subject: `${ids.adminId}|s` }),
    staff: t.withIdentity({ subject: `${ids.staffId}|s` }),
    outsider: t.withIdentity({ subject: `${ids.outsiderId}|s` }),
    ...ids,
  }
}

const meshField = {
  entity: 'cages' as const,
  key: 'net_mesh_mm',
  label: 'Net mesh size',
  type: 'number' as const,
  unit: 'mm',
  required: true,
  validation: { min: 4, max: 60 },
}

describe('custom field definitions', () => {
  test('only customization.manage defines fields; keys, choices and patterns are checked', async () => {
    const { admin, staff } = await setup()
    await expect(staff.mutation(api.customFields.save, meshField)).rejects.toThrow(/Insufficient permissions/)
    await admin.mutation(api.customFields.save, meshField)
    await expect(admin.mutation(api.customFields.save, meshField)).rejects.toThrow(/already exists/)
    await expect(admin.mutation(api.customFields.save, { ...meshField, key: 'Bad Key' })).rejects.toThrow(/Keys start/)
    await expect(
      admin.mutation(api.customFields.save, { entity: 'cages', key: 'c', label: 'C', type: 'select', required: false, options: [] }),
    ).rejects.toThrow(/at least one choice/)
    await expect(
      admin.mutation(api.customFields.save, { entity: 'cages', key: 't', label: 'T', type: 'text', required: false, validation: { pattern: '(a+)+' } }),
    ).rejects.toThrow(/Nested/)
    await expect(
      admin.mutation(api.customFields.save, {
        entity: 'cages', key: 'x', label: 'X', type: 'text', required: false,
        conditions: [{ field: 'custom:nope', op: 'eq', value: 'a' }],
      }),
    ).rejects.toThrow(/unknown field/)
    // Staff can read definitions (forms render them).
    expect((await staff.query(api.customFields.defs, { entity: 'cages' })).map((d) => d.key)).toEqual(['net_mesh_mm'])
  })

  test('key and type are fixed once created', async () => {
    const { admin } = await setup()
    const id = await admin.mutation(api.customFields.save, meshField)
    await admin.mutation(api.customFields.save, { ...meshField, id, label: 'Mesh (mm)' })
    await expect(admin.mutation(api.customFields.save, { ...meshField, id, type: 'text', validation: undefined })).rejects.toThrow(/cannot change/)
  })
})

describe('custom values on records', () => {
  test('acceptance: a required "Net mesh size" on cages is enforced server-side', async () => {
    const { admin, t } = await setup()
    await admin.mutation(api.customFields.save, meshField)
    await expect(admin.mutation(api.cages.create, { name: 'C2' })).rejects.toThrow(/Net mesh size is required/)
    await expect(admin.mutation(api.cages.create, { name: 'C2', custom: { net_mesh_mm: 2 } })).rejects.toThrow(/at least 4/)
    const id = await admin.mutation(api.cages.create, { name: 'C2', custom: { net_mesh_mm: '18' } })
    expect((await t.run((ctx) => ctx.db.get(id)))?.custom).toEqual({ net_mesh_mm: 18 })
    // An update without `custom` leaves values alone; with it, they are merged and checked.
    await admin.mutation(api.cages.update, { id, patch: { notes: 'x' } })
    expect((await t.run((ctx) => ctx.db.get(id)))?.custom).toEqual({ net_mesh_mm: 18 })
    await expect(admin.mutation(api.cages.update, { id, patch: { custom: { net_mesh_mm: null } } })).rejects.toThrow(/required/)
    await expect(admin.mutation(api.cages.update, { id, patch: { custom: { colour: 'red' } } })).rejects.toThrow(/not a field/)
  })

  test('daily batch lines carry custom values; defaults apply; the record list returns them', async () => {
    const { admin, staff, cage, t, companyId } = await setup()
    await admin.mutation(api.customFields.save, {
      entity: 'dailyRecords', key: 'feeding_response', label: 'Feeding response', type: 'select', required: false,
      options: [{ value: 'good', label: 'Good' }, { value: 'poor', label: 'Poor' }], defaultValue: 'good',
    })
    await admin.mutation(api.customFields.save, {
      entity: 'dailyRecords', key: 'poor_reason', label: 'Why poor', type: 'text', required: true,
      conditions: [{ field: 'custom:feeding_response', op: 'eq', value: 'poor' }],
    })
    await expect(
      staff.mutation(api.dailyRecords.createBatch, {
        date: '2026-01-02', records: [{ cageId: cage, feedAmount: 0, mortality: 0, custom: { feeding_response: 'poor' } }],
      }),
    ).rejects.toThrow(/Why poor is required/)
    const [id] = await staff.mutation(api.dailyRecords.createBatch, {
      date: '2026-01-02', records: [{ cageId: cage, feedAmount: 0, mortality: 0 }],
    })
    const row = await t.run((ctx) => ctx.db.get(id))
    expect(row?.custom).toEqual({ feeding_response: 'good' })
    expect((await staff.query(api.dailyRecords.get, { id }))?.custom).toEqual({ feeding_response: 'good' })
    void companyId
  })

  test('archiving a field keeps old values readable and blocks new ones; required no longer applies', async () => {
    const { admin, t } = await setup()
    const defId = await admin.mutation(api.customFields.save, meshField)
    const id = await admin.mutation(api.cages.create, { name: 'C2', custom: { net_mesh_mm: 10 } })
    await admin.mutation(api.customFields.setArchived, { id: defId, archived: true })
    await admin.mutation(api.cages.create, { name: 'C3' })
    await admin.mutation(api.cages.update, { id, patch: { custom: { net_mesh_mm: 10 } } })
    await expect(admin.mutation(api.cages.update, { id, patch: { custom: { net_mesh_mm: 12 } } })).rejects.toThrow(/archived/)
    expect((await t.run((ctx) => ctx.db.get(id)))?.custom).toEqual({ net_mesh_mm: 10 })
    expect(await admin.query(api.customFields.defs, { entity: 'cages' })).toEqual([])
    expect((await admin.query(api.customFields.defs, { entity: 'cages', includeArchived: true })).length).toBe(1)
  })

  test('setValues: per-entity permission, tenancy, and validation (batches have no other write path)', async () => {
    const { admin, staff, outsider, batch, t } = await setup()
    await admin.mutation(api.customFields.save, {
      entity: 'batches', key: 'strain', label: 'Strain', type: 'text', required: false,
    })
    await admin.mutation(api.customFields.setValues, { entity: 'batches', id: batch, custom: { strain: 'GIFT' } })
    expect((await t.run((ctx) => ctx.db.get(batch)))?.custom).toEqual({ strain: 'GIFT' })
    // Managers hold production.units.manage; outsiders never see the record.
    await staff.mutation(api.customFields.setValues, { entity: 'batches', id: batch, custom: { strain: 'Akosombo' } })
    await expect(
      outsider.mutation(api.customFields.setValues, { entity: 'batches', id: batch, custom: { strain: 'x' } }),
    ).rejects.toThrow(/not found/)
    await expect(
      admin.mutation(api.customFields.setValues, { entity: 'expenses', id: batch, custom: {} }),
    ).rejects.toThrow(/not found/)
  })

  test('photo fields accept only a file uploaded for that field by this organization', async () => {
    const { admin, t, companyId, adminId } = await setup()
    const defId = await admin.mutation(api.customFields.save, {
      entity: 'cages', key: 'net_photo', label: 'Net photo', type: 'photo', required: false,
    })
    const [mine, foreign] = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(['x']))
      const base = { companyId, provider: 'convex' as const, storageId, name: 'n.jpg', mime: 'image/jpeg', size: 1, uploadedBy: adminId, createdAt: Date.now() }
      return [
        await ctx.db.insert('files', { ...base, entityType: 'customFieldDefs', entityId: defId }),
        await ctx.db.insert('files', { ...base, entityType: 'customFieldDefs', entityId: 'other' }),
      ]
    })
    await admin.mutation(api.cages.create, { name: 'P1', custom: { net_photo: mine } })
    await expect(admin.mutation(api.cages.create, { name: 'P2', custom: { net_photo: foreign } })).rejects.toThrow(/photo uploaded/)
  })
})
