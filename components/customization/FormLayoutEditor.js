import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { GhostButton, GradientButton, Pill } from '../ui'
import { useToast } from '../Toast'
import { api } from '../../convex/_generated/api'
import { errorMessage } from '../../lib/errorMessage'
import { useT } from '../../lib/i18n/context'
import { useCustomFieldDefs } from '../CustomFields'
import {
  FORM_CATALOG,
  FORM_KEYS,
  LAYOUT_LIMITS,
  isRequiredCore,
  layoutProblems,
  resolveLayout,
} from '../../convex/lib/formLayouts'
import { FIELD, InlineError, SettingsCard, SettingsField } from '../settings'
import { TonePill } from '../paperTones'

const NO_DEFS = []
const lite = (defs) => (defs ?? []).map((d) => ({ key: d.key, required: d.required, archived: d.archived }))

/** Drop empty optional props so the saved layout matches the validator. */
function clean(sections) {
  return sections.map((s) => ({
    key: s.key,
    ...(s.title?.trim() ? { title: s.title.trim() } : {}),
    fields: s.fields.map((f) => ({
      ref: f.ref,
      ...(f.width ? { width: f.width } : {}),
      ...(f.showWhen?.ref
        ? {
            showWhen: {
              ref: f.showWhen.ref,
              op: f.showWhen.op,
              ...(f.showWhen.op !== 'is_set' ? { value: f.showWhen.value ?? '' } : {}),
            },
          }
        : {}),
    })),
  }))
}

function move(list, i, step) {
  const j = i + step
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/**
 * Customization → Forms (CUSTOM-004): arrange a record form into sections,
 * order its fields, set their width, and show a field only when another
 * field has a value. Core inputs keep their behaviour; only placement changes.
 */
export default function FormLayoutEditor() {
  const t = useT()
  const [formKey, setFormKey] = useState(FORM_KEYS[0])
  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title={t('formLayout.title')}>
        <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">{t('formLayout.intro')}</p>
        <SettingsField label={t('formLayout.form')} htmlFor="fl-form">
          <select className={FIELD} id="fl-form" value={formKey} onChange={(e) => setFormKey(e.target.value)}>
            {FORM_KEYS.map((k) => (
              <option key={k} value={k}>
                {t.or(`formLayout.formName.${k.replace('.', '_')}`, k)}
              </option>
            ))}
          </select>
        </SettingsField>
      </SettingsCard>
      <FormEditor key={formKey} formKey={formKey} />
    </div>
  )
}

function FormEditor({ formKey }) {
  const t = useT()
  const { showToast } = useToast()
  const entity = FORM_CATALOG[formKey].entity
  const saved = useQuery(api.formLayouts.get, { formKey })
  const entityDefs = useCustomFieldDefs(entity)
  const defs = entity ? entityDefs : NO_DEFS
  const save = useMutation(api.formLayouts.save)
  const reset = useMutation(api.formLayouts.reset)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)

  const ready = saved !== undefined && defs !== undefined
  useEffect(() => {
    if (ready && draft === null) setDraft(resolveLayout(formKey, saved?.sections, lite(defs)))
  }, [ready, draft, formKey, saved, defs])

  const label = (ref) => {
    const [ns, key] = ref.split(':', 2)
    if (ns === 'core') return t.or(`formLayout.core.${key}`, key)
    return defs?.find((d) => d.key === key)?.label ?? key
  }
  const required = (ref) => {
    const [ns, key] = ref.split(':', 2)
    return ns === 'core' ? isRequiredCore(formKey, key) : !!defs?.find((d) => d.key === key)?.required
  }
  const sectionTitle = (s) => s.title || t.or(`formLayout.section.${s.key}`, s.key)

  const problems = useMemo(() => (draft ? layoutProblems(formKey, clean(draft), lite(defs)) : []), [draft, formKey, defs])
  const allFields = useMemo(() => (draft ?? []).flatMap((s) => s.fields), [draft])

  if (!ready || !draft) return <p className="text-[13px] leading-4 text-muted">{t('common.loading')}</p>

  const setSection = (i, patch) => setDraft((d) => d.map((s, k) => (k === i ? { ...s, ...patch } : s)))
  const setField = (si, fi, patch) =>
    setDraft((d) =>
      d.map((s, k) => (k === si ? { ...s, fields: s.fields.map((f, j) => (j === fi ? { ...f, ...patch } : f)) } : s)),
    )
  const moveToSection = (si, fi, target) =>
    setDraft((d) => {
      const field = d[si].fields[fi]
      return d.map((s, k) => {
        if (k === si) return { ...s, fields: s.fields.filter((_, j) => j !== fi) }
        if (k === target) return { ...s, fields: [...s.fields, field] }
        return s
      })
    })
  const removeSection = (i) =>
    setDraft((d) => {
      const into = i === 0 ? 1 : i - 1
      return d
        .map((s, k) => (k === into ? { ...s, fields: [...s.fields, ...d[i].fields] } : s))
        .filter((_, k) => k !== i)
    })
  const addSection = () =>
    setDraft((d) => [...d, { key: `s${Date.now().toString(36)}`, title: t('formLayout.newSection'), fields: [] }])

  const submit = async () => {
    setBusy(true)
    try {
      await save({ formKey, sections: clean(draft) })
      showToast('success', t('formLayout.saved'))
    } catch (err) {
      showToast('error', errorMessage(err, t('formLayout.saveFailed')))
    } finally {
      setBusy(false)
    }
  }
  const restore = async () => {
    setBusy(true)
    try {
      await reset({ formKey })
      setDraft(resolveLayout(formKey, null, lite(defs)))
      showToast('success', t('formLayout.resetDone'))
    } catch (err) {
      showToast('error', errorMessage(err, t('formLayout.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {draft.map((section, si) => (
        <SettingsCard key={section.key}>
          <div className="flex flex-wrap items-end gap-2 pb-3">
            <SettingsField label={t('formLayout.sectionTitle')} htmlFor={`fl-s-${section.key}`} className="flex-1 min-w-48">
              <input
                className={FIELD}
                id={`fl-s-${section.key}`}
                value={section.title ?? ''}
                placeholder={sectionTitle({ key: section.key })}
                maxLength={LAYOUT_LIMITS.titleLength}
                onChange={(e) => setSection(si, { title: e.target.value })}
              />
            </SettingsField>
            <GhostButton size="sm" aria-label={t('formLayout.moveUp')} disabled={si === 0} onClick={() => setDraft((d) => move(d, si, -1))}>
              <ArrowUp className="h-4 w-4" aria-hidden />
            </GhostButton>
            <GhostButton
              size="sm"
              aria-label={t('formLayout.moveDown')}
              disabled={si === draft.length - 1}
              onClick={() => setDraft((d) => move(d, si, 1))}
            >
              <ArrowDown className="h-4 w-4" aria-hidden />
            </GhostButton>
            <GhostButton size="sm" aria-label={t('formLayout.removeSection')} disabled={draft.length === 1} onClick={() => removeSection(si)}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </GhostButton>
          </div>
          {section.fields.length === 0 ? (
            <p className="border-t border-line py-3 text-[13px] leading-4 text-muted">{t('formLayout.emptySection')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {section.fields.map((f, fi) => {
                const controllers = allFields.filter((o) => o.ref !== f.ref && !o.showWhen)
                const w = f.showWhen
                return (
                  <li
                    key={f.ref}
                    className="grid gap-3 rounded-input border border-line px-4 py-[14px] sm:grid-cols-[1fr_auto] sm:items-start"
                    style={{ backgroundColor: 'color-mix(in oklab, var(--bg) 70%, var(--surface-2))' }}
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[14px] leading-[18px] text-text">
                        {label(f.ref)}
                        {required(f.ref) && <Pill>{t('formLayout.required')}</Pill>}
                        {f.ref.startsWith('custom:') && <TonePill tone="lime">{t('formLayout.custom')}</TonePill>}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <select
                          aria-label={t('formLayout.moveToSection')}
                          className={`${FIELD} !w-auto`}
                          value={si}
                          onChange={(e) => moveToSection(si, fi, Number(e.target.value))}
                        >
                          {draft.map((s, k) => (
                            <option key={s.key} value={k}>
                              {sectionTitle(s)}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={t('formLayout.width')}
                          className={`${FIELD} !w-auto`}
                          value={f.width ?? ''}
                          onChange={(e) => setField(si, fi, { width: e.target.value || undefined })}
                        >
                          <option value="">{t('formLayout.widthAuto')}</option>
                          <option value="half">{t('formLayout.widthHalf')}</option>
                          <option value="full">{t('formLayout.widthFull')}</option>
                        </select>
                        {!required(f.ref) && (
                          <select
                            aria-label={t('formLayout.showWhen')}
                            className={`${FIELD} !w-auto`}
                            value={w?.ref ?? ''}
                            onChange={(e) =>
                              setField(si, fi, {
                                showWhen: e.target.value ? { ref: e.target.value, op: w?.op ?? 'is_set', value: w?.value } : undefined,
                              })
                            }
                          >
                            <option value="">{t('formLayout.always')}</option>
                            {controllers.map((o) => (
                              <option key={o.ref} value={o.ref}>
                                {t('formLayout.whenField', { field: label(o.ref) })}
                              </option>
                            ))}
                          </select>
                        )}
                        {w?.ref && (
                          <>
                            <select
                              aria-label={t('formLayout.condition')}
                              className={`${FIELD} !w-auto`}
                              value={w.op}
                              onChange={(e) => setField(si, fi, { showWhen: { ...w, op: e.target.value } })}
                            >
                              <option value="is_set">{t('formLayout.opIsSet')}</option>
                              <option value="eq">{t('formLayout.opEq')}</option>
                              <option value="neq">{t('formLayout.opNeq')}</option>
                            </select>
                            {w.op !== 'is_set' && (
                              <input
                                aria-label={t('formLayout.conditionValue')}
                                className={`${FIELD} !w-40`}
                                value={w.value ?? ''}
                                onChange={(e) => setField(si, fi, { showWhen: { ...w, value: e.target.value } })}
                              />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <GhostButton
                        size="sm"
                        aria-label={t('formLayout.moveUp')}
                        disabled={fi === 0}
                        onClick={() => setSection(si, { fields: move(section.fields, fi, -1) })}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </GhostButton>
                      <GhostButton
                        size="sm"
                        aria-label={t('formLayout.moveDown')}
                        disabled={fi === section.fields.length - 1}
                        onClick={() => setSection(si, { fields: move(section.fields, fi, 1) })}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </GhostButton>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </SettingsCard>
      ))}
      {problems.length > 0 && (
        <InlineError className="flex flex-col gap-1">
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </InlineError>
      )}
      <div className="flex flex-wrap gap-2">
        <GhostButton size="lg" onClick={addSection} disabled={draft.length >= LAYOUT_LIMITS.sections}>
          <Plus className="h-4 w-4" aria-hidden />
          {t('formLayout.addSection')}
        </GhostButton>
        <GradientButton ring="sky" onClick={submit} disabled={busy || problems.length > 0}>
          <Save className="h-4 w-4" aria-hidden />
          {t('formLayout.save')}
        </GradientButton>
        <GhostButton onClick={restore} disabled={busy || !saved}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          {t('formLayout.reset')}
        </GhostButton>
      </div>
    </div>
  )
}
