/**
 * Custom field definitions and values (D-007, CUSTOM-001, CUSTOM-002).
 *
 * Organizations define extra fields per entity under Settings → Customization;
 * forms render them with components/CustomFields; every entity writer validates
 * `custom` with lib/customFields.validateCustom. Definitions are archived,
 * never deleted, so old values stay readable.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireMember, type Permission } from './lib/permissions'
import { userError } from './lib/errors'
import { logAudit } from './lib/tenancy'
import { forgetDefs, loadDefs, validateCustom } from './lib/customFields'
import {
  CUSTOM_ENTITIES,
  KEY_PATTERN,
  LIMITS,
  coerceValue,
  patternProblem,
  type CustomEntity,
  type FieldDef,
} from './lib/customFieldRules'
import {
  customCondition,
  customEntityValidator,
  customFieldType,
  customScalar,
  customValues,
} from './schema'

/** Who may change custom values on an existing record, per entity (same as editing the record). */
export const ENTITY_EDIT_PERMISSION: Record<CustomEntity, Permission> = {
  cages: 'production.units.manage',
  farmLocations: 'org.sites.manage',
  batches: 'production.units.manage',
  dailyRecords: 'production.daily.correct',
  biweeklyRecords: 'production.sampling.correct',
  harvestRecords: 'production.harvest.correct',
  stockingHistory: 'production.stocking.approve',
  expenses: 'finance.expenses.manage',
  equipment: 'org.sites.manage',
}

function defOut(d: Doc<'customFieldDefs'>) {
  return {
    _id: d._id,
    entity: d.entity,
    key: d.key,
    label: d.label,
    helpText: d.helpText,
    type: d.type,
    unit: d.unit,
    options: d.options,
    validation: d.validation,
    required: d.required,
    defaultValue: d.defaultValue,
    conditions: d.conditions,
    locationIds: d.locationIds,
    sortOrder: d.sortOrder,
    archived: d.archived,
  }
}

/** Definitions of one entity, in order. Forms filter out archived ones; displays keep them for old values. */
export const defs = query({
  args: { entity: customEntityValidator, includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, { entity, includeArchived }) => {
    const m = await requireMember(ctx, { permission: 'org.view' })
    if (!m.companyId) return []
    const rows = await loadDefs(ctx, m.companyId, entity)
    return rows
      .filter((d) => includeArchived || !d.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(defOut)
  },
})

/** Definitions of every entity (exports, the field builder overview). */
export const allDefs = query({
  args: {},
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'org.view' })
    if (!m.companyId) return []
    const out = []
    for (const entity of CUSTOM_ENTITIES) {
      out.push(...(await loadDefs(ctx, m.companyId, entity)).map(defOut))
    }
    return out
  },
})

const defFields = {
  label: v.string(),
  helpText: v.optional(v.string()),
  unit: v.optional(v.string()),
  options: v.optional(
    v.array(v.object({ value: v.string(), label: v.string(), archived: v.optional(v.boolean()) })),
  ),
  validation: v.optional(
    v.object({
      min: v.optional(v.number()),
      max: v.optional(v.number()),
      maxLength: v.optional(v.number()),
      pattern: v.optional(v.string()),
      integer: v.optional(v.boolean()),
    }),
  ),
  required: v.boolean(),
  defaultValue: v.optional(customScalar),
  conditions: v.optional(v.array(customCondition)),
  locationIds: v.optional(v.array(v.id('farmLocations'))),
}

function bad(message: string, field?: string): never {
  throw userError('VALIDATION', message, field ? { field } : undefined)
}

/** Check a definition the way it will be stored; throws VALIDATION. */
async function checkDefinition(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  entity: CustomEntity,
  def: FieldDef,
  siblings: Doc<'customFieldDefs'>[],
) {
  if (!KEY_PATTERN.test(def.key)) {
    bad('Keys start with a letter and use lower-case letters, digits and _ (at most 40)', 'key')
  }
  const label = def.label.trim()
  if (!label) bad('Give the field a label', 'label')
  if (label.length > LIMITS.labelLength) bad(`Labels can be at most ${LIMITS.labelLength} characters`, 'label')
  if ((def.helpText ?? '').length > 300) bad('Help text can be at most 300 characters', 'helpText')
  if ((def.unit ?? '').length > 20) bad('Units can be at most 20 characters', 'unit')

  const choice = def.type === 'select' || def.type === 'multiselect'
  if (choice) {
    const opts = def.options ?? []
    if (!opts.filter((o) => !o.archived).length) bad('Add at least one choice', 'options')
    if (opts.length > LIMITS.optionsPerField) bad(`At most ${LIMITS.optionsPerField} choices`, 'options')
    const seen = new Set<string>()
    for (const o of opts) {
      if (!o.value.trim() || !o.label.trim()) bad('Every choice needs a value and a label', 'options')
      if (o.value.length > 60 || o.label.length > 80) bad('Choices are at most 60 (value) / 80 (label) characters', 'options')
      if (seen.has(o.value)) bad(`The choice "${o.value}" appears twice`, 'options')
      seen.add(o.value)
    }
  } else if (def.options?.length) {
    bad('Only choice fields have choices', 'options')
  }

  const val = def.validation ?? {}
  if (val.min !== undefined && val.max !== undefined && val.min > val.max) bad('Minimum is above maximum', 'validation')
  if ((val.min !== undefined || val.max !== undefined || val.integer) && def.type !== 'number') {
    bad('Minimum, maximum and whole-number apply to number fields', 'validation')
  }
  if (val.pattern !== undefined || val.maxLength !== undefined) {
    if (def.type !== 'text' && def.type !== 'long_text') bad('Patterns and lengths apply to text fields', 'validation')
  }
  if (val.pattern) {
    const problem = patternProblem(val.pattern)
    if (problem) bad(problem, 'validation')
  }
  if (val.maxLength !== undefined && !(val.maxLength >= 1 && val.maxLength <= LIMITS.longTextLength)) {
    bad(`Maximum length is between 1 and ${LIMITS.longTextLength}`, 'validation')
  }

  if (def.defaultValue !== undefined) {
    if (def.type === 'photo') bad('Photo fields have no default', 'defaultValue')
    const r = coerceValue(def, def.defaultValue)
    if (!r.ok) bad(`Default value ${r.message}`, 'defaultValue')
  }

  const conditions = def.conditions ?? []
  if (conditions.length > LIMITS.conditionsPerField) bad(`At most ${LIMITS.conditionsPerField} conditions`, 'conditions')
  for (const c of conditions) {
    const [ns, name] = c.field.includes(':') ? c.field.split(':', 2) : ['custom', c.field]
    if (ns === 'custom') {
      if (name === def.key) bad('A field cannot depend on itself', 'conditions')
      if (!siblings.some((s) => s.key === name)) bad(`Condition refers to an unknown field "${name}"`, 'conditions')
    } else if (ns !== 'core' || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name)) {
      bad('Conditions refer to custom:<key> or core:<field>', 'conditions')
    }
    if (!['is_set', 'is_not_set'].includes(c.op) && c.value === undefined) bad('Give the condition a value', 'conditions')
  }

  for (const id of def.locationIds ?? []) {
    const siteId = ctx.db.normalizeId('farmLocations', id)
    const site = siteId ? await ctx.db.get(siteId) : null
    if (!site || site.companyId !== companyId) bad('Site not found', 'locationIds')
  }
  void entity
}

/** Create (no id) or edit a definition. Key and type are fixed once created: archive and add a new field instead. */
export const save = mutation({
  args: {
    id: v.optional(v.id('customFieldDefs')),
    entity: customEntityValidator,
    key: v.string(),
    type: customFieldType,
    ...defFields,
  },
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'customization.manage' })
    const companyId = m.companyId
    if (!companyId) throw userError('FORBIDDEN', 'Choose an organization first')
    const siblings = await loadDefs(ctx, companyId, args.entity)
    const existing = args.id ? await ctx.db.get(args.id) : null
    if (args.id && (!existing || existing.companyId !== companyId)) throw userError('NOT_FOUND', 'Field not found')
    if (existing && (existing.key !== args.key || existing.type !== args.type || existing.entity !== args.entity)) {
      bad('Key, type and record cannot change once a field exists; archive it and add a new one')
    }
    if (!existing && siblings.some((s) => s.key === args.key)) bad(`A field with key "${args.key}" already exists`, 'key')
    if (!existing && siblings.filter((s) => !s.archived).length >= LIMITS.activeDefsPerEntity) {
      bad(`At most ${LIMITS.activeDefsPerEntity} active fields per record type`)
    }
    const def: FieldDef = {
      key: args.key,
      label: args.label.trim(),
      helpText: args.helpText?.trim() || undefined,
      type: args.type,
      unit: args.unit?.trim() || undefined,
      options: args.options?.map((o) => ({ ...o, value: o.value.trim(), label: o.label.trim() })),
      validation: args.validation,
      required: args.required,
      defaultValue: args.defaultValue,
      conditions: args.conditions,
      locationIds: args.locationIds?.length ? args.locationIds : undefined,
      sortOrder: existing?.sortOrder ?? siblings.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 10,
      archived: existing?.archived ?? false,
    }
    await checkDefinition(ctx, companyId, args.entity, def, siblings)
    const row = {
      companyId,
      entity: args.entity,
      key: def.key,
      label: def.label,
      helpText: def.helpText,
      type: def.type,
      unit: def.unit,
      options: def.options,
      validation: def.validation,
      required: def.required,
      defaultValue: def.defaultValue,
      conditions: def.conditions,
      locationIds: args.locationIds?.length ? args.locationIds : undefined,
      sortOrder: def.sortOrder,
      archived: def.archived,
      updatedBy: m.user._id,
      updatedAt: Date.now(),
    }
    let id: Id<'customFieldDefs'>
    if (existing) {
      await ctx.db.replace(existing._id, row)
      id = existing._id
    } else {
      id = await ctx.db.insert('customFieldDefs', row)
    }
    forgetDefs(ctx)
    await logAudit(ctx, {
      actionType: existing ? 'update' : 'create',
      tableName: 'customFieldDefs',
      recordId: id,
      previousValues: existing ?? undefined,
      newValues: { entity: args.entity, key: def.key, label: def.label, type: def.type, required: def.required },
    })
    return id
  },
})

/** Archive (values stay on records, inert) or restore a field. */
export const setArchived = mutation({
  args: { id: v.id('customFieldDefs'), archived: v.boolean() },
  handler: async (ctx, { id, archived }) => {
    const m = await requireMember(ctx, { permission: 'customization.manage' })
    const def = await ctx.db.get(id)
    if (!def || def.companyId !== m.companyId) throw userError('NOT_FOUND', 'Field not found')
    if (!archived && def.archived) {
      const active = (await loadDefs(ctx, def.companyId, def.entity)).filter((d) => !d.archived)
      if (active.length >= LIMITS.activeDefsPerEntity) bad(`At most ${LIMITS.activeDefsPerEntity} active fields per record type`)
    }
    await ctx.db.patch(id, { archived, updatedBy: m.user._id, updatedAt: Date.now() })
    forgetDefs(ctx)
    await logAudit(ctx, {
      actionType: archived ? 'archive' : 'restore',
      tableName: 'customFieldDefs',
      recordId: id,
      newValues: { key: def.key, archived },
    })
    return null
  },
})

/** Put an entity's fields in this order. */
export const reorder = mutation({
  args: { entity: customEntityValidator, ids: v.array(v.id('customFieldDefs')) },
  handler: async (ctx, { entity, ids }) => {
    const m = await requireMember(ctx, { permission: 'customization.manage' })
    if (ids.length > 500) bad('Too many fields')
    for (const [i, id] of ids.entries()) {
      const def = await ctx.db.get(id)
      if (!def || def.companyId !== m.companyId || def.entity !== entity) throw userError('NOT_FOUND', 'Field not found')
      if (def.sortOrder !== (i + 1) * 10) await ctx.db.patch(id, { sortOrder: (i + 1) * 10, updatedAt: Date.now() })
    }
    forgetDefs(ctx)
    return null
  },
})

/** The member, holding the permission that edits records of this entity. */
async function requireEntityEditor(ctx: MutationCtx, entity: CustomEntity) {
  return await requireMember(ctx, { permission: ENTITY_EDIT_PERMISSION[entity] })
}

type Located = {
  companyId?: Id<'companies'>
  locationId?: Id<'farmLocations'>
  homeLocationId?: Id<'farmLocations'>
  custom?: Record<string, unknown>
}

/**
 * Edit the custom values of an existing record from its detail page. Guarded
 * per entity by ENTITY_EDIT_PERMISSION (the permission that edits the record
 * itself) and by the record's site scope.
 */
export const setValues = mutation({
  args: { entity: customEntityValidator, id: v.string(), custom: customValues },
  handler: async (ctx, { entity, id, custom }) => {
    const m = await requireEntityEditor(ctx, entity)
    const docId = ctx.db.normalizeId(entity, id)
    const doc = (docId ? await ctx.db.get(docId) : null) as Located | null
    if (!doc || !m.companyId || doc.companyId !== m.companyId) throw userError('NOT_FOUND', 'Record not found')
    const locationId =
      entity === 'farmLocations' ? (docId as Id<'farmLocations'>) : (doc.locationId ?? doc.homeLocationId)
    if (locationId && m.siteScope !== 'all' && !m.siteScope.has(locationId)) {
      throw userError('FORBIDDEN', 'You do not have access to this site', { reason: 'SITE_FORBIDDEN' })
    }
    const next = await validateCustom(ctx, {
      companyId: m.companyId,
      entity,
      custom,
      previous: doc.custom,
      mode: 'update',
      context: { locationId, core: doc as Record<string, unknown> },
    })
    await ctx.db.patch(docId!, { custom: next } as never)
    await logAudit(ctx, {
      actionType: 'update_custom_fields',
      tableName: entity,
      recordId: id,
      previousValues: { custom: doc.custom ?? null },
      newValues: { custom: next ?? null },
      locationId: locationId ?? undefined,
    })
    return next ?? {}
  },
})
