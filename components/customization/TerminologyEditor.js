import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { RotateCcw, Save } from 'lucide-react'
import { Button, Card, CardHeader, Field, Input } from '../ui'
import { useToast } from '../Toast'
import { api } from '../../convex/_generated/api'
import { errorMessage } from '../../lib/errorMessage'
import { TERM_GROUPS, applyTerms } from '../../lib/terminology'

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
      <Card className="space-y-4">
        <CardHeader
          title="Your words"
          description="Change what this organization calls things. Blank boxes keep the built-in word; the change reaches menus, page titles, forms and reports."
        />
        {terms === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            {TERM_GROUPS.map((group) => (
              <section key={group.id} className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-chart-ink">{group.title}</h3>
                  <p className="text-xs text-muted">{group.description}</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {group.fields.map((field) => (
                    <div
                      key={field.key}
                      className="rounded-lg border border-foam-deep p-3"
                    >
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                        {field.label}
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="One" htmlFor={`term-${field.key}`}>
                          <Input
                            id={`term-${field.key}`}
                            value={form[field.key] || ''}
                            onChange={set(field.key)}
                            placeholder={field.singular}
                            maxLength={40}
                            autoComplete="off"
                          />
                        </Field>
                        <Field label="Many" htmlFor={`term-${field.pluralKey}`}>
                          <Input
                            id={`term-${field.pluralKey}`}
                            value={form[field.pluralKey] || ''}
                            onChange={set(field.pluralKey)}
                            placeholder={field.plural}
                            maxLength={40}
                            autoComplete="off"
                          />
                        </Field>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </Card>

      <Card className="space-y-2">
        <CardHeader title="Preview" description="How the built-in labels read with these words." />
        <p className="text-sm text-chart-ink">{applyTerms(PREVIEW, form)}</p>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving || !canWrite || !dirty}>
          <Save size={16} aria-hidden />
          {saving ? 'Saving…' : 'Save words'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={saving || !canWrite}
          onClick={() => setForm({})}
        >
          <RotateCcw size={16} aria-hidden />
          Clear all
        </Button>
        {!dirty && canWrite && <span className="text-sm text-muted">No unsaved changes</span>}
      </div>
    </form>
  )
}
