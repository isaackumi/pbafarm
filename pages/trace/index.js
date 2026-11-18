import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import {
  PageHeader,
  Button,
  Card,
  EmptyState,
  Field,
  FormActions,
  FormCard,
  FormSection,
  Input,
  Select,
  StatCard,
  Textarea,
} from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'

const fmt = (v, dp = 1) =>
  v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp })

const EMPTY = { harvestId: '', weightKg: '', fishCount: '', grade: '', destination: '', lotCode: '', notes: '' }

export default function HarvestLotsPage() {
  return (
    <ProtectedRoute>
      <Layout title="Harvest lots">
        <HarvestLots />
      </Layout>
    </ProtectedRoute>
  )
}

function HarvestLots() {
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const { showToast } = useToast()
  const lots = useQuery(api.traceability.listLots, user ? {} : 'skip')
  const harvests = useQuery(api.harvest.list, user ? locationArgs : 'skip')
  const createLot = useMutation(api.traceability.createLot)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  // Weight of each harvest already put into lots.
  const lotted = useMemo(() => {
    const m = new Map()
    for (const l of lots || []) m.set(l.harvest_id, (m.get(l.harvest_id) || 0) + l.weight_kg)
    return m
  }, [lots])
  const open = useMemo(
    () =>
      (harvests || [])
        .filter((h) => h.source !== 'sampling_page')
        .map((h) => ({ ...h, left: Math.max(0, h.total_weight - (lotted.get(h.id) || 0)) }))
        .filter((h) => h.left > 0.05)
        .slice(0, 100),
    [harvests, lotted],
  )
  const selected = open.find((h) => h.id === form.harvestId) || null

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (!form.harvestId) throw new Error('Pick a harvest')
      const weightKg = Number(form.weightKg || selected?.left)
      if (!(weightKg > 0)) throw new Error('Enter the lot weight')
      const res = await createLot({
        harvestId: form.harvestId,
        weightKg,
        fishCount: form.fishCount ? Number(form.fishCount) : undefined,
        grade: form.grade.trim() || undefined,
        destination: form.destination.trim() || undefined,
        lotCode: form.lotCode.trim() || undefined,
        notes: form.notes.trim() || undefined,
      })
      showToast('success', `Lot ${res.lotCode} created`)
      setForm(EMPTY)
      setShowForm(false)
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not create the lot'))
    } finally {
      setSaving(false)
    }
  }

  const rows = lots || []
  const inStock = rows.reduce((s, l) => s + l.remaining_kg, 0)
  const sent = rows.reduce((s, l) => s + l.dispatched_kg, 0)

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Harvest lots"
        description="Each lot is a traceable part of a harvest. Open a lot to dispatch it and print its trace report."
        actions={
          !showForm && (
            <Button onClick={() => setShowForm(true)} disabled={!open.length}>
              New lot
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Lots" value={fmt(rows.length, 0)} />
        <StatCard label="Not yet dispatched" value={fmt(inStock)} unit="kg" />
        <StatCard label="Dispatched" value={fmt(sent)} unit="kg" />
      </div>

      {showForm && (
        <FormCard>
          <form onSubmit={submit} noValidate className="space-y-6">
            <FormSection title="New lot" description="Leave the code blank to number it from the batch and harvest date.">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Harvest" htmlFor="lot-harvest" required className="md:col-span-2">
                  <Select id="lot-harvest" value={form.harvestId} onChange={set('harvestId')}>
                    <option value="">Select a harvest</option>
                    {open.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.harvest_date} · {h.cage?.name} · {fmt(h.left)} kg not in a lot
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Weight (kg)" htmlFor="lot-weight" required hint={selected ? `Up to ${fmt(selected.left)} kg` : undefined}>
                  <Input
                    id="lot-weight"
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    value={form.weightKg}
                    placeholder={selected ? String(Math.round(selected.left * 10) / 10) : ''}
                    onChange={set('weightKg')}
                    className="tabular-nums"
                  />
                </Field>
                <Field label="Fish count" htmlFor="lot-count">
                  <Input id="lot-count" type="number" inputMode="numeric" value={form.fishCount} onChange={set('fishCount')} className="tabular-nums" />
                </Field>
                <Field label="Grade" htmlFor="lot-grade" hint="For example Reg, S1 or Eco">
                  <Input id="lot-grade" value={form.grade} onChange={set('grade')} />
                </Field>
                <Field label="Destination" htmlFor="lot-destination" hint="Market, processor or cold store">
                  <Input id="lot-destination" value={form.destination} onChange={set('destination')} />
                </Field>
                <Field label="Lot code" htmlFor="lot-code">
                  <Input id="lot-code" value={form.lotCode} onChange={set('lotCode')} placeholder="Automatic" />
                </Field>
                <Field label="Notes" htmlFor="lot-notes" className="md:col-span-2">
                  <Textarea id="lot-notes" rows={2} value={form.notes} onChange={set('notes')} />
                </Field>
              </div>
            </FormSection>
            <FormActions>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Create lot'}
              </Button>
            </FormActions>
          </form>
        </FormCard>
      )}

      <Card padding={false}>
        {lots === undefined ? (
          <p className="p-6 text-sm text-muted">Loading lots…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No harvest lots yet"
            description="Record a harvest, then split it into lots here so every sale can be traced back to its cage, feed and treatments."
          />
        ) : (
          <ul className="divide-y divide-foam-deep">
            {rows.map((l) => (
              <li key={l.id} className="px-4 sm:px-6 py-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <Link href={`/trace/${l.id}`} className="font-medium text-lake hover:underline font-data">
                    {l.lot_code}
                  </Link>
                  <p className="text-sm text-muted">
                    {[l.harvest_date, l.cage_name, l.grade, l.destination].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <p className="text-sm tabular-nums text-chart-ink">
                  {fmt(l.weight_kg)} kg
                  <span className="text-muted">
                    {l.dispatched_kg > 0 ? ` · ${fmt(l.dispatched_kg)} kg dispatched` : ' · not dispatched'}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
