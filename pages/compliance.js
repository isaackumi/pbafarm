import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  PageHeader,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  FormActions,
  Input,
  Select,
  TabBar,
  Textarea,
} from '../components/ui'
import Attachments from '../components/Attachments'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useToast } from '../components/Toast'
import { errorMessage } from '../lib/errorMessage'
import { localToday } from '../lib/format'

const FREQ = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }
const KIND = { visitor: 'Visitor', vehicle: 'Vehicle', disinfection: 'Disinfection', other: 'Other' }

export default function CompliancePage() {
  return (
    <ProtectedRoute>
      <Layout title="Compliance">
        <Compliance />
      </Layout>
    </ProtectedRoute>
  )
}

function Compliance() {
  const { activeLocation, activeLocationId } = useLocation()
  const [tab, setTab] = useState('checklists')
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Compliance"
        description={`Checklists and the biosecurity log for ${activeLocation?.name || 'this site'}. Switch site from the site picker.`}
      />
      <TabBar
        tabs={[
          { id: 'checklists', label: 'Checklists' },
          { id: 'biosecurity', label: 'Biosecurity log' },
          { id: 'history', label: 'History' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {!activeLocationId ? (
        <EmptyState title="No site selected" description="Create or pick a farm site first." />
      ) : tab === 'checklists' ? (
        <Checklists locationId={activeLocationId} />
      ) : tab === 'biosecurity' ? (
        <Biosecurity locationId={activeLocationId} />
      ) : (
        <History locationId={activeLocationId} />
      )}
    </div>
  )
}

function Checklists({ locationId }) {
  const { user, hasRole } = useAuth()
  const isAdmin = hasRole?.('admin')
  const { showToast } = useToast()
  const today = localToday()
  const due = useQuery(api.compliance.due, user ? { locationId, today } : 'skip')
  const templates = useQuery(api.compliance.listTemplates, user ? {} : 'skip')
  const seed = useMutation(api.compliance.seedDefaultTemplates)
  const [open, setOpen] = useState(null)

  if (due === undefined || templates === undefined) return <p className="text-sm text-muted">Loading checklists…</p>

  if (templates.length === 0) {
    return (
      <EmptyState
        title="No checklists yet"
        description="Start with the standard ones: daily biosecurity, weekly net inspection and monthly water quality review."
        action={
          isAdmin ? (
            <Button
              onClick={async () => {
                try {
                  const { added } = await seed({})
                  showToast('success', `${added.length} checklists added`)
                } catch (err) {
                  showToast('error', errorMessage(err))
                }
              }}
            >
              Add standard checklists
            </Button>
          ) : null
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {due.length === 0 && <p className="text-sm text-muted">Every checklist is switched off.</p>}
      {due.map((d) => (
        <Card key={d.template.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-medium text-chart-ink">{d.template.name}</h2>
              <p className="text-sm text-muted">
                {FREQ[d.template.frequency]} · {d.period}
                {d.done
                  ? ` · done ${d.done.completed_on}${d.done.passed ? '' : ', with issues'}`
                  : d.last_completed_on
                    ? ` · due (last done ${d.last_completed_on})`
                    : ' · due'}
              </p>
            </div>
            {!d.done && open !== d.template.id && (
              <Button size="sm" onClick={() => setOpen(d.template.id)}>
                Complete
              </Button>
            )}
            {d.done && (
              <span className={`text-sm font-medium ${d.done.passed ? 'text-kelp' : 'text-signal'}`}>
                {d.done.passed ? 'Done' : 'Done with issues'}
              </span>
            )}
          </div>
          {open === d.template.id && (
            <CompleteForm template={d.template} locationId={locationId} onDone={() => setOpen(null)} />
          )}
        </Card>
      ))}
    </div>
  )
}

function CompleteForm({ template, locationId, onDone }) {
  const { showToast } = useToast()
  const complete = useMutation(api.compliance.complete)
  const [date, setDate] = useState(localToday())
  const [answers, setAnswers] = useState(() =>
    Object.fromEntries(template.items.map((i) => [i.id, { ok: true, note: '' }])),
  )
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const setAnswer = (id, patch) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await complete({
        templateId: template.id,
        locationId,
        date,
        answers: template.items.map((i) => ({
          itemId: i.id,
          ok: answers[i.id].ok,
          note: answers[i.id].note.trim() || undefined,
        })),
        notes: notes.trim() || undefined,
      })
      showToast(res.passed ? 'success' : 'warning', res.passed ? 'Checklist saved' : 'Checklist saved with issues')
      onDone()
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not save the checklist'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-5 space-y-5">
      <Field label="Date" htmlFor={`c-date-${template.id}`} required className="max-w-xs">
        <Input id={`c-date-${template.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-chart-ink mb-1">Items</legend>
        {template.items.map((i) => (
          <div key={i.id} className="rounded-lg border border-foam-deep p-3 space-y-2">
            <p className="text-sm text-chart-ink">{i.label}</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2 min-h-11 sm:min-h-0">
                <input type="radio" name={`item-${i.id}`} checked={answers[i.id].ok} onChange={() => setAnswer(i.id, { ok: true })} />
                OK
              </label>
              <label className="inline-flex items-center gap-2 min-h-11 sm:min-h-0">
                <input type="radio" name={`item-${i.id}`} checked={!answers[i.id].ok} onChange={() => setAnswer(i.id, { ok: false })} />
                Not OK
              </label>
            </div>
            {!answers[i.id].ok && (
              <Input
                aria-label={`What was wrong: ${i.label}`}
                placeholder="What was wrong and what was done"
                value={answers[i.id].note}
                onChange={(e) => setAnswer(i.id, { note: e.target.value })}
              />
            )}
          </div>
        ))}
      </fieldset>
      <Field label="Notes" htmlFor={`c-notes-${template.id}`}>
        <Textarea id={`c-notes-${template.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <FormActions>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save checklist'}
        </Button>
      </FormActions>
    </form>
  )
}

const BIO_EMPTY = {
  kind: 'visitor',
  person: '',
  organisation: '',
  vehicle: '',
  purpose: '',
  area: '',
  disinfectant: '',
  entryControlsDone: true,
  notes: '',
}

function Biosecurity({ locationId }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const rows = useQuery(api.compliance.listBiosecurity, user ? { locationId } : 'skip')
  const log = useMutation(api.compliance.logBiosecurity)
  const [date, setDate] = useState(localToday())
  const [form, setForm] = useState(BIO_EMPTY)
  const [saving, setSaving] = useState(false)
  const [docsFor, setDocsFor] = useState(null)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await log({
        locationId,
        date,
        kind: form.kind,
        person: form.person || undefined,
        organisation: form.organisation || undefined,
        vehicle: form.vehicle || undefined,
        purpose: form.purpose || undefined,
        area: form.area || undefined,
        disinfectant: form.disinfectant || undefined,
        entryControlsDone: form.kind === 'disinfection' ? undefined : form.entryControlsDone,
        notes: form.notes || undefined,
      })
      showToast('success', 'Entry logged')
      setForm({ ...BIO_EMPTY, kind: form.kind })
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not log the entry'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="New entry" />
        <form onSubmit={submit} noValidate className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date" htmlFor="b-date" required>
              <Input id="b-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Type" htmlFor="b-kind" required>
              <Select id="b-kind" value={form.kind} onChange={set('kind')}>
                {Object.entries(KIND).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            {(form.kind === 'visitor' || form.kind === 'vehicle' || form.kind === 'other') && (
              <Field label={form.kind === 'vehicle' ? 'Driver' : 'Name'} htmlFor="b-person" required={form.kind === 'visitor'}>
                <Input id="b-person" value={form.person} onChange={set('person')} />
              </Field>
            )}
            {form.kind !== 'disinfection' && (
              <Field label="Organisation" htmlFor="b-org">
                <Input id="b-org" value={form.organisation} onChange={set('organisation')} />
              </Field>
            )}
            {(form.kind === 'vehicle' || form.kind === 'visitor') && (
              <Field label="Vehicle registration" htmlFor="b-vehicle" required={form.kind === 'vehicle'}>
                <Input id="b-vehicle" value={form.vehicle} onChange={set('vehicle')} />
              </Field>
            )}
            {form.kind !== 'disinfection' && (
              <Field label="Purpose" htmlFor="b-purpose">
                <Input id="b-purpose" value={form.purpose} onChange={set('purpose')} />
              </Field>
            )}
            {(form.kind === 'disinfection' || form.kind === 'other') && (
              <Field label="Area or equipment" htmlFor="b-area" required={form.kind === 'disinfection'}>
                <Input id="b-area" value={form.area} onChange={set('area')} />
              </Field>
            )}
            {form.kind === 'disinfection' && (
              <Field label="Disinfectant and strength" htmlFor="b-dis">
                <Input id="b-dis" value={form.disinfectant} onChange={set('disinfectant')} />
              </Field>
            )}
            {form.kind !== 'disinfection' && (
              <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm min-h-11">
                <input
                  type="checkbox"
                  checked={form.entryControlsDone}
                  onChange={(e) => setForm((p) => ({ ...p, entryControlsDone: e.target.checked }))}
                />
                Footbath, wheel dip and hand wash done on entry
              </label>
            )}
            <Field label="Notes" htmlFor="b-notes" className="sm:col-span-2">
              <Textarea id="b-notes" rows={2} value={form.notes} onChange={set('notes')} />
            </Field>
          </div>
          <FormActions>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Log entry'}
            </Button>
          </FormActions>
        </form>
      </Card>

      <Card padding={false}>
        {rows === undefined ? (
          <p className="p-6 text-sm text-muted">Loading log…</p>
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing logged at this site yet" />
        ) : (
          <ul className="divide-y divide-foam-deep">
            {rows.map((r) => (
              <li key={r.id} className="px-4 sm:px-6 py-3 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm">
                    <span className="text-muted tabular-nums">{r.date}</span>{' '}
                    <span className="font-medium">{KIND[r.kind]}</span>{' '}
                    {[r.person, r.organisation, r.vehicle, r.area, r.disinfectant, r.purpose].filter(Boolean).join(' · ')}
                    {r.entry_controls_done === false && <span className="text-signal"> · entry controls not done</span>}
                  </p>
                  <button
                    type="button"
                    className="text-sm text-lake hover:underline"
                    aria-expanded={docsFor === r.id}
                    onClick={() => setDocsFor(docsFor === r.id ? null : r.id)}
                  >
                    Documents
                  </button>
                </div>
                {r.notes && <p className="text-sm text-muted">{r.notes}</p>}
                {docsFor === r.id && <Attachments entityType="biosecurityLogs" entityId={r.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function History({ locationId }) {
  const { user } = useAuth()
  const rows = useQuery(api.compliance.listRecords, user ? { locationId } : 'skip')
  const [openId, setOpenId] = useState(null)
  if (rows === undefined) return <p className="text-sm text-muted">Loading history…</p>
  if (rows.length === 0) return <EmptyState title="No checklists completed at this site yet" />
  return (
    <Card padding={false}>
      <ul className="divide-y divide-foam-deep">
        {rows.map((r) => (
          <li key={r.id} className="px-4 sm:px-6 py-3 space-y-2">
            <button
              type="button"
              className="w-full flex flex-wrap items-baseline justify-between gap-2 text-left"
              aria-expanded={openId === r.id}
              onClick={() => setOpenId(openId === r.id ? null : r.id)}
            >
              <span className="text-sm">
                <span className="font-medium">{r.template_name}</span>{' '}
                <span className="text-muted">
                  {r.period} · {r.completed_on} · {r.completed_by}
                </span>
              </span>
              <span className={`text-sm font-medium ${r.passed ? 'text-kelp' : 'text-signal'}`}>
                {r.passed ? 'Passed' : 'Issues'}
              </span>
            </button>
            {openId === r.id && (
              <div className="space-y-3">
                <ul className="text-sm space-y-1">
                  {r.answers.map((a, i) => (
                    <li key={i}>
                      <span className={a.ok ? 'text-kelp' : 'text-signal'}>{a.ok ? 'OK' : 'Not OK'}</span> · {a.label}
                      {a.note ? <span className="text-muted"> — {a.note}</span> : null}
                    </li>
                  ))}
                </ul>
                {r.notes && <p className="text-sm text-muted">{r.notes}</p>}
                <Attachments entityType="complianceRecords" entityId={r.id} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
