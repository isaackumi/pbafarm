import { useEffect, useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../lib/i18n/context'
import { FormSection } from './ui'
import { CustomFieldControl, useCustomFieldDefs } from './CustomFields'
import { FORM_CATALOG, fieldShown, hiddenRefs, resolveLayout } from '../convex/lib/formLayouts'
import { defaultValues, isEmpty, visibleDefs } from '../convex/lib/customFieldRules'

/**
 * Form layouts (CUSTOM-004): renders a record form's core inputs and custom
 * fields in the organization's sections and order (Settings → Customization
 * → Forms). Forms without a saved layout render as listed in FORM_CATALOG.
 *
 * Forms keep their own state and inputs; they hand each core input to the
 * renderer as a node keyed by its catalog key.
 */

/** `{ sections, defs, ready }` for a catalogued form; sections are never empty once defs load. */
export function useFormLayout(formKey) {
  const { canUseApp } = useAuth()
  const known = !!FORM_CATALOG[formKey]
  const entity = FORM_CATALOG[formKey]?.entity
  const saved = useQuery(api.formLayouts.get, canUseApp && known ? { formKey } : 'skip')
  const entityDefs = useCustomFieldDefs(entity)
  // Forms with no custom-field entity arrange their core fields only.
  const defs = entity ? entityDefs : NO_DEFS
  const sections = useMemo(
    () => resolveLayout(formKey, saved?.sections, (defs ?? []).map((d) => ({ key: d.key, required: d.required, archived: d.archived }))),
    [formKey, saved, defs],
  )
  return { sections, defs, ready: saved !== undefined && defs !== undefined }
}

/** Values the layout's conditions read: `core:<key>` and `custom:<key>`. */
export function layoutValues(coreValues, custom) {
  const out = {}
  for (const [k, v] of Object.entries(coreValues || {})) out[`core:${k}`] = v
  for (const [k, v] of Object.entries(custom || {})) out[`custom:${k}`] = v
  return out
}

/** Core keys the layout hides right now (forms leave them out of the saved record). */
export function hiddenCoreKeys(sections, coreValues, custom) {
  return new Set(
    hiddenRefs(sections, layoutValues(coreValues, custom))
      .filter((r) => r.startsWith('core:'))
      .map((r) => r.slice(5)),
  )
}

const NO_DEFS = []

const WIDTH = { full: 'md:col-span-2', half: '' }
// Compact (a repeated line, e.g. one cage in daily entry): four columns on wide screens.
const COMPACT_WIDTH = { full: 'col-span-2 md:col-span-4', half: 'col-span-2' }

/**
 * Props: formKey; layout (from useFormLayout); fields ({ coreKey: node });
 * coreValues (built-in values for conditions); custom / onCustomChange;
 * locationId; core (values for custom fields' own 'core:' conditions);
 * errorKey; idPrefix; compact (render sections as small labelled grids, for
 * a form repeated per line). A core node that is null (hidden by the form's
 * own rules) is skipped.
 */
export default function FormLayout({
  formKey,
  layout,
  fields,
  coreValues,
  custom,
  onCustomChange,
  locationId,
  core,
  errorKey,
  idPrefix = 'cf',
  compact = false,
}) {
  const t = useT()
  const { sections, defs } = layout
  const site = locationId || null
  const customValues = useMemo(
    () => (defs ? { ...defaultValues(defs, { locationId: site }), ...(custom || {}) } : custom || {}),
    [defs, site, custom],
  )
  const values = useMemo(() => layoutValues(coreValues, customValues), [coreValues, customValues])
  const customShown = useMemo(
    () => new Map((defs ? visibleDefs(defs, customValues, { locationId: site, core }) : []).map((d) => [d.key, d])),
    [defs, customValues, site, core],
  )

  // A custom value whose field the layout hides is not kept (it would be saved unseen).
  const hiddenCustom = useMemo(
    () =>
      hiddenRefs(sections, values)
        .filter((r) => r.startsWith('custom:'))
        .map((r) => r.slice(7))
        .filter((k) => custom && !isEmpty(custom[k])),
    [sections, values, custom],
  )
  useEffect(() => {
    if (!hiddenCustom.length || !onCustomChange) return
    const next = { ...(custom || {}) }
    for (const k of hiddenCustom) delete next[k]
    onCustomChange(next)
  }, [hiddenCustom, custom, onCustomChange])

  return (
    <>
      {sections.map((section) => {
        const items = section.fields
          .filter((f) => fieldShown(f, values))
          .map((f) => {
            const [ns, key] = f.ref.split(':', 2)
            const widths = compact ? COMPACT_WIDTH : WIDTH
            const span = widths[f.width] ?? ''
            if (ns === 'core') {
              const node = fields[key]
              return node ? (
                <div key={f.ref} className={span}>
                  {node}
                </div>
              ) : null
            }
            const def = customShown.get(key)
            if (!def) return null
            const wide = f.width ? span : def.type === 'long_text' || def.type === 'multiselect' ? widths.full : ''
            return (
              <CustomFieldControl
                key={f.ref}
                def={def}
                value={customValues[key]}
                onChange={(v) => onCustomChange({ ...customValues, [key]: v })}
                idPrefix={idPrefix}
                errorKey={errorKey}
                className={wide}
              />
            )
          })
          .filter(Boolean)
        if (!items.length) return null
        const title = section.title || t.or(`formLayout.section.${section.key}`, section.key)
        if (compact) {
          return (
            <div key={section.key} role="group" aria-label={title}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2 items-end">{items}</div>
            </div>
          )
        }
        return (
          <FormSection
            key={section.key}
            title={title}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">{items}</div>
          </FormSection>
        )
      })}
    </>
  )
}
