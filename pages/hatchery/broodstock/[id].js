import { useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import { Button, Card, CardHeader, Field, Input, PageHeader, Select, StatCard } from '../../../components/ui'
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

export default function BroodstockDetailPage() {
  return (
    <ProtectedRoute>
      <Layout title="Broodstock">
        <BroodstockDetail />
      </Layout>
    </ProtectedRoute>
  )
}

function BroodstockDetail() {
  const { query } = useRouter()
  const { user } = useAuth()
  const { showToast } = useToast()
  const id = typeof query.id === 'string' ? query.id : null
  const b = useQuery(api.hatchery.getBroodstock, user && id ? { id } : 'skip')
  const units = useQuery(api.nursery.nurseryUnits, user ? {} : 'skip')
  const update = useMutation(api.hatchery.updateBroodstock)
  const [edit, setEdit] = useState(null)
  const [saving, setSaving] = useState(false)

  if (b === undefined) return <p className="text-sm text-muted">Loading…</p>

  const startEdit = () =>
    setEdit({ status: b.status, weightG: b.weight_g ?? '', unitId: b.unit_id ?? '', count: String(b.count) })
  const set = (k) => (e) => setEdit((p) => ({ ...p, [k]: e.target.value }))
  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await update({
        id: b.id,
        status: edit.status,
        weightG: num(edit.weightG),
        unitId: edit.unitId || undefined,
        count: b.kind === 'group' ? num(edit.count) : undefined,
      })
      showToast('success', 'Saved')
      setEdit(null)
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        breadcrumbs={[{ label: 'Hatchery', href: '/hatchery' }, { label: 'Broodstock', href: '/hatchery/broodstock' }, { label: b.code }]}
        title={b.code}
        description={[
          b.kind === 'group' ? `Group of ${fmt(b.count)}` : 'Individual',
          SEX_LABEL[b.sex],
          b.species,
          b.strain,
          ORIGIN_LABEL[b.origin] + (b.origin_note ? ` (${b.origin_note})` : ''),
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={!edit && <Button variant="secondary" onClick={startEdit}>Edit</Button>}
      />
      <HatcheryNav />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Status" value={STATUS_LABEL[b.status]} tone={statusTone(b.status) === 'warn' ? 'warn' : 'default'} />
        <StatCard label={b.kind === 'group' ? 'Mean weight' : 'Weight'} value={fmt(b.weight_g)} unit="g" hint={b.total_kg ? `${fmt(b.total_kg, 2)} kg in total` : undefined} />
        <StatCard label="Spawnings" value={fmt(b.spawn_count)} hint={b.last_spawned_on ? `last ${b.last_spawned_on}` : undefined} />
        <StatCard label="Tank" value={b.unit_name || '—'} hint={b.conditioning_started_on ? `conditioning since ${b.conditioning_started_on}` : undefined} />
      </div>

      {edit && (
        <Card className="mb-6">
          <form onSubmit={save} noValidate className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <Field label="Status" htmlFor="e-status">
              <Select id="e-status" value={edit.status} onChange={set('status')}>
                {Object.entries(STATUS_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Weight (g)" htmlFor="e-w">
              <Input id="e-w" type="number" inputMode="decimal" value={edit.weightG} onChange={set('weightG')} />
            </Field>
            {b.kind === 'group' && (
              <Field label="Fish in group" htmlFor="e-c">
                <Input id="e-c" type="number" inputMode="numeric" value={edit.count} onChange={set('count')} />
              </Field>
            )}
            <Field label="Tank" htmlFor="e-u">
              <Select id="e-u" value={edit.unitId} onChange={set('unitId')}>
                <option value="">Not assigned</option>
                {(units || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" onClick={() => setEdit(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title="Spawning history" />
        {b.spawnings.length === 0 ? (
          <p className="text-sm text-muted">No spawnings yet.</p>
        ) : (
          <ul className="divide-y divide-foam-deep -my-2">
            {b.spawnings.map((s) => (
              <li key={s.id} className="py-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium text-chart-ink">
                    {s.spawn_date} · {s.female_codes.join(', ')}
                    {s.male_codes.length ? ` × ${s.male_codes.join(', ')}` : ''}
                  </p>
                  <p className="text-sm text-muted">
                    {[
                      s.hormone ? `${s.hormone}${s.hormone_dose ? ` ${s.hormone_dose}` : ''}` : s.method,
                      s.eggs_collected != null ? `${fmt(s.eggs_collected)} eggs` : null,
                      s.larvae ? `${fmt(s.larvae)} larvae` : null,
                      s.fry_per_kg_female != null ? `${fmt(s.fry_per_kg_female)} fry/kg female` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <Pill tone={statusTone(s.status)}>{s.status}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {b.notes && <p className="text-sm text-muted mt-4">{b.notes}</p>}
    </div>
  )
}
