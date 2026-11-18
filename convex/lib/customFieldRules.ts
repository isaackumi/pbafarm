/**
 * Custom field rules (D-007, CUSTOM-001): the pure part of the engine, shared
 * by the server validator (lib/customFields.ts) and the browser renderer
 * (components/CustomFields.js). No imports, so the client bundle can use it.
 *
 * One engine for every entity: a definition says what a field is (type,
 * validation, required, default, show-when conditions, site scope); values
 * live on the record in an optional `custom` object keyed by field key.
 */

export const CUSTOM_ENTITIES = [
  'cages',
  'farmLocations',
  'batches',
  'dailyRecords',
  'biweeklyRecords',
  'harvestRecords',
  'stockingHistory',
  'expenses',
  'equipment',
] as const
export type CustomEntity = (typeof CUSTOM_ENTITIES)[number]

export const CUSTOM_ENTITY_LABELS: Record<CustomEntity, string> = {
  cages: 'Units',
  farmLocations: 'Sites',
  batches: 'Batches',
  dailyRecords: 'Daily records',
  biweeklyRecords: 'Sampling records',
  harvestRecords: 'Harvests',
  stockingHistory: 'Stockings',
  expenses: 'Expenses',
  equipment: 'Equipment',
}

export const CUSTOM_FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'select',
  'multiselect',
  'boolean',
  'photo',
] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  date: 'Date',
  select: 'Choice',
  multiselect: 'Multiple choice',
  boolean: 'Yes / no',
  photo: 'Photo',
}

export const CONDITION_OPS = ['eq', 'neq', 'in', 'gt', 'lt', 'is_set', 'is_not_set'] as const
export type ConditionOp = (typeof CONDITION_OPS)[number]

/** Limits that keep configuration bounded (doc 06 §6.2). */
export const LIMITS = {
  activeDefsPerEntity: 50,
  optionsPerField: 100,
  textLength: 200,
  longTextLength: 2000,
  patternLength: 200,
  labelLength: 80,
  conditionsPerField: 5,
} as const

export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

export type CustomValue = string | number | boolean | string[]
export type CustomValues = Record<string, CustomValue>

export type FieldCondition = {
  /** 'custom:<key>' (another custom field) or 'core:<name>' (a built-in field of the form). */
  field: string
  op: ConditionOp
  value?: string | number | boolean | string[]
}

export type FieldDef = {
  key: string
  label: string
  helpText?: string
  type: CustomFieldType
  unit?: string
  options?: Array<{ value: string; label: string; archived?: boolean }>
  validation?: { min?: number; max?: number; maxLength?: number; pattern?: string; integer?: boolean }
  required: boolean
  defaultValue?: CustomValue
  conditions?: FieldCondition[]
  locationIds?: string[]
  sortOrder: number
  archived: boolean
}

export type RuleContext = {
  locationId?: string | null
  /** Built-in values of the record being saved, for 'core:' conditions. */
  core?: Record<string, unknown>
}

export function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  )
}

/** A field applies to a record at this site (locationScope). */
export function inScope(def: Pick<FieldDef, 'locationIds'>, ctx: RuleContext): boolean {
  if (!def.locationIds || def.locationIds.length === 0) return true
  return !!ctx.locationId && def.locationIds.includes(ctx.locationId)
}

function conditionHolds(c: FieldCondition, values: Record<string, unknown>, ctx: RuleContext): boolean {
  const [ns, name] = c.field.includes(':') ? c.field.split(':', 2) : ['custom', c.field]
  const actual = ns === 'core' ? ctx.core?.[name] : values[name]
  switch (c.op) {
    case 'is_set':
      return !isEmpty(actual)
    case 'is_not_set':
      return isEmpty(actual)
    case 'eq':
      if (Array.isArray(actual)) return actual.includes(String(c.value))
      // eslint-disable-next-line eqeqeq
      return actual == c.value || String(actual ?? '') === String(c.value ?? '')
    case 'neq':
      if (Array.isArray(actual)) return !actual.includes(String(c.value))
      return String(actual ?? '') !== String(c.value ?? '')
    case 'in': {
      const set = Array.isArray(c.value) ? c.value.map(String) : [String(c.value)]
      if (Array.isArray(actual)) return actual.some((a) => set.includes(String(a)))
      return set.includes(String(actual ?? ''))
    }
    case 'gt':
      return Number(actual) > Number(c.value) && !isEmpty(actual)
    case 'lt':
      return Number(actual) < Number(c.value) && !isEmpty(actual)
    default:
      return false
  }
}

/** Shown (and validated) when every condition holds. */
export function isVisible(def: Pick<FieldDef, 'conditions'>, values: Record<string, unknown>, ctx: RuleContext) {
  return (def.conditions ?? []).every((c) => conditionHolds(c, values, ctx))
}

/** The fields a form shows, in order, for these values and this context. */
export function visibleDefs<T extends FieldDef>(defs: T[], values: Record<string, unknown>, ctx: RuleContext): T[] {
  return defs
    .filter((d) => !d.archived && inScope(d, ctx) && isVisible(d, values, ctx))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Values a new record starts with: each active, in-scope field's default. */
export function defaultValues(defs: FieldDef[], ctx: RuleContext = {}): CustomValues {
  const out: CustomValues = {}
  for (const d of defs) {
    if (d.archived || !inScope(d, ctx) || d.defaultValue === undefined || isEmpty(d.defaultValue)) continue
    out[d.key] = d.defaultValue
  }
  return out
}

/** Coerce one raw value (form or CSV string) to the field's type; return an error message when it cannot be. */
export function coerceValue(
  def: FieldDef,
  raw: unknown,
  previous?: unknown,
): { ok: true; value: CustomValue } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message })
  const v = def.validation ?? {}
  switch (def.type) {
    case 'text':
    case 'long_text': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return fail('must be text')
      const s = String(raw).trim()
      const cap = Math.min(
        v.maxLength ?? Infinity,
        def.type === 'text' ? LIMITS.textLength : LIMITS.longTextLength,
      )
      if (s.length > cap) return fail(`must be at most ${cap} characters`)
      if (v.pattern) {
        let re: RegExp | null = null
        try {
          re = new RegExp(`^(?:${v.pattern})$`)
        } catch {
          re = null
        }
        if (re && !re.test(s)) return fail('is not in the expected format')
      }
      return { ok: true, value: s }
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
      if (!Number.isFinite(n)) return fail('must be a number')
      if (v.integer && !Number.isInteger(n)) return fail('must be a whole number')
      if (v.min !== undefined && n < v.min) return fail(`must be at least ${v.min}`)
      if (v.max !== undefined && n > v.max) return fail(`must be at most ${v.max}`)
      return { ok: true, value: n }
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      if (raw === 'true' || raw === 'yes' || raw === '1') return { ok: true, value: true }
      if (raw === 'false' || raw === 'no' || raw === '0') return { ok: true, value: false }
      return fail('must be yes or no')
    }
    case 'date': {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fail('must be a date (YYYY-MM-DD)')
      const d = new Date(`${raw}T00:00:00Z`)
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return fail('must be a real date')
      return { ok: true, value: raw }
    }
    case 'select': {
      if (typeof raw !== 'string') return fail('must be one of the choices')
      const opt = (def.options ?? []).find((o) => o.value === raw)
      // An archived choice stays valid on records that already hold it.
      if (!opt || (opt.archived && previous !== raw)) return fail('must be one of the choices')
      return { ok: true, value: raw }
    }
    case 'multiselect': {
      const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[;,]/).map((s) => s.trim()) : null
      if (!arr || arr.some((x) => typeof x !== 'string')) return fail('must be a list of choices')
      const prev = Array.isArray(previous) ? previous : []
      const out: string[] = []
      for (const x of arr as string[]) {
        if (!x || out.includes(x)) continue
        const opt = (def.options ?? []).find((o) => o.value === x)
        if (!opt || (opt.archived && !prev.includes(x))) return fail(`has an unknown choice "${x}"`)
        out.push(x)
      }
      return { ok: true, value: out }
    }
    case 'photo': {
      if (typeof raw !== 'string' || raw.length > 64) return fail('must be an uploaded photo')
      return { ok: true, value: raw }
    }
    default:
      return fail('has an unknown type')
  }
}

export type FieldError = { key: string; label: string; message: string }

/**
 * Check a whole `custom` object against the definitions (pure; photo
 * ownership is checked by the server on top). Returns the cleaned values and
 * per-field errors.
 *
 * - unknown keys are refused;
 * - archived fields keep their previous value; a changed value is refused;
 * - fields out of the record's site scope, or hidden by their conditions, are
 *   dropped and never required;
 * - on create, defaults fill fields the client left empty;
 * - required applies to visible, in-scope, active fields.
 */
export function checkValues(
  defs: FieldDef[],
  input: Record<string, unknown> | undefined,
  opts: { mode: 'create' | 'update'; previous?: Record<string, unknown>; context?: RuleContext },
): { values: CustomValues; errors: FieldError[] } {
  const ctx = opts.context ?? {}
  const previous = opts.previous ?? {}
  const byKey = new Map(defs.map((d) => [d.key, d]))
  const errors: FieldError[] = []
  const merged: Record<string, unknown> = { ...previous, ...(input ?? {}) }

  for (const key of Object.keys(input ?? {})) {
    if (!byKey.has(key)) {
      // A key no definition knows: refuse, unless it is a stored leftover the client echoed back.
      if (key in previous && sameValue(previous[key], input![key])) continue
      errors.push({ key, label: key, message: 'is not a field of this record' })
    }
  }

  if (opts.mode === 'create') {
    for (const [k, v] of Object.entries(defaultValues(defs, ctx))) {
      if (isEmpty(merged[k])) merged[k] = v
    }
  }

  const values: CustomValues = {}
  // Coerce first, so conditions see typed values.
  const typed: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(merged)) {
    const def = byKey.get(key)
    if (!def) {
      if (key in previous) typed[key] = previous[key]
      continue
    }
    if (isEmpty(raw)) continue
    if (def.archived) {
      if (key in previous && sameValue(previous[key], raw)) typed[key] = previous[key]
      else if (input && key in input) errors.push({ key, label: def.label, message: 'is archived and cannot be changed' })
      else if (key in previous) typed[key] = previous[key]
      continue
    }
    const r = coerceValue(def, raw, previous[key])
    if (!r.ok) errors.push({ key, label: def.label, message: r.message })
    else typed[key] = r.value
  }

  for (const [key, value] of Object.entries(typed)) {
    const def = byKey.get(key)
    if (!def || def.archived) {
      values[key] = value as CustomValue // inert leftovers stay readable
      continue
    }
    if (!inScope(def, ctx) || !isVisible(def, typed, ctx)) continue
    values[key] = value as CustomValue
  }

  for (const def of defs) {
    if (def.archived || !def.required) continue
    if (!inScope(def, ctx) || !isVisible(def, typed, ctx)) continue
    if (isEmpty(values[def.key]) && !errors.some((e) => e.key === def.key)) {
      errors.push({ key: def.key, label: def.label, message: 'is required' })
    }
  }
  return { values, errors }
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Text for a stored value (lists, exports). */
export function formatValue(def: Pick<FieldDef, 'type' | 'options' | 'unit'> | undefined, value: unknown): string {
  if (isEmpty(value)) return ''
  const label = (v: unknown) => def?.options?.find((o) => o.value === v)?.label ?? String(v)
  if (Array.isArray(value)) return value.map(label).join('; ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (def?.type === 'select') return label(value)
  if (def?.type === 'photo') return 'Photo'
  if (def?.type === 'number' && def.unit) return `${value} ${def.unit}`
  return String(value)
}

/**
 * A pattern an organization may store: short, compiles, and no nested
 * quantifier like (a+)+ that could backtrack catastrophically.
 */
export function patternProblem(pattern: string): string | null {
  if (pattern.length > LIMITS.patternLength) return `Patterns can be at most ${LIMITS.patternLength} characters`
  try {
    new RegExp(pattern)
  } catch {
    return 'The pattern is not a valid regular expression'
  }
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(pattern)) {
    return 'Nested repetition like (a+)+ is not allowed in patterns'
  }
  if (/\\[1-9]/.test(pattern)) return 'Back-references are not allowed in patterns'
  return null
}
