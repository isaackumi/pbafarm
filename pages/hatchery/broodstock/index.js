import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import {
  Button,
  Card,
  EmptyState,
  Field,
  FormActions,
  FormCard,
  FormSection,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '../../../components/ui'
import { api } from '../../../convex/_generated/api'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/Toast'
import { errorMessage } from '../../../lib/errorMessage'
import {
  HatcheryNav,
  ORIGIN_LABEL,
  Pill,
  SEX_LABEL,
  STATUS_LABEL,
  fmt,
  num,
  statusTone,
} from '../../../components/hatchery/common'

const EMPTY = {
  kind: 'individual',
  code: '',
  pitTag: '',
  sex: 'female',
  count: '',
  weightG: '',
  lengthCm: '',
  speciesCode: '',
  strain: '',
  origin: 'farm',
  originNote: '',
  unitId: '',
  acquiredOn: '',
  conditioning: false,
  notes: '',
}

export default function BroodstockPage() {
  return (
    <ProtectedRoute>
      <Layout title="Broodstock">
        <Broodstock />
      </Layout>
    </ProtectedRoute>
  )
}

function Broodstock() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [status, setStatus] = useState('')
  const rows = useQuery(api.hatchery.listBroodstock, user ? (status ? { status } : {}) : 'skip')
  const units = useQuery(api.nursery.nurseryUnits, user ? {} : 'skip')
  const create = useMutation(api.hatchery.createBroodstock)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await create({
        kind: form.kind,
        code: form.code,
        pitTag: form.pitTag || undefined,
        sex: form.sex,
        count: form.kind === 'group' ? num(form.count) : undefined,
        weightG: num(form.weightG),
        lengthCm: num(form.lengthCm),
        speciesCode: form.speciesCode || undefined,
        strain: form.strain || undefined,
        origin: form.origin,
        originNote: form.originNote || undefined,
        unitId: form.unitId || undefined,
        acquiredOn: form.acquiredOn || undefined,
        status: form.conditioning ? 'conditioning' : undefined,
        conditioningStartedOn: form.conditioning ? new Date().toISOString().slice(0, 10) : undefined,
        notes: form.notes || undefined,
      })
      showToast('success', `${form.code} added`)
      setForm(EMPTY)
      setShowForm(false)
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not add broodstock'))
    } finally {
      setSaving(false)
    }
  }

  const list = rows || []
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Broodstock"
        description="Tagged fish and broodstock groups, where they are and when they last spawned."
        actions={!showForm && <Button onClick={() => setShowForm(true)}>Add broodstock</Button>}
      />
      <HatcheryNav />

      {showForm && (
        <FormCard className="mb-6">
          <form onSubmit={submit} noValidate className="space-y-6">
            <FormSection title="New broodstock" description="One tagged fish, or a group kept and spawned together.">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Record" htmlFor="b-kind">
                  <Select id="b-kind" value={form.kind} onChange={set('kind')}>
                    <option value="individual">Individual fish</option>
                    <option value="group">Group</option>
                  </Select>
                </Field>
                <Field label={form.kind === 'group' ? 'Group name' : 'Tag'} htmlFor="b-code" required>
                  <Input id="b-code" value={form.code} onChange={set('code')} placeholder={form.kind === 'group' ? 'F-GROUP-A' : 'F-001'} />
                </Field>
                <Field label="Sex" htmlFor="b-sex">
                  <Select id="b-sex" value={form.sex} onChange={set('sex')}>
                    {Object.entries(SEX_LABEL)
                      .filter(([k]) => form.kind === 'group' || k !== 'mixed')
                      .map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                  </Select>
                </Field>
                {form.kind === 'group' ? (
                  <Field label="Fish in group" htmlFor="b-count" required>
                    <Input id="b-count" type="number" inputMode="numeric" value={form.count} onChange={set('count')} />
                  </Field>
                ) : (
                  <Field label="PIT tag" htmlFor="b-pit">
                    <Input id="b-pit" value={form.pitTag} onChange={set('pitTag')} />
                  </Field>
                )}
                <Field label={form.kind === 'group' ? 'Mean weight (g)' : 'Weight (g)'} htmlFor="b-w">
                  <Input id="b-w" type="number" inputMode="decimal" value={form.weightG} onChange={set('weightG')} />
                </Field>
                <Field label="Length (cm)" htmlFor="b-l">
                  <Input id="b-l" type="number" inputMode="decimal" value={form.lengthCm} onChange={set('lengthCm')} />
                </Field>
                <Field label="Species" htmlFor="b-sp">
                  <Input id="b-sp" value={form.speciesCode} onChange={set('speciesCode')} placeholder="tilapia" />
                </Field>
                <Field label="Strain" htmlFor="b-st">
                  <Input id="b-st" value={form.strain} onChange={set('strain')} />
                </Field>
                <Field label="Origin" htmlFor="b-o">
                  <Select id="b-o" value={form.origin} onChange={set('origin')}>
                    {Object.entries(ORIGIN_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Source" htmlFor="b-on" hint="Supplier, river or farm">
                  <Input id="b-on" value={form.originNote} onChange={set('originNote')} />
                </Field>
                <Field label="Tank" htmlFor="b-u">
                  <Select id="b-u" value={form.unitId} onChange={set('unitId')}>
                    <option value="">Not assigned</option>
                    {(units || []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Acquired on" htmlFor="b-a">
                  <Input id="b-a" type="date" value={form.acquiredOn} onChange={set('acquiredOn')} />
                </Field>
                <label className="flex items-center gap-2 text-sm md:col-span-2 min-h-11">
                  <input type="checkbox" checked={form.conditioning} onChange={set('conditioning')} className="size-4" />
                  Start conditioning today
                </label>
                <Field label="Notes" htmlFor="b-n" className="md:col-span-2">
                  <Textarea id="b-n" rows={2} value={form.notes} onChange={set('notes')} />
                </Field>
              </div>
            </FormSection>
            <FormActions>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Add broodstock'}
              </Button>
            </FormActions>
          </form>
        </FormCard>
      )}

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Field label="Status" htmlFor="b-filter" className="w-48">
          <Select id="b-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {Object.entries(STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-sm text-muted pb-3">
          {fmt(list.reduce((t, b) => t + b.count, 0))} fish in {fmt(list.length)} records
        </p>
      </div>

      <Card padding={false}>
        {rows === undefined ? (
          <p className="p-6 text-sm text-muted">Loading broodstock…</p>
        ) : list.length === 0 ? (
          <EmptyState title="No broodstock" description="Add your tagged fish or broodstock groups to plan spawnings." />
        ) : (
          <ul className="divide-y divide-foam-deep">
            {list.map((b) => (
              <li key={b.id} className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/hatchery/broodstock/${b.id}`} className="font-medium text-lake hover:underline font-data">
                    {b.code}
                  </Link>
                  <p className="text-sm text-muted">
                    {[
                      SEX_LABEL[b.sex],
                      b.kind === 'group' ? `${fmt(b.count)} fish` : null,
                      b.weight_g ? `${fmt(b.weight_g)} g` : null,
                      b.unit_name,
                      b.last_spawned_on ? `last spawned ${b.last_spawned_on}` : 'not spawned yet',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <Pill tone={statusTone(b.status)}>{STATUS_LABEL[b.status]}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
