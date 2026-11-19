/**
 * Form layouts (CUSTOM-004, D-007). An organization arranges the forms listed
 * in lib/formLayouts FORM_CATALOG into sections, orders their core and custom
 * fields, and shows optional fields only when another field has a value.
 * Rendered by components/FormLayout; edited under Settings → Customization →
 * Forms. Without a saved layout every form looks as it does in code.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { requireMember } from './lib/permissions'
import { userError } from './lib/errors'
import { logAudit } from './lib/tenancy'
import { loadDefs } from './lib/customFields'
import type { CustomEntity } from './lib/customFieldRules'
import { FORM_CATALOG, isFormKey, layoutProblems, type LayoutSection } from './lib/formLayouts'
import { formLayoutSection } from './schema'

async function savedRow(ctx: QueryCtx, companyId: Id<'companies'>, formKey: string) {
  return await ctx.db
    .query('formLayouts')
    .withIndex('by_companyId_and_formKey', (q) => q.eq('companyId', companyId).eq('formKey', formKey))
    .unique()
}

function requireFormKey(formKey: string) {
  if (!isFormKey(formKey)) throw userError('VALIDATION', 'Unknown form', { field: 'formKey' })
}

/** The organization's saved layout of a form, or null (the form renders as in code). */
export const get = query({
  args: { formKey: v.string() },
  returns: v.union(
    v.object({
      sections: v.array(
        v.object({
          title: v.optional(v.string()),
          fields: v.array(
            v.object({
              width: v.optional(v.union(v.literal('full'), v.literal('half'))),
              showWhen: v.optional(
                v.object({
                  value: v.optional(v.union(v.boolean(), v.string(), v.number())),
                  op: v.union(v.literal('eq'), v.literal('neq'), v.literal('is_set')),
                  ref: v.string(),
                }),
              ),
              ref: v.string(),
            }),
          ),
          key: v.string(),
        }),
      ),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { formKey }) => {
    const m = await requireMember(ctx, { permission: 'org.view' })
    if (!m.companyId || !isFormKey(formKey)) return null
    const row = await savedRow(ctx, m.companyId, formKey)
    return row ? { sections: row.sections, updatedAt: row.updatedAt } : null
  },
})

/** Which forms have a saved layout (the editor's overview). */
export const listSaved = query({
  args: {},
  returns: v.array(v.object({ formKey: v.string(), updatedAt: v.number() })),
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'customization.manage' })
    if (!m.companyId) return []
    const out: { formKey: string; updatedAt: number }[] = []
    for (const formKey of Object.keys(FORM_CATALOG)) {
      const row = await savedRow(ctx, m.companyId, formKey)
      if (row) out.push({ formKey, updatedAt: row.updatedAt })
    }
    return out
  },
})

/** Save a form's layout. Refuses unknown fields, duplicates and conditions on required fields. */
export const save = mutation({
  args: { formKey: v.string(), sections: v.array(formLayoutSection) },
  returns: v.id('formLayouts'),
  handler: async (ctx, { formKey, sections }) => {
    const m = await requireMember(ctx, { permission: 'customization.manage' })
    const companyId = m.companyId
    if (!companyId) throw userError('FORBIDDEN', 'Choose an organization first')
    requireFormKey(formKey)
    const entity = FORM_CATALOG[formKey].entity as CustomEntity | undefined
    const defs = entity ? await loadDefs(ctx, companyId, entity) : []
    const clean: LayoutSection[] = sections.map((s) => ({
      key: s.key,
      ...(s.title?.trim() ? { title: s.title.trim() } : {}),
      fields: s.fields,
    }))
    const problems = layoutProblems(formKey, clean, defs)
    if (problems.length) throw userError('VALIDATION', problems.join('. '))
    const existing = await savedRow(ctx, companyId, formKey)
    const row = { companyId, formKey, sections: clean, updatedBy: m.user._id, updatedAt: Date.now() }
    let id: Id<'formLayouts'>
    if (existing) {
      await ctx.db.replace(existing._id, row)
      id = existing._id
    } else {
      id = await ctx.db.insert('formLayouts', row)
    }
    await logAudit(ctx, {
      actionType: existing ? 'update' : 'create',
      tableName: 'formLayouts',
      recordId: id,
      previousValues: existing ? { sections: existing.sections } : undefined,
      newValues: { formKey, sections: clean },
    })
    return id
  },
})

/** Back to the form as built (deletes the saved layout). */
export const reset = mutation({
  args: { formKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { formKey }) => {
    const m = await requireMember(ctx, { permission: 'customization.manage' })
    if (!m.companyId) throw userError('FORBIDDEN', 'Choose an organization first')
    requireFormKey(formKey)
    const existing = await savedRow(ctx, m.companyId, formKey)
    if (!existing) return null
    await ctx.db.delete(existing._id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'formLayouts',
      recordId: existing._id,
      previousValues: { formKey, sections: existing.sections },
    })
    return null
  },
})
