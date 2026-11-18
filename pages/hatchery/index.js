import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, StatCard } from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'
import { HatcheryNav, Pill, fmt, num, statusTone, today } from '../../components/hatchery/common'

export default function HatcheryPage() {
  return (
    <ProtectedRoute>
      <Layout title="Hatchery">
        <HatcheryOverview />
      </Layout>
    </ProtectedRoute>
  )
}

function HatcheryOverview() {
  const { user } = useAuth()
  const kpis = useQuery(api.hatchery.kpis, user ? {} : 'skip')
  const board = useQuery(api.hatchery.incubationBoard, user ? {} : 'skip')
  const spawnings = useQuery(api.hatchery.listSpawnings, user ? { limit: 10 } : 'skip')
  const k = kpis || {}
  const incubating = (board || []).filter((l) => l.status === 'incubating')
  const recent = (board || []).filter((l) => l.status !== 'incubating').slice(0, 8)

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Hatchery"
        description="Broodstock, spawnings, incubation and larvae. A hatch opens a batch whose lineage follows the fish to harvest."
        actions={<Button href="/hatchery/spawning">Record a spawning</Button>}
      />
      <HatcheryNav />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Eggs incubating" value={fmt(k.eggs_incubating)} hint={`${fmt(k.lots_incubating)} lots`} />
        <StatCard label="Fertilization" value={fmt(k.fertilization_pct, 1)} unit="%" />
        <StatCard label="Hatch rate" value={fmt(k.hatch_rate_pct, 1)} unit="%" tone="accent" />
        <StatCard label="Larval survival" value={fmt(k.larval_survival_pct, 1)} unit="%" />
        <StatCard label="Larvae hatched" value={fmt(k.larvae_hatched)} hint={`${fmt(k.spawnings)} spawnings`} />
        <StatCard label="Fry per kg female" value={fmt(k.fry_per_kg_female)} />
        <StatCard label="Eggs collected" value={fmt(k.eggs_collected)} />
        <StatCard
          label="Broodstock"
          value={fmt(k.broodstock_total)}
          hint={k.broodstock_by_status ? `${fmt(k.broodstock_by_status.ready || 0)} ready` : undefined}
        />
      </div>

      <Card padding={false} className="mb-6">
        <div className="p-5 sm:p-6 pb-0 sm:pb-0">
          <CardHeader title="Incubation board" subtitle="Lots in incubators now. Record the hatch to stock the larvae." />
        </div>
        {board === undefined ? (
          <p className="p-6 text-sm text-muted">Loading…</p>
        ) : incubating.length === 0 ? (
          <EmptyState
            title="Nothing incubating"
            description="Record a spawning and put its eggs in an incubator to see them here."
            action={<Button href="/hatchery/spawning" variant="secondary">Record a spawning</Button>}
          />
        ) : (
          <ul className="grid gap-4 p-5 sm:p-6 sm:grid-cols-2 lg:grid-cols-3">
            {incubating.map((l) => (
              <IncubationCard key={l.id} lot={l} />
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent spawnings" action={<Link href="/hatchery/spawning" className="text-sm text-lake hover:underline">New</Link>} />
          {spawnings === undefined ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : spawnings.length === 0 ? (
            <p className="text-sm text-muted">No spawnings recorded yet.</p>
          ) : (
            <ul className="divide-y divide-foam-deep -my-2">
              {spawnings.map((s) => (
                <li key={s.id} className="py-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-chart-ink">
                      {s.spawn_date} · {s.female_codes.join(', ')}
                      {s.male_codes.length ? ` × ${s.male_codes.join(', ')}` : ''}
                    </p>
                    <p className="text-sm text-muted">
                      {[
                        s.method === 'induced' ? `Induced, ${s.hormone}` : s.method === 'stripped' ? 'Stripped' : 'Natural',
                        s.eggs_collected != null ? `${fmt(s.eggs_collected)} eggs` : 'eggs not counted',
                        s.fertilization_pct != null ? `${fmt(s.fertilization_pct, 1)} % fertilized` : null,
                        s.hatch_pct != null ? `${fmt(s.hatch_pct, 1)} % hatched` : null,
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
        <Card>
          <CardHeader title="Latest hatches" />
          {recent.length === 0 ? (
            <p className="text-sm text-muted">No hatches yet.</p>
          ) : (
            <ul className="divide-y divide-foam-deep -my-2">
              {recent.map((l) => (
                <li key={l.id} className="py-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-medium text-chart-ink">
                      {l.batch_id ? (
                        <Link href={`/batches/${l.batch_id}`} className="text-lake hover:underline font-data">
                          {l.batch_number}
                        </Link>
                      ) : (
                        l.unit_name
                      )}
                    </p>
                    <p className="text-sm text-muted">
                      {l.hatched_on} · {fmt(l.larvae_count)} larvae from {fmt(l.eggs)} eggs
                    </p>
                  </div>
                  <span className="text-sm tabular-nums">
                    {l.status === 'failed' ? <Pill tone="warn">failed</Pill> : `${fmt(l.hatch_pct, 1)} %`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function IncubationCard({ lot }) {
  const { showToast } = useToast()
  const { user } = useAuth()
  const units = useQuery(api.nursery.nurseryUnits, user ? {} : 'skip')
  const recordHatch = useMutation(api.hatchery.recordHatch)
  const markFailed = useMutation(api.hatchery.markLotFailed)
  const [mode, setMode] = useState(null)
  const [form, setForm] = useState({ date: today(), larvae: '', unitId: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const days = Math.max(0, Math.round((Date.parse(today()) - Date.parse(lot.started_on)) / 86_400_000))
  const emptyUnits = (units || []).filter((u) => u.nursery && (u.count <= 0 || u.id === lot.unit_id))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (mode === 'hatch') {
        const r = await recordHatch({
          lotId: lot.id,
          hatchedOn: form.date,
          larvaeCount: num(form.larvae),
          larvalUnitId: form.unitId || undefined,
        })
        showToast('success', `Batch ${r.batchNumber} opened with ${fmt(num(form.larvae))} larvae`)
      } else {
        await markFailed({ lotId: lot.id, date: form.date, reason: form.reason })
        showToast('success', 'Lot marked failed')
      }
      setMode(null)
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="rounded-lg border border-foam-deep p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium text-chart-ink">{lot.unit_name}</p>
        <span className="text-sm text-muted tabular-nums">day {days}</span>
      </div>
      <p className="text-sm text-muted">
        {fmt(lot.eggs)} eggs · spawned {lot.spawn_date}
        {lot.fertilization_pct != null ? ` · ${fmt(lot.fertilization_pct, 1)} % fertilized` : ''}
      </p>
      {mode == null ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setMode('hatch')}>
            Record hatch
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('fail')}>
            Failed
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3" noValidate>
          <Field label="Date" htmlFor={`d-${lot.id}`}>
            <Input id={`d-${lot.id}`} type="date" value={form.date} onChange={set('date')} />
          </Field>
          {mode === 'hatch' ? (
            <>
              <Field label="Larvae hatched" htmlFor={`n-${lot.id}`} required>
                <Input
                  id={`n-${lot.id}`}
                  type="number"
                  inputMode="numeric"
                  value={form.larvae}
                  onChange={set('larvae')}
                  className="tabular-nums"
                />
              </Field>
              <Field label="Stock larvae in" htmlFor={`u-${lot.id}`} hint="Empty larval tanks; default is this incubator">
                <Select id={`u-${lot.id}`} value={form.unitId} onChange={set('unitId')}>
                  <option value="">{lot.unit_name}</option>
                  {emptyUnits
                    .filter((u) => u.id !== lot.unit_id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </Select>
              </Field>
            </>
          ) : (
            <Field label="Reason" htmlFor={`r-${lot.id}`} required>
              <Input id={`r-${lot.id}`} value={form.reason} onChange={set('reason')} placeholder="Fungus, temperature…" />
            </Field>
          )}
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}
