/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { defaultLayout, fieldShown, hiddenRefs, layoutProblems, resolveLayout } from './lib/formLayouts'

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
    await ctx.db.insert('customFieldDefs', {
      companyId, entity: 'biweeklyRecords', key: 'net_change', label: 'Net changed', type: 'boolean',
      required: false, sortOrder: 0, archived: false, updatedBy: admin, updatedAt: now,
    })
    await ctx.db.insert('customFieldDefs', {
      companyId, entity: 'biweeklyRecords', key: 'net_reason', label: 'Why', type: 'text',
      required: false, sortOrder: 1, archived: false, updatedBy: admin, updatedAt: now,
    })
    return { companyId, other, admin, viewer, outsider }
  })
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` })
  return { t, as, ...ids }
}

const defs = [
  { key: 'net_change', required: false, archived: false },
  { key: 'net_reason', required: false, archived: false },
  { key: 'old', required: false, archived: true },
  { key: 'must', required: true, archived: false },
]

describe('form layout rules (CUSTOM-004)', () => {
  test('resolve places every core and active custom field exactly once', () => {
    const saved = [
      { key: 'top', title: 'Top', fields: [{ ref: 'custom:net_reason' }, { ref: 'core:date' }, { ref: 'custom:old' }, { ref: 'core:bogus' }] },
    ]
    const out = resolveLayout('production.sampling', saved, defs)
    const refs = out.flatMap((s) => s.fields.map((f) => f.ref))
    expect(refs[0]).toBe('custom:net_reason')
    expect(new Set(refs).size).toBe(refs.length)
    expect(refs).toContain('core:samples')
    expect(refs).toContain('custom:net_change')
    expect(refs).toContain('custom:must')
    expect(refs).not.toContain('custom:old')
    expect(refs).not.toContain('core:bogus')
    // No saved layout = the catalog default plus custom fields at the end.
    const def = resolveLayout('production.sampling', null, defs)
    expect(def.map((s) => s.key)).toEqual(defaultLayout('production.sampling').map((s) => s.key))
  })

  test('validation refuses unknown, duplicate and invalid conditional fields', () => {
    const base = defaultLayout('production.sampling')
    expect(layoutProblems('production.sampling', base, defs)).toEqual([])
    expect(layoutProblems('nope', base, defs)).toEqual(['Unknown form'])
    const dup = [{ key: 'a', fields: [{ ref: 'core:date' }, { ref: 'core:date' }] }]
    expect(layoutProblems('production.sampling', dup, defs).join()).toMatch(/twice/)
    const requiredCond = [{ key: 'a', fields: [{ ref: 'core:date', showWhen: { ref: 'custom:net_change', op: 'is_set' as const } }, { ref: 'custom:net_change' }] }]
    expect(layoutProblems('production.sampling', requiredCond, defs).join()).toMatch(/required/)
    const chained = [{ key: 'a', fields: [
      { ref: 'custom:net_change', showWhen: { ref: 'core:batchCode', op: 'is_set' as const } },
      { ref: 'custom:net_reason', showWhen: { ref: 'custom:net_change', op: 'eq' as const, value: true } },
    ] }]
    expect(layoutProblems('production.sampling', chained, defs).join()).toMatch(/conditional itself/)
    const self = [{ key: 'a', fields: [{ ref: 'custom:net_reason', showWhen: { ref: 'custom:net_reason', op: 'is_set' as const } }] }]
    expect(layoutProblems('production.sampling', self, defs).join()).toMatch(/itself/)
  })

  test('conditions show a field only while the controlling value matches', () => {
    const f = { ref: 'custom:net_reason', showWhen: { ref: 'custom:net_change', op: 'eq' as const, value: true } }
    expect(fieldShown(f, {})).toBe(false)
    expect(fieldShown(f, { 'custom:net_change': true })).toBe(true)
    expect(fieldShown({ ref: 'x', showWhen: { ref: 'y', op: 'is_set' } }, { y: '' })).toBe(false)
    expect(fieldShown({ ref: 'x', showWhen: { ref: 'y', op: 'neq', value: 'a' } }, { y: 'b' })).toBe(true)
    expect(hiddenRefs([{ key: 's', fields: [f] }], {})).toEqual(['custom:net_reason'])
  })
})

describe('form layout functions', () => {
  test('admins save and reset their own company layout; others cannot see or write it', async () => {
    const { as, admin, viewer, outsider } = await setup()
    expect(await as(admin).query(api.formLayouts.get, { formKey: 'production.sampling' })).toBeNull()
    const sections = [
      { key: 'net', title: '  Net  ', fields: [
        { ref: 'custom:net_change' },
        { ref: 'custom:net_reason', width: 'full' as const, showWhen: { ref: 'custom:net_change', op: 'eq' as const, value: true } },
      ] },
      ...defaultLayout('production.sampling'),
    ]
    await as(admin).mutation(api.formLayouts.save, { formKey: 'production.sampling', sections })
    const got = await as(viewer).query(api.formLayouts.get, { formKey: 'production.sampling' })
    expect(got?.sections[0].title).toBe('Net')
    expect(got?.sections[0].fields[1].showWhen?.ref).toBe('custom:net_change')

    // Wrong company: the outsider sees nothing, and their custom field keys do not exist there.
    expect(await as(outsider).query(api.formLayouts.get, { formKey: 'production.sampling' })).toBeNull()
    await expect(as(outsider).mutation(api.formLayouts.save, { formKey: 'production.sampling', sections })).rejects.toThrow(/Unknown field/)

    await expect(as(viewer).mutation(api.formLayouts.save, { formKey: 'production.sampling', sections })).rejects.toThrow(/FORBIDDEN|Insufficient/)
    await expect(as(viewer).mutation(api.formLayouts.reset, { formKey: 'production.sampling' })).rejects.toThrow(/FORBIDDEN|Insufficient/)
    await expect(
      as(admin).mutation(api.formLayouts.save, { formKey: 'production.sampling', sections: [{ key: 'a', fields: [{ ref: 'core:nope' }] }] }),
    ).rejects.toThrow(/Unknown field/)

    expect((await as(admin).query(api.formLayouts.listSaved, {})).map((r: any) => r.formKey)).toEqual(['production.sampling'])
    await as(outsider).mutation(api.formLayouts.reset, { formKey: 'production.sampling' })
    expect(await as(admin).query(api.formLayouts.get, { formKey: 'production.sampling' })).not.toBeNull()
    await as(admin).mutation(api.formLayouts.reset, { formKey: 'production.sampling' })
    expect(await as(admin).query(api.formLayouts.get, { formKey: 'production.sampling' })).toBeNull()
  })
})
