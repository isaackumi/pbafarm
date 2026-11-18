import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import OutboxPanel from '../../components/OutboxPanel'
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  FormSection,
  Input,
  PageHeader,
  Select,
  StickyActions,
  TabBar,
  Textarea,
} from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'
import { saveOrQueue } from '../../lib/outboxSenders'
import { cleanError } from '../../lib/offlineOutbox'
import { useOnline } from '../../hooks/useOutbox'
import { HatcheryNav, LIVE_FEED_LABEL, LIVE_FEED_UNIT, Pill, fmt, num, today } from '../../components/hatchery/common'
import { usePermission } from '../../hooks/usePermission'

export default function LarvalPage() {
  return (
    <ProtectedRoute>
      <Layout title="Larvae & fingerlings">
        <Larval />
      </Layout>
    </ProtectedRoute>
  )
}

function Larval() {
  const router = useRouter()
  const { user } = useAuth()
  const [status, setStatus] = useState('active')
  const batches = useQuery(api.nursery.larvalBatches, user ? { status } : 'skip')
  const selectedId = typeof router.query.batch === 'string' ? router.query.batch : null
  const selected = (batches || []).find((b) => b.id === selectedId) || null
  const select = (id) => router.replace({ pathname: '/hatchery/larval', query: id ? { batch: id } : {} }, undefined, { shallow: true })

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Larvae and fingerlings"
        description="Hatched batches and the fingerling batches graded from them. Log each tank daily; grade, move or sell fingerlings."
      />
      <HatcheryNav />
      <div className="mb-4">
        <TabBar
          tabs={[
            { id: 'active', label: 'In the hatchery' },
            { id: 'closed', label: 'Closed' },
          ]}
          active={status}
          onChange={setStatus}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card padding={false} className={selected ? 'hidden lg:block' : ''}>
          {batches === undefined ? (
            <p className="p-6 text-sm text-muted">Loading batches…</p>
          ) : batches.length === 0 ? (
            <EmptyState title="No larval batches" description="Record a hatch on the incubation board to start one." />
          ) : (
            <ul className="divide-y divide-foam-deep">
              {batches.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => select(b.id)}
                    className={`w-full text-left px-4 sm:px-5 py-3 min-h-12 hover:bg-foam ${b.id === selectedId ? 'bg-foam' : ''}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-data font-medium text-chart-ink">{b.batch_number}</span>
                      <Pill tone={b.stage === 'larvae' ? 'accent' : 'good'}>{b.stage}</Pill>
                    </div>
                    <p className="text-sm text-muted">
                      {[
                        b.units.map((u) => u.name).join(', ') || null,
                        `${fmt(b.count)} fish`,
                        `day ${b.days_since_hatch}`,
                        b.survival_pct != null ? `${fmt(b.survival_pct, 1)} % survival` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {status === 'active' && !b.logged_today && b.stage === 'larvae' && (
                      <p className="text-xs text-signal mt-1">Not logged today</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className={selected ? '' : 'hidden lg:block'}>
          {selected ? (
            <BatchPanel batch={selected} onBack={() => select(null)} />
          ) : (
            <Card>
              <p className="text-sm text-muted">Choose a batch to log its day or move its fish.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function BatchPanel({ batch, onBack }) {
  const { user } = useAuth()
  const canGrade = usePermission('hatchery.grade')
  const canDispatch = usePermission('hatchery.dispatch')
  const [tab, setTab] = useState('log')
  const tabs = [{ id: 'log', label: 'Daily log' }]
  if (canGrade && batch.count > 0) tabs.push({ id: 'grade', label: 'Grade' })
  if (canDispatch && batch.count > 0) {
    tabs.push({ id: 'move', label: 'Move' }, { id: 'sell', label: 'Sell or send' })
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="text-sm text-lake hover:underline lg:hidden min-h-11">
            All batches
          </button>
          <h3 className="font-display text-xl text-chart-ink">
            <Link href={`/batches/${batch.id}`} className="hover:underline font-data">
              {batch.batch_number}
            </Link>
          </h3>
          <p className="text-sm text-muted">
            Hatched {batch.hatched_on}
            {batch.hatched_batch_number !== batch.batch_number ? ` as ${batch.hatched_batch_number}` : ''} · {fmt(batch.stocked)} in ·{' '}
            {fmt(batch.deaths)} dead · {fmt(batch.moved_out)} out
            {batch.abw_g ? ` · ${fmt(batch.abw_g, 3)} g` : ''}
          </p>
        </div>
        {tabs.length > 1 && <TabBar tabs={tabs} active={tab} onChange={setTab} />}
      </div>
      {tab === 'log' && <DailyLog batch={batch} />}
      {tab === 'grade' && <GradeForm batch={batch} />}
      {tab === 'move' && <MoveForm batch={batch} />}
      {tab === 'sell' && <SellForm batch={batch} />}
    </div>
  )
}

const EMPTY_LOG = {
  mortality: '',
  countedAlive: '',
  dryFeedG: '',
  feedingsPerDay: '',
  temperatureC: '',
  dissolvedOxygen: '',
  ph: '',
  salinityPpt: '',
  notes: '',
}

function DailyLog({ batch }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const online = useOnline()
  const logs = useQuery(api.nursery.listLarvalLogs, { batchId: batch.id })
  const [unitId, setUnitId] = useState(batch.units[0]?.id || '')
  const [date, setDate] = useState(today())
  const [form, setForm] = useState(EMPTY_LOG)
  const [feed, setFeed] = useState([])
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  // Saving a day again replaces it: load what is on record for the day.
  const existing = (logs || []).find((l) => l.log_date === date && l.unit_id === unitId)
  useEffect(() => {
    if (!existing) {
      setForm(EMPTY_LOG)
      setFeed([])
      return
    }
    const s = (v) => (v == null ? '' : String(v))
    setForm({
      mortality: s(existing.mortality),
      countedAlive: s(existing.counted_alive),
      dryFeedG: s(existing.dry_feed_g),
      feedingsPerDay: s(existing.feedings_per_day),
      temperatureC: s(existing.temperature_c),
      dissolvedOxygen: s(existing.dissolved_oxygen),
      ph: s(existing.ph),
      salinityPpt: s(existing.salinity_ppt),
      notes: existing.notes || '',
    })
    setFeed(existing.live_feed.map((f) => ({ ...f, quantity: String(f.quantity) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, date, unitId])

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = JSON.parse(
        JSON.stringify({
          unitId,
          batchId: batch.id,
          logDate: date,
          mortality: num(form.mortality),
          countedAlive: num(form.countedAlive),
          liveFeed: feed.filter((f) => num(f.quantity) > 0).map((f) => ({ ...f, quantity: num(f.quantity) })),
          dryFeedG: num(form.dryFeedG),
          feedingsPerDay: num(form.feedingsPerDay),
          temperatureC: num(form.temperatureC),
          dissolvedOxygen: num(form.dissolvedOxygen),
          ph: num(form.ph),
          salinityPpt: num(form.salinityPpt),
          notes: form.notes || undefined,
        }),
      )
      const unitName = batch.units.find((u) => u.id === unitId)?.name || ''
      const res = await saveOrQueue({
        kind: 'larval-log',
        payload,
        summary: `${date} · ${batch.batch_number} in ${unitName}`,
        userId: user?.id,
      })
      if (res.error) throw res.error
      showToast(
        res.queued ? 'info' : 'success',
        res.queued
          ? 'No connection. Saved on this device and will send when you are back online'
          : `Saved. ${fmt(res.data?.alive)} larvae on record`,
      )
    } catch (err) {
      showToast('error', cleanError(err) || errorMessage(err, 'Could not save the log'))
    } finally {
      setSaving(false)
    }
  }

  const numberField = (k, label, opts = {}) => (
    <Field label={label} htmlFor={`log-${k}`} hint={opts.hint}>
      <Input
        id={`log-${k}`}
        type="number"
        inputMode={opts.decimal ? 'decimal' : 'numeric'}
        step={opts.decimal ? 'any' : '1'}
        value={form[k]}
        onChange={set(k)}
        className="tabular-nums"
      />
    </Field>
  )

  return (
    <>
      <Card>
        <OutboxPanel compact online={online} kinds={['larval-log']} />
        <form onSubmit={submit} noValidate className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date" htmlFor="log-date">
              <Input id="log-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Tank" htmlFor="log-unit">
              <Select id="log-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {batch.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {fmt(u.count)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {existing && <p className="text-sm text-muted">This day is already logged; saving replaces it.</p>}
          <FormSection title="Survival">
            <div className="grid grid-cols-2 gap-4">
              {numberField('mortality', 'Dead removed')}
              {numberField('countedAlive', 'Counted alive', { hint: 'Sets the count on record' })}
            </div>
          </FormSection>
          <FormSection title="Feeding">
            <div className="space-y-3">
              {feed.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
                  <Field label={i === 0 ? 'Live feed' : undefined} htmlFor={`lf-k-${i}`}>
                    <Select
                      id={`lf-k-${i}`}
                      value={f.kind}
                      onChange={(e) => setFeed((p) => p.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}
                    >
                      {Object.entries(LIVE_FEED_LABEL).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={i === 0 ? 'Amount' : undefined} htmlFor={`lf-q-${i}`}>
                    <Input
                      id={`lf-q-${i}`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      value={f.quantity}
                      onChange={(e) => setFeed((p) => p.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                    />
                  </Field>
                  <Select
                    aria-label="Unit"
                    value={f.unit}
                    onChange={(e) => setFeed((p) => p.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                    className="w-28"
                  >
                    {Object.entries(LIVE_FEED_UNIT).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                  <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => setFeed((p) => p.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </div>
              ))}
              {feed.length < 10 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFeed((p) => [...p, { kind: 'artemia', quantity: '', unit: 'million' }])}
                >
                  Add live feed
                </Button>
              )}
              <div className="grid grid-cols-2 gap-4">
                {numberField('dryFeedG', 'Dry feed (g)', { decimal: true })}
                {numberField('feedingsPerDay', 'Feedings')}
              </div>
            </div>
          </FormSection>
          <FormSection title="Water">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {numberField('temperatureC', '°C', { decimal: true })}
              {numberField('dissolvedOxygen', 'DO (mg/L)', { decimal: true })}
              {numberField('ph', 'pH', { decimal: true })}
              {numberField('salinityPpt', 'Salinity (ppt)', { decimal: true })}
            </div>
          </FormSection>
          <Field label="Notes" htmlFor="log-notes">
            <Textarea id="log-notes" rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
          <StickyActions>
            <Button type="submit" disabled={saving || !unitId}>
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Save log'}
            </Button>
          </StickyActions>
        </form>
      </Card>

      <Card>
        <CardHeader title="Daily logs" />
        {logs === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted">No logs yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 sm:-mx-6">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-muted text-left">
                <tr>
                  <th className="px-5 sm:px-6 py-2 font-normal">Date</th>
                  <th className="px-2 py-2 font-normal text-right">Dead</th>
                  <th className="px-2 py-2 font-normal text-right">Counted</th>
                  <th className="px-2 py-2 font-normal">Live feed</th>
                  <th className="px-2 py-2 font-normal text-right">°C</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foam-deep">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 sm:px-6 py-2">
                      <button type="button" className="text-lake hover:underline" onClick={() => { setDate(l.log_date); setUnitId(l.unit_id) }}>
                        {l.log_date}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-right">{fmt(l.mortality)}</td>
                    <td className="px-2 py-2 text-right">{fmt(l.counted_alive)}</td>
                    <td className="px-2 py-2">
                      {l.live_feed.map((f) => `${LIVE_FEED_LABEL[f.kind]} ${fmt(f.quantity, 2)} ${f.unit}`).join(', ') || '—'}
                    </td>
                    <td className="px-2 py-2 text-right">{fmt(l.temperature_c, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

function useUnits() {
  const { user } = useAuth()
  return useQuery(api.nursery.nurseryUnits, user ? {} : 'skip') || []
}

function GradeForm({ batch }) {
  const { showToast } = useToast()
  const units = useUnits()
  const grade = useMutation(api.nursery.gradeFingerlings)
  const [unitId, setUnitId] = useState(batch.units[0]?.id || '')
  const [date, setDate] = useState(today())
  const [culls, setCulls] = useState('')
  const [rows, setRows] = useState([{ unitId: '', quantity: '', abwG: '', batchNumber: '' }])
  const [saving, setSaving] = useState(false)
  const here = batch.units.find((u) => u.id === unitId)
  const total = rows.reduce((t, r) => t + (num(r.quantity) || 0), 0) + (num(culls) || 0)
  const setRow = (i, k) => (e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await grade({
        unitId,
        date,
        culls: num(culls),
        outputs: rows
          .filter((x) => x.unitId)
          .map((x) => ({ unitId: x.unitId, quantity: num(x.quantity), abwG: num(x.abwG), batchNumber: x.batchNumber || undefined })),
      })
      showToast(
        'success',
        `Graded into ${r.childBatchIds.length} batch(es)${r.unaccounted ? `; ${fmt(r.unaccounted)} unaccounted` : ''}`,
      )
      setRows([{ unitId: '', quantity: '', abwG: '', batchNumber: '' }])
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not grade'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="space-y-5">
        <p className="text-sm text-muted">
          Grade the whole tank: each size class opens a fingerling batch in its tank. Fish not counted into a grade or culls are recorded as
          unaccounted.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Tank graded" htmlFor="g-unit">
            <Select id="g-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {batch.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {fmt(u.count)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" htmlFor="g-date">
            <Input id="g-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            <Field label={`Grade ${String.fromCharCode(65 + i)} to`} htmlFor={`g-u-${i}`}>
              <Select id={`g-u-${i}`} value={r.unitId} onChange={setRow(i, 'unitId')}>
                <option value="">Choose…</option>
                {units
                  .filter((u) => u.id === unitId || u.count <= 0)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Fish" htmlFor={`g-q-${i}`}>
              <Input id={`g-q-${i}`} type="number" inputMode="numeric" value={r.quantity} onChange={setRow(i, 'quantity')} />
            </Field>
            <Field label="ABW (g)" htmlFor={`g-a-${i}`}>
              <Input id={`g-a-${i}`} type="number" inputMode="decimal" step="any" value={r.abwG} onChange={setRow(i, 'abwG')} />
            </Field>
            <Field label="Batch number" htmlFor={`g-b-${i}`}>
              <Input id={`g-b-${i}`} value={r.batchNumber} onChange={setRow(i, 'batchNumber')} placeholder="Automatic" />
            </Field>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-4">
          {rows.length < 20 && (
            <Button variant="ghost" size="sm" onClick={() => setRows((p) => [...p, { unitId: '', quantity: '', abwG: '', batchNumber: '' }])}>
              Add grade
            </Button>
          )}
          <Field label="Culls" htmlFor="g-culls" className="w-32">
            <Input id="g-culls" type="number" inputMode="numeric" value={culls} onChange={(e) => setCulls(e.target.value)} />
          </Field>
          <p className="text-sm text-muted pb-3 tabular-nums">
            {fmt(total)} of {fmt(here?.count)} accounted for
          </p>
        </div>
        <Button type="submit" disabled={saving || !rows.some((r) => r.unitId)}>
          {saving ? 'Grading…' : 'Grade'}
        </Button>
      </form>
    </Card>
  )
}

function MoveForm({ batch }) {
  const { showToast } = useToast()
  const units = useUnits()
  const transfer = useMutation(api.nursery.transferFingerlings)
  const [sourceUnitId, setSource] = useState(batch.units[0]?.id || '')
  const [date, setDate] = useState(today())
  const [lines, setLines] = useState([{ destinationUnitId: '', quantity: '', abwG: batch.abw_g ? String(batch.abw_g) : '' }])
  const [saving, setSaving] = useState(false)
  const setLine = (i, k) => (e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await transfer({
        sourceUnitId,
        date,
        lines: lines
          .filter((l) => l.destinationUnitId)
          .map((l) => ({ destinationUnitId: l.destinationUnitId, quantity: num(l.quantity), abwG: num(l.abwG) })),
      })
      showToast('success', 'Fingerlings moved')
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not move the fish'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="space-y-5">
        <p className="text-sm text-muted">
          Move fingerlings to nursery or grow-out units. Into an empty unit the batch moves with them; into an occupied one they join its batch.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="From" htmlFor="m-src">
            <Select id="m-src" value={sourceUnitId} onChange={(e) => setSource(e.target.value)}>
              {batch.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {fmt(u.count)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" htmlFor="m-date">
            <Input id="m-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-3 gap-3 items-end">
            <Field label="To" htmlFor={`m-u-${i}`}>
              <Select id={`m-u-${i}`} value={l.destinationUnitId} onChange={setLine(i, 'destinationUnitId')}>
                <option value="">Choose…</option>
                {units
                  .filter((u) => u.id !== sourceUnitId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.count > 0 ? ` · ${fmt(u.count)} (${u.batch_number})` : ' · empty'}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Fish" htmlFor={`m-q-${i}`}>
              <Input id={`m-q-${i}`} type="number" inputMode="numeric" value={l.quantity} onChange={setLine(i, 'quantity')} />
            </Field>
            <Field label="ABW (g)" htmlFor={`m-a-${i}`}>
              <Input id={`m-a-${i}`} type="number" inputMode="decimal" step="any" value={l.abwG} onChange={setLine(i, 'abwG')} />
            </Field>
          </div>
        ))}
        {lines.length < 20 && (
          <Button variant="ghost" size="sm" onClick={() => setLines((p) => [...p, { destinationUnitId: '', quantity: '', abwG: p[0]?.abwG || '' }])}>
            Add destination
          </Button>
        )}
        <div>
          <Button type="submit" disabled={saving || !lines.some((l) => l.destinationUnitId)}>
            {saving ? 'Moving…' : 'Move fingerlings'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function SellForm({ batch }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const customers = useQuery(api.sales.listCustomers, user ? {} : 'skip')
  const movements = useQuery(api.nursery.listMovements, { batchId: batch.id })
  const dispatch = useMutation(api.nursery.dispatchFingerlings)
  const reverse = useMutation(api.nursery.reverseMovement)
  const [form, setForm] = useState({
    kind: 'sale',
    unitId: batch.units[0]?.id || '',
    date: today(),
    quantity: '',
    abwG: batch.abw_g ? String(batch.abw_g) : '',
    pricePerUnit: '',
    customerId: '',
    customerName: '',
    destinationFarm: '',
    paymentStatus: 'pending',
    withdrawalOverrideReason: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const total = (num(form.quantity) || 0) * (num(form.pricePerUnit) || 0)

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await dispatch({
        kind: form.kind,
        unitId: form.unitId,
        date: form.date,
        quantity: num(form.quantity),
        abwG: num(form.abwG),
        pricePerUnit: form.kind === 'sale' ? num(form.pricePerUnit) : undefined,
        customerId: form.kind === 'sale' && form.customerId ? form.customerId : undefined,
        customerName: form.kind === 'sale' && !form.customerId ? form.customerName || undefined : undefined,
        destinationFarm: form.kind === 'external' ? form.destinationFarm : undefined,
        paymentStatus: form.kind === 'sale' ? form.paymentStatus : undefined,
        withdrawalOverrideReason: form.withdrawalOverrideReason || undefined,
      })
      showToast('success', form.kind === 'sale' ? 'Sale recorded' : 'Dispatch recorded')
      setForm((p) => ({ ...p, quantity: '', withdrawalOverrideReason: '' }))
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  const undo = async (id) => {
    const reason = typeof window !== 'undefined' ? window.prompt('Why reverse this?') : null
    if (!reason) return
    try {
      await reverse({ id, reason })
      showToast('success', 'Reversed; the fish are back on record')
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not reverse'))
    }
  }

  return (
    <>
      <Card>
        <form onSubmit={submit} noValidate className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Fingerlings are" htmlFor="d-kind">
              <Select id="d-kind" value={form.kind} onChange={set('kind')}>
                <option value="sale">Sold</option>
                <option value="external">Sent to another farm</option>
              </Select>
            </Field>
            <Field label="From" htmlFor="d-unit">
              <Select id="d-unit" value={form.unitId} onChange={set('unitId')}>
                {batch.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {fmt(u.count)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" htmlFor="d-date">
              <Input id="d-date" type="date" value={form.date} onChange={set('date')} />
            </Field>
            <Field label="Fish" htmlFor="d-q" required>
              <Input id="d-q" type="number" inputMode="numeric" value={form.quantity} onChange={set('quantity')} />
            </Field>
            <Field label="ABW (g)" htmlFor="d-a" required>
              <Input id="d-a" type="number" inputMode="decimal" step="any" value={form.abwG} onChange={set('abwG')} />
            </Field>
            {form.kind === 'sale' ? (
              <>
                <Field label="Price per fish" htmlFor="d-p" required hint={total ? `Total ${fmt(total, 2)}` : undefined}>
                  <Input id="d-p" type="number" inputMode="decimal" step="any" value={form.pricePerUnit} onChange={set('pricePerUnit')} />
                </Field>
                <Field label="Customer" htmlFor="d-c">
                  <Select id="d-c" value={form.customerId} onChange={set('customerId')}>
                    <option value="">Other buyer</option>
                    {(customers || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {!form.customerId && (
                  <Field label="Buyer name" htmlFor="d-cn" required>
                    <Input id="d-cn" value={form.customerName} onChange={set('customerName')} />
                  </Field>
                )}
                <Field label="Payment" htmlFor="d-ps">
                  <Select id="d-ps" value={form.paymentStatus} onChange={set('paymentStatus')}>
                    <option value="pending">Pending</option>
                    <option value="partial">Partial</option>
                    <option value="paid">Paid</option>
                  </Select>
                </Field>
              </>
            ) : (
              <Field label="Receiving farm" htmlFor="d-f" required>
                <Input id="d-f" value={form.destinationFarm} onChange={set('destinationFarm')} />
              </Field>
            )}
            <Field label="Withdrawal override reason" htmlFor="d-w" hint="Only if the fish are in a treatment withdrawal period" className="sm:col-span-2">
              <Input id="d-w" value={form.withdrawalOverrideReason} onChange={set('withdrawalOverrideReason')} />
            </Field>
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : form.kind === 'sale' ? 'Record sale' : 'Record dispatch'}
          </Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="Fish out of this batch" />
        {!movements || movements.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-foam-deep -my-2">
            {movements.map((m) => (
              <li key={m.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-chart-ink">
                    {m.date} · {fmt(m.quantity)} {m.kind === 'transfer' ? 'moved' : m.kind === 'sale' ? 'sold' : 'sent'} to {m.destination || '—'}
                  </p>
                  <p className="text-sm text-muted">
                    From {m.source_unit}
                    {m.amount != null ? ` · ${fmt(m.amount, 2)} (${fmt(m.price_per_unit, 2)} each)` : ''}
                  </p>
                </div>
                {m.status === 'reversed' ? (
                  <Pill tone="warn">reversed</Pill>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => undo(m.id)}>
                    Reverse
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
