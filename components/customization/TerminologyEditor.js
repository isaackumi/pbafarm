import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { RotateCcw, Save } from 'lucide-react'
import { GhostButton, GradientButton } from '../ui'
import { useToast } from '../Toast'
import { api } from '../../convex/_generated/api'
import { errorMessage } from '../../lib/errorMessage'
import { TERM_GROUPS, applyTerms } from '../../lib/terminology'
import { FIELD, SettingsCard, SettingsField } from '../settings'

const PREVIEW = 'All Cages · Feed Types · Harvest Data · Pond records · Batch history'

function nonEmpty(terms) {
  const out = {}
  for (const [key, value] of Object.entries(terms || {})) {
    const text = String(value ?? '').trim()
    if (text) out[key] = text
  }
  return out
}

function sameTerms(a, b) {
  const left = nonEmpty(a)
  const right = nonEmpty(b)
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every((key) => left[key] === right[key])
}

/**
 * Customization → Words (CUSTOM-003, D-007). Rename the built-in nouns for
 * this organization; blank boxes keep the built-in word.
 */
export default function TerminologyEditor() {
  const terms = useQuery(api.terminology.get, {})
  const save = useMutation(api.terminology.update)
  const { showToast } = useToast()
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const loaded = useRef(false)

  const canWrite = terms !== undefined

  useEffect(() => {
    if (!canWrite || loaded.current) return
    setForm({ ...terms })
    loaded.current = true
  }, [canWrite, terms])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const dirty = terms !== undefined && !sameTerms(form, terms)

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const clean = await save({ terms: nonEmpty(form) })
      setForm({ ...clean })
      showToast('Words saved. Menus and forms now use them.', 'success')
    } catch (err) {
      showToast(errorMessage(err, 'Could not save the words'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <SettingsCard title="Your words" className="space-y-4">
        {terms === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            {TERM_GROUPS.map((group) => (
              <section key={group.id} className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-text">{group.title}</h3>
                  <p className="text-xs text-muted">{group.description}</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {group.fields.map((field) => (
                    <div
                      key={field.key}
                      className="rounded-lg border border-line p-3"
                    >
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                        {field.label}
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <SettingsField label="One" htmlFor={`term-${field.key}`}>
                          <input
                            className={FIELD}
                            id={`term-${field.key}`}
                            value={form[field.key] || ''}
                            onChange={set(field.key)}
                            placeholder={field.singular}
                            maxLength={40}
                            autoComplete="off"
                          />
                        </SettingsField>
                        <SettingsField label="Many" htmlFor={`term-${field.pluralKey}`}>
                          <input
                            className={FIELD}
                            id={`term-${field.pluralKey}`}
                            value={form[field.pluralKey] || ''}
                            onChange={set(field.pluralKey)}
                            placeholder={field.plural}
                            maxLength={40}
                            autoComplete="off"
                          />
                        </SettingsField>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </SettingsCard>

      <SettingsCard title="Preview" className="space-y-2">
        <p className="text-sm text-text">{applyTerms(PREVIEW, form)}</p>
      </SettingsCard>

      <div className="flex flex-wrap items-center gap-2">
        <GradientButton type="submit" disabled={saving || !canWrite || !dirty}>
          <Save size={16} aria-hidden />
          {saving ? 'Saving…' : 'Save words'}
        </GradientButton>
        <GhostButton
          size="lg"
          type="button"
          disabled={saving || !canWrite}
          onClick={() => setForm({})}
        >
          <RotateCcw size={16} aria-hidden />
          Clear all
        </GhostButton>
        {!dirty && canWrite && <span className="text-sm text-muted">No unsaved changes</span>}
      </div>
    </form>
  )
}
