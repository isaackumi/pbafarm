import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import UnitTabs from '../../../components/UnitTabs'
import WaterQualityForm from '../../../components/WaterQualityForm'
import { Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Textarea } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../convex/_generated/api'
import { WQ_PARAMETERS } from '../../../convex/lib/waterQuality'
import { errorMessage } from '../../../lib/errorMessage'
import { localToday, unitLabel } from '../../../lib/format'

const WaterQualityChart = dynamic(() => import('../../../components/charts/WaterQualityChart'), {
  ssr: false,
  loading: () => <div className="h-full grid place-items-center text-sm text-muted">Loading chart…</div>,
})

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

const SOURCE_LABEL = {
  manual: 'Logged',
  sensor: 'Sensor',
  daily_record: 'Daily entry',
  biweekly_record: 'Sampling',
}

const EVENT_KINDS = [
  { value: 'exchange', label: 'Water exchange' },
  { value: 'fill', label: 'Fill' },
  { value: 'drain', label: 'Drain' },
  { value: 'liming', label: 'Liming' },
  { value: 'fertilization', label: 'Fertilization' },
  { value: 'treatment', label: 'Water treatment' },
  { value: 'aeration', label: 'Aeration' },
  { value: 'other', label: 'Other' },
]

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }))

function WaterEventForm({ unitId }) {
  const { showToast } = useToast()
  const log = useMutation(api.waterQuality.logWaterEvent)
  const items = useQuery(api.inventoryItems.listItems, {})
  const [form, setForm] = useState({
    date: localToday(), kind: 'exchange', exchangePct: '', volumeM3: '', hours: '', product: '', quantity: '', quantityUnit: '', inventoryItemId: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const n = (s) => (s === '' ? undefined : Number(s))
  const usesProduct = ['liming', 'fertilization', 'treatment', 'other'].includes(form.kind)

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await log({
        unitId,
        date: form.date,
        kind: form.kind,
        exchangePct: n(form.exchangePct),
        volumeM3: n(form.volumeM3),
        hours: n(form.hours),
        product: form.product.trim() || undefined,
        quantity: n(form.quantity),
        quantityUnit: form.quantityUnit.trim() || undefined,
        inventoryItemId: form.inventoryItemId || undefined,
        notes: form.notes.trim() || undefined,
      })
      showToast('Water event saved', 'success')
      setForm((f) => ({ ...f, exchangePct: '', volumeM3: '', hours: '', product: '', quantity: '', notes: '' }))
    } catch (err) {
      showToast(errorMessage(err, 'Could not save the event'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const itemList = Array.isArray(items) ? items : items?.items || []

  return (
    <form onSubmit={submit} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <Field label="Date" htmlFor="we-date">
        <Input id="we-date" type="date" value={form.date} max={localToday()} onChange={set('date')} />
      </Field>
      <Field label="Event" htmlFor="we-kind">
        <Select id="we-kind" value={form.kind} onChange={set('kind')}>
          {EVENT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </Select>
      </Field>
      {['exchange', 'fill', 'drain'].includes(form.kind) && (
        <>
          {form.kind === 'exchange' && (
            <Field label="Exchanged (%)" htmlFor="we-pct">
              <Input id="we-pct" type="number" step="any" min="0" max="100" inputMode="decimal" value={form.exchangePct} onChange={set('exchangePct')} />
            </Field>
          )}
          <Field label="Volume (m³)" htmlFor="we-vol">
            <Input id="we-vol" type="number" step="any" min="0" inputMode="decimal" value={form.volumeM3} onChange={set('volumeM3')} />
          </Field>
        </>
      )}
      {form.kind === 'aeration' && (
        <Field label="Hours run" htmlFor="we-hours">
          <Input id="we-hours" type="number" step="any" min="0" inputMode="decimal" value={form.hours} onChange={set('hours')} />
        </Field>
      )}
      {usesProduct && (
        <>
          <Field label="From inventory" htmlFor="we-item" hint="Issues the quantity from stock">
            <Select id="we-item" value={form.inventoryItemId} onChange={set('inventoryItemId')}>
              <option value="">Not from inventory</option>
              {itemList.map((i) => (
                <option key={i._id || i.id} value={i._id || i.id}>{i.name}</option>
              ))}
            </Select>
          </Field>
          {!form.inventoryItemId && (
            <Field label="Product" htmlFor="we-product">
              <Input id="we-product" value={form.product} onChange={set('product')} placeholder="Agricultural lime" />
            </Field>
          )}
          <Field label="Quantity" htmlFor="we-qty">
            <Input id="we-qty" type="number" step="any" min="0" inputMode="decimal" value={form.quantity} onChange={set('quantity')} />
          </Field>
          {!form.inventoryItemId && (
            <Field label="Unit" htmlFor="we-qunit">
              <Input id="we-qunit" value={form.quantityUnit} onChange={set('quantityUnit')} placeholder="kg" />
            </Field>
          )}
        </>
      )}
      <Field label="Notes" htmlFor="we-notes" className="col-span-2 sm:col-span-3">
        <Textarea id="we-notes" rows={2} value={form.notes} onChange={set('notes')} />
      </Field>
      <div className="col-span-2 sm:col-span-3">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save event'}</Button>
      </div>
    </form>
  )
}

function WaterPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { showToast } = useToast()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  const [days, setDays] = useState(30)
  // A stable "since" per range choice; refreshes when the range changes.
  const since = useMemo(() => Date.now() - days * 86400000, [days])
  const ws = useQuery(api.units.workspace, user && id ? { id } : 'skip')
  const log = useQuery(api.waterQuality.listForUnit, user && id ? { unitId: id, since } : 'skip')
  const events = useQuery(api.waterQuality.listWaterEvents, user && id ? { unitId: id } : 'skip')
  const treatments = useQuery(api.health.list, user && id ? { cageId: id } : 'skip')
  const record = useMutation(api.waterQuality.record)
  const [param, setParam] = useState('dissolvedOxygen')

  const points = useMemo(
    () =>
      (log?.rows || [])
        .filter((r) => r.values[param] != null)
        .map((r) => ({ t: r.measuredAt, v: r.values[param] }))
        .reverse(),
    [log, param],
  )
  const present = useMemo(() => {
    const s = new Set()
    for (const r of log?.rows || []) for (const k of Object.keys(r.values)) s.add(k)
    return Object.keys(WQ_PARAMETERS).filter((k) => s.has(k))
  }, [log])

  if (ws === undefined || !id) {
    return <Layout title="Water quality"><p className="text-muted p-6">Loading…</p></Layout>
  }
  if (ws === null) {
    return <Layout title="Water quality"><EmptyState title="Unit not found" action={<Button href="/units">All units</Button>} /></Layout>
  }
  const unit = ws.unit
  const spec = WQ_PARAMETERS[param]
  const range = log?.thresholds?.[param]
  const isPond = ws.unitType === 'pond' || ws.unitType === 'hapa'

  const save = async ({ values, notes, measuredAt }) => {
    try {
      const res = await record({ unitId: id, ...values, notes, measuredAt })
      if (res.breaches.length) {
        showToast(`Saved. Out of range: ${res.breaches.map((b) => b.label).join(', ')}`, 'warning')
      } else {
        showToast('Reading saved', 'success')
      }
      return true
    } catch (err) {
      showToast(errorMessage(err, 'Could not save the reading'), 'error')
      return false
    }
  }

  return (
    <Layout title={`${unit.name} water`}>
      <div className="max-w-5xl space-y-6">
        <PageHeader
          title={unit.name}
          breadcrumbs={[
            { label: 'Units', href: '/units' },
            { label: unit.name, href: `/cages/${id}` },
            { label: 'Water' },
          ]}
          description={`${unitLabel(ws.unitType)} · thresholds for ${unitLabel(ws.unitType, { plural: true }).toLowerCase()}`}
        />
        <UnitTabs unitId={id} active="water" unitType={ws.unitType} />

        <Card>
          <CardHeader
            title="Trend"
            action={
              <div className="flex flex-wrap gap-2">
                <Select aria-label="Parameter" value={param} onChange={(e) => setParam(e.target.value)} className="w-auto">
                  {(present.length ? present : ['dissolvedOxygen']).map((k) => (
                    <option key={k} value={k}>{WQ_PARAMETERS[k].label}</option>
                  ))}
                </Select>
                <Select aria-label="Range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-auto">
                  {RANGES.map((r) => (
                    <option key={r.days} value={r.days}>{r.label}</option>
                  ))}
                </Select>
              </div>
            }
          />
          {points.length < 2 ? (
            <p className="text-sm text-muted">
              {points.length === 0 ? 'No readings of this parameter in this period.' : 'One reading so far; the trend appears with the next.'}
            </p>
          ) : (
            <div className="h-64">
              <WaterQualityChart points={points} range={range} unit={spec.unit} label={spec.label} />
            </div>
          )}
          {range && (
            <p className="mt-2 text-xs text-muted">
              Threshold: {range.min != null ? `min ${range.min}` : ''}
              {range.min != null && range.max != null ? ', ' : ''}
              {range.max != null ? `max ${range.max}` : ''} {spec.unit}
            </p>
          )}
        </Card>

        <Card>
          <CardHeader title="Log a reading" subtitle="Saved readings are checked against the thresholds right away." />
          <WaterQualityForm unitType={ws.unitType} onSave={save} />
        </Card>

        <Card padding={false}>
          <div className="px-5 py-4 border-b border-foam-deep">
            <h2 className="font-display text-lg font-medium">Readings</h2>
          </div>
          {!log ? (
            <p className="p-5 text-sm text-muted">Loading…</p>
          ) : log.rows.length === 0 ? (
            <EmptyState title="No readings in this period" description="Log one above, or capture DO and temperature on the daily entry." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-foam-deep">
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                    {present.map((k) => (
                      <th key={k} className="px-3 py-2 font-medium text-right whitespace-nowrap">
                        {WQ_PARAMETERS[k].short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-foam-deep">
                  {log.rows.slice(0, 100).map((r) => {
                    const bad = new Set(r.breaches.map((b) => b.parameter))
                    return (
                      <tr key={r.id}>
                        <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                          {r.date && r.source !== 'manual' ? r.date : new Date(r.measuredAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-muted">{SOURCE_LABEL[r.source]}</td>
                        {present.map((k) => (
                          <td key={k} className={`px-3 py-2 text-right tabular-nums ${bad.has(k) ? 'text-signal font-medium' : ''}`}>
                            {fmt(r.values[k])}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title={isPond ? 'Water management' : 'Water events'}
            subtitle="Exchanges, liming, fertilization and water treatments for this unit."
          />
          <WaterEventForm unitId={id} />
          {events && events.length > 0 && (
            <ul className="mt-5 divide-y divide-foam-deep text-sm">
              {events.map((e) => (
                <li key={e._id} className="py-2 flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="tabular-nums">{e.date}</span>{' '}
                    <span className="font-medium">{EVENT_KINDS.find((k) => k.value === e.kind)?.label || e.kind}</span>
                    {e.product ? ` · ${e.product}` : ''}
                  </span>
                  <span className="text-muted tabular-nums">
                    {e.exchangePct ? `${e.exchangePct}% ` : ''}
                    {e.volumeM3 ? `${fmt(e.volumeM3)} m³ ` : ''}
                    {e.quantity ? `${fmt(e.quantity)} ${e.quantityUnit || ''}` : ''}
                    {e.hours ? `${fmt(e.hours)} h` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padding={false}>
          <div className="px-5 py-4 border-b border-foam-deep flex flex-wrap justify-between gap-2">
            <h2 className="font-display text-lg font-medium">Health treatments</h2>
            <Button size="sm" variant="secondary" href="/health">Record treatment</Button>
          </div>
          {!treatments || treatments.length === 0 ? (
            <p className="p-5 text-sm text-muted">No treatments recorded for this unit.</p>
          ) : (
            <ul className="divide-y divide-foam-deep text-sm">
              {treatments.slice(0, 20).map((tr) => (
                <li key={tr.id || tr._id} className="px-5 py-2 flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="tabular-nums">{tr.date}</span> {tr.treatment}
                    {tr.product_name ? ` · ${tr.product_name}` : ''}
                  </span>
                  {tr.withdrawal_until && <span className="text-muted">Withdrawal until {tr.withdrawal_until}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Layout>
  )
}

export default function UnitWaterPage() {
  return (
    <ProtectedRoute>
      <WaterPage />
    </ProtectedRoute>
  )
}
