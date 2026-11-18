/**
 * Form layouts (CUSTOM-004, D-007): an organization arranges a record form
 * into ordered sections, orders its fields, and shows a field only when
 * another field has a value. Behaviour of core fields stays in code; a layout
 * can only move them. No imports, so the browser and tests share it.
 *
 * Refs: 'core:<key>' (a built-in input listed in FORM_CATALOG) or
 * 'custom:<key>' (a custom field of the form's entity, CUSTOM-001).
 */

export type ShowWhenOp = 'is_set' | 'eq' | 'neq'
export type ShowWhen = { ref: string; op: ShowWhenOp; value?: string | number | boolean }
export type LayoutField = { ref: string; width?: 'full' | 'half'; showWhen?: ShowWhen }
export type LayoutSection = { key: string; title?: string; fields: LayoutField[] }
export type DefLite = { key: string; required: boolean; archived: boolean }

type CoreField = { key: string; required?: boolean; width?: 'full' | 'half' }
type FormSpec = {
  entity: string
  core: CoreField[]
  /** Today's form: section key → core field keys in order. Custom fields go to the last section. */
  sections: { key: string; fields: string[] }[]
}

/**
 * The forms that render through components/FormLayout. Only forms listed here
 * can be arranged; the editor offers exactly these. Labels: i18n
 * `formLayout.form.<id>`, `formLayout.section.<key>`, `formLayout.core.<key>`.
 */
export const FORM_CATALOG: Record<string, FormSpec> = {
  'production.sampling': {
    entity: 'biweeklyRecords',
    core: [
      { key: 'date', required: true },
      { key: 'batchCode' },
      { key: 'dissolvedOxygen' },
      { key: 'temperatureC' },
      { key: 'secchiCm' },
      { key: 'samples', required: true, width: 'full' },
    ],
    sections: [
      { key: 'session', fields: ['date', 'batchCode'] },
      { key: 'water', fields: ['dissolvedOxygen', 'temperatureC', 'secchiCm'] },
      { key: 'samples', fields: ['samples'] },
      { key: 'more', fields: [] },
    ],
  },
  'production.stocking': {
    entity: 'stockingHistory',
    core: [
      { key: 'cageId', required: true, width: 'full' },
      { key: 'batchNumber' },
      { key: 'stockingDate', required: true },
      { key: 'species', required: true },
      { key: 'fishCount', required: true },
      { key: 'averageBodyWeight', required: true },
      { key: 'sourceLocation', width: 'full' },
      { key: 'transferSupervisor' },
      { key: 'samplingSupervisor' },
      { key: 'notes', width: 'full' },
    ],
    sections: [
      { key: 'cageBatch', fields: ['cageId', 'batchNumber', 'stockingDate', 'species'] },
      { key: 'fish', fields: ['fishCount', 'averageBodyWeight'] },
      { key: 'source', fields: ['sourceLocation', 'transferSupervisor', 'samplingSupervisor'] },
      { key: 'notes', fields: ['notes'] },
      { key: 'more', fields: [] },
    ],
  },
}

export const FORM_KEYS = Object.keys(FORM_CATALOG)

export const LAYOUT_LIMITS = { sections: 12, fieldsPerSection: 60, titleLength: 60 } as const

const SECTION_KEY = /^[a-z][a-zA-Z0-9_]{0,39}$/

export function isFormKey(k: string): boolean {
  return Object.prototype.hasOwnProperty.call(FORM_CATALOG, k)
}

function coreSpec(formKey: string, key: string) {
  return FORM_CATALOG[formKey]?.core.find((c) => c.key === key)
}

/** Whether `ref` must always be visible (required core or required custom field). */
function requiredRef(formKey: string, ref: string, defs: DefLite[]) {
  const [ns, key] = ref.split(':', 2)
  if (ns === 'core') return !!coreSpec(formKey, key)?.required
  return !!defs.find((d) => d.key === key)?.required
}

function knownRef(formKey: string, ref: string, defs: DefLite[]) {
  const [ns, key] = ref.split(':', 2)
  if (ns === 'core') return !!coreSpec(formKey, key)
  if (ns === 'custom') return defs.some((d) => d.key === key)
  return false
}

/** Today's form as a layout (what an organization without a saved layout sees). */
export function defaultLayout(formKey: string): LayoutSection[] {
  const spec = FORM_CATALOG[formKey]
  if (!spec) return []
  return spec.sections.map((s) => ({
    key: s.key,
    fields: s.fields.map((k) => {
      const width = coreSpec(formKey, k)?.width
      return width ? { ref: `core:${k}`, width } : { ref: `core:${k}` }
    }),
  }))
}

/** Problems with a layout as it would be saved; [] when valid. */
export function layoutProblems(formKey: string, sections: LayoutSection[], defs: DefLite[]): string[] {
  if (!isFormKey(formKey)) return ['Unknown form']
  const out: string[] = []
  if (!sections.length) out.push('Add at least one section')
  if (sections.length > LAYOUT_LIMITS.sections) out.push(`At most ${LAYOUT_LIMITS.sections} sections`)
  const sectionKeys = new Set<string>()
  const seen = new Set<string>()
  const all: LayoutField[] = []
  for (const s of sections) {
    if (!SECTION_KEY.test(s.key)) out.push(`Section key "${s.key}" is not valid`)
    if (sectionKeys.has(s.key)) out.push(`Section "${s.key}" appears twice`)
    sectionKeys.add(s.key)
    if ((s.title ?? '').length > LAYOUT_LIMITS.titleLength) out.push(`Section titles are at most ${LAYOUT_LIMITS.titleLength} characters`)
    if (s.fields.length > LAYOUT_LIMITS.fieldsPerSection) out.push(`At most ${LAYOUT_LIMITS.fieldsPerSection} fields per section`)
    for (const f of s.fields) {
      if (!knownRef(formKey, f.ref, defs)) out.push(`Unknown field "${f.ref}"`)
      if (seen.has(f.ref)) out.push(`Field "${f.ref}" appears twice`)
      seen.add(f.ref)
      all.push(f)
    }
  }
  const byRef = new Map(all.map((f) => [f.ref, f]))
  for (const f of all) {
    const w = f.showWhen
    if (!w) continue
    if (requiredRef(formKey, f.ref, defs)) out.push(`"${f.ref}" is required, so it cannot be conditional`)
    if (w.ref === f.ref) out.push(`"${f.ref}" cannot depend on itself`)
    else if (!knownRef(formKey, w.ref, defs)) out.push(`"${f.ref}" depends on an unknown field "${w.ref}"`)
    else if (byRef.get(w.ref)?.showWhen) out.push(`"${f.ref}" depends on "${w.ref}", which is conditional itself`)
    if (!['is_set', 'eq', 'neq'].includes(w.op)) out.push(`"${f.ref}": unknown condition`)
    if (w.op !== 'is_set' && (w.value === undefined || w.value === '')) out.push(`"${f.ref}": give the condition a value`)
  }
  return [...new Set(out)]
}

/**
 * The layout to render: the saved one (or today's), with every core field and
 * every active custom field placed exactly once. Fields the saved layout does
 * not mention (added since it was saved) go to their default section (core)
 * or the last section (custom); archived and unknown refs are dropped.
 */
export function resolveLayout(formKey: string, saved: LayoutSection[] | null | undefined, defs: DefLite[]): LayoutSection[] {
  const spec = FORM_CATALOG[formKey]
  if (!spec) return []
  const active = defs.filter((d) => !d.archived)
  const base = saved && saved.length ? saved : defaultLayout(formKey)
  const placed = new Set<string>()
  const sections: LayoutSection[] = base.map((s) => ({
    ...s,
    fields: s.fields.filter((f) => {
      const [ns, key] = f.ref.split(':', 2)
      const ok = ns === 'core' ? !!coreSpec(formKey, key) : ns === 'custom' && active.some((d) => d.key === key)
      if (!ok || placed.has(f.ref)) return false
      placed.add(f.ref)
      return true
    }),
  }))
  if (!sections.length) sections.push({ key: 'more', fields: [] })
  for (const def of spec.sections) {
    for (const k of def.fields) {
      const ref = `core:${k}`
      if (placed.has(ref)) continue
      const target = sections.find((s) => s.key === def.key) ?? sections[sections.length - 1]
      const width = coreSpec(formKey, k)?.width
      target.fields.push(width ? { ref, width } : { ref })
      placed.add(ref)
    }
  }
  const last = sections[sections.length - 1]
  for (const d of active) {
    const ref = `custom:${d.key}`
    if (!placed.has(ref)) {
      last.fields.push({ ref })
      placed.add(ref)
    }
  }
  return sections
}

function emptyValue(v: unknown) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

/** Whether a field is shown given the form's current values ({ 'core:x': …, 'custom:y': … }). */
export function fieldShown(field: LayoutField, values: Record<string, unknown>): boolean {
  const w = field.showWhen
  if (!w) return true
  const v = values[w.ref]
  if (w.op === 'is_set') return !emptyValue(v)
  const match = Array.isArray(v) ? v.map(String).includes(String(w.value)) : !emptyValue(v) && String(v) === String(w.value)
  return w.op === 'eq' ? match : !match
}

/** Refs hidden right now by layout conditions (a form clears their values before saving). */
export function hiddenRefs(sections: LayoutSection[], values: Record<string, unknown>): string[] {
  return sections.flatMap((s) => s.fields.filter((f) => !fieldShown(f, values)).map((f) => f.ref))
}

/** Core field keys of a form (for labels in the editor). */
export function coreFieldKeys(formKey: string): string[] {
  return FORM_CATALOG[formKey]?.core.map((c) => c.key) ?? []
}

export function isRequiredCore(formKey: string, key: string): boolean {
  return !!coreSpec(formKey, key)?.required
}
