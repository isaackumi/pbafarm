/**
 * The custom field validator (D-007, CUSTOM-001). Every write path of an
 * entity that accepts `custom` calls `validateCustom` — one helper, no
 * per-module custom-field code. Pure rules live in lib/customFieldRules.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { userError } from './errors'
import {
  checkValues,
  type CustomEntity,
  type CustomValues,
  type FieldDef,
  type RuleContext,
} from './customFieldRules'

export { CUSTOM_ENTITIES, type CustomEntity } from './customFieldRules'

type Ctx = QueryCtx | MutationCtx

// Definitions read once per transaction and entity (a 100-line batch reads them once).
const cache = new WeakMap<object, Map<string, Doc<'customFieldDefs'>[]>>()

/** Every definition (active and archived) of an entity, in display order. */
export async function loadDefs(
  ctx: Ctx,
  companyId: Id<'companies'>,
  entity: CustomEntity,
): Promise<Doc<'customFieldDefs'>[]> {
  let byEntity = cache.get(ctx.db)
  if (!byEntity) {
    byEntity = new Map()
    cache.set(ctx.db, byEntity)
  }
  const k = `${companyId}:${entity}`
  const hit = byEntity.get(k)
  if (hit) return hit
  const rows = await ctx.db
    .query('customFieldDefs')
    .withIndex('by_companyId_and_entity_and_sortOrder', (q) =>
      q.eq('companyId', companyId).eq('entity', entity),
    )
    .take(500)
  byEntity.set(k, rows)
  return rows
}

/** Forget cached definitions (after a definition changes in the same transaction). */
export function forgetDefs(ctx: Ctx) {
  cache.delete(ctx.db)
}

export function toFieldDef(d: Doc<'customFieldDefs'>): FieldDef {
  return {
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

/**
 * Validate the `custom` object of a record being created or updated.
 *
 * - create: `custom` may be undefined; defaults are applied and required
 *   fields enforced (so a required field is required on every create path
 *   that calls this, whatever the client).
 * - update: when `custom` is undefined the stored values are left alone
 *   (returns undefined: do not patch); otherwise the client's values are
 *   merged over `previous` and the whole set is checked.
 *
 * Throws VALIDATION with `details.field` naming the first bad field; the
 * message lists every problem.
 */
export async function validateCustom(
  ctx: Ctx,
  args: {
    companyId: Id<'companies'> | undefined
    entity: CustomEntity
    custom: Record<string, unknown> | undefined
    previous?: Record<string, unknown>
    mode: 'create' | 'update'
    context?: { locationId?: Id<'farmLocations'> | null; core?: Record<string, unknown> }
    /** Prefix for messages, e.g. "Line 3 (C1)". */
    label?: string
  },
): Promise<CustomValues | undefined> {
  if (args.mode === 'update' && args.custom === undefined) return undefined
  if (args.custom !== undefined && (typeof args.custom !== 'object' || args.custom === null || Array.isArray(args.custom))) {
    throw userError('VALIDATION', 'Custom fields must be an object of field values')
  }
  if (!args.companyId) {
    if (args.custom && Object.keys(args.custom).length) {
      throw userError('VALIDATION', 'Custom fields need an organization')
    }
    return undefined
  }
  const defs = await loadDefs(ctx, args.companyId, args.entity)
  if (!defs.length && (!args.custom || !Object.keys(args.custom).length)) {
    return args.mode === 'update' ? (args.previous as CustomValues | undefined) : undefined
  }
  const context: RuleContext = {
    locationId: args.context?.locationId ?? null,
    core: args.context?.core,
  }
  const { values, errors } = checkValues(defs.map(toFieldDef), args.custom, {
    mode: args.mode,
    previous: args.previous,
    context,
  })

  // Photo fields hold a file uploaded for this field by this organization.
  for (const def of defs) {
    const value = values[def.key]
    if (def.type !== 'photo' || typeof value !== 'string' || def.archived) continue
    if (args.previous && args.previous[def.key] === value) continue
    const fileId = ctx.db.normalizeId('files', value)
    const file = fileId ? await ctx.db.get(fileId) : null
    if (
      !file ||
      file.companyId !== args.companyId ||
      file.entityType !== 'customFieldDefs' ||
      file.entityId !== def._id
    ) {
      errors.push({ key: def.key, label: def.label, message: 'must be a photo uploaded for this field' })
      continue
    }
    // The photo belongs to the record's site (PERM-004, files.fileInSiteScope).
    const site = args.context?.locationId
    if (!site) continue
    if (file.locationId && file.locationId !== site) {
      errors.push({ key: def.key, label: def.label, message: 'must be a photo uploaded for this site. Upload it again' })
    } else if (!file.locationId && 'patch' in ctx.db) {
      await (ctx as MutationCtx).db.patch(file._id, { locationId: site })
    }
  }

  if (errors.length) {
    const prefix = args.label ? `${args.label}: ` : ''
    throw userError(
      'VALIDATION',
      prefix + errors.map((e) => `${e.label} ${e.message}`).join('; '),
      { field: errors[0].key, reason: 'CUSTOM_FIELD' },
    )
  }
  return Object.keys(values).length ? values : args.mode === 'update' ? {} : undefined
}
