import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
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
  Textarea,
} from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { errorCode, errorMessage } from '../../lib/errorMessage'
import { localToday } from '../../lib/format'
import Attachments from '../../components/Attachments'
import { usePermission } from '../../hooks/usePermission'

const fmt = (v, dp = 1) =>
  v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp })

const ORIGIN = {
  stocking: 'Stocked',
  transfer_split: 'Split off by a transfer',
  grading_split: 'Graded from a parent batch',
  merge: 'Formed by a merge',
  hatchery: 'From the hatchery',
  legacy: 'Imported',
}

const STEP = {
  stocked: 'Stocked',
  topped_up: 'Topped up',
  transfer_in: 'Moved in',
  transfer_out: 'Moved out',
  graded: 'Graded into',
  merged: 'Merged into',
  harvested: 'Harvested',
}

/** One flat CSV with a section column, for buyers' and auditors' spreadsheets. */
function traceCsv(r) {
  const rows = [['section', 'date', 'item', 'detail', 'quantity', 'unit']]
  const t = r.trace
  rows.push(['lot', r.lot.harvest_date, r.lot.lot_code, [r.lot.grade, r.lot.destination].filter(Boolean).join(' / '), r.lot.weight_kg, 'kg'])
  if (r.harvest) rows.push(['harvest', r.harvest.date, r.cage_name, r.harvest.type, r.harvest.total_weight_kg, 'kg'])
  for (const o of t?.origins || []) {
    rows.push(['origin', o.opened_on, o.batch_number, [ORIGIN[o.origin] || o.origin, o.source, o.source_cage].filter(Boolean).join(' / '), o.stocked_count ?? '', 'fish'])
  }
  for (const s of t?.journey || []) {
    rows.push(['movement', s.date, `${STEP[s.kind] || s.kind} ${s.cageName}`, [s.batchNumber, s.counterpartCage, s.counterpartBatch, s.source].filter(Boolean).join(' / '), s.qty, 'fish'])
  }
  for (const f of t?.feed || []) {
    rows.push(['feed', `${f.first_fed}..${f.last_fed}`, f.feed_type, '', f.kg_fed, 'kg'])
    for (const l of f.lots) {
      rows.push(['feed lot', l.received_on, l.lot_number || '(no lot number)', [f.feed_type, l.supplier, l.po_number].filter(Boolean).join(' / '), l.quantity_kg, 'kg'])
    }
  }
  for (const x of t?.treatments || []) {
    rows.push(['treatment', x.date, x.product_name || x.treatment, [x.diagnosis, x.cage_name, x.withdrawal_until && `withdrawal until ${x.withdrawal_until}`].filter(Boolean).join(' / '), x.dosage || '', ''])
  }
  for (const d of r.dispatches) {
    rows.push(['dispatch', d.dispatch_date, d.customer_name || '', [d.vehicle, d.driver, d.temperature_c != null && `${d.temperature_c} °C`].filter(Boolean).join(' / '), d.weight_kg, 'kg'])
  }
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((row) => row.map(esc).join(',')).join('\n')
}

function Table({ head, rows, empty }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            {head.map((h) => (
              <th key={h} className="font-medium py-1.5 px-1 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-foam-deep">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="py-1.5 px-1 align-top tabular-nums">
                  {c ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DispatchForm({ lot, onDone }) {
  const { hasRole } = useAuth()
  const isAdmin = usePermission('production.withdrawal.override')
  const { showToast } = useToast()
  const customers = useQuery(api.sales.listCustomers, {})
  const createDispatch = useMutation(api.traceability.createDispatch)
  const [form, setForm] = useState({
    dispatchDate: localToday(),
    weightKg: '',
    customerId: '',
    customerName: '',
    vehicle: '',
    driver: '',
    temperatureC: '',
    notes: '',
  })
  const [blocked, setBlocked] = useState(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createDispatch({
        harvestLotId: lot.id,
        dispatchDate: form.dispatchDate,
        weightKg: form.weightKg ? Number(form.weightKg) : undefined,
        customerId: form.customerId || undefined,
        customerName: !form.customerId ? form.customerName.trim() || undefined : undefined,
        vehicle: form.vehicle.trim() || undefined,
        driver: form.driver.trim() || undefined,
        temperatureC: form.temperatureC === '' ? undefined : Number(form.temperatureC),
        notes: form.notes.trim() || undefined,
        withdrawalOverrideReason: blocked && reason.trim() ? reason.trim() : undefined,
      })
      showToast('success', 'Dispatch recorded')
      onDone()
    } catch (err) {
      if (errorCode(err) === 'WITHDRAWAL_ACTIVE') setBlocked(errorMessage(err))
      showToast('error', errorMessage(err, 'Could not record the dispatch'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5 print:hidden">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Date" htmlFor="d-date" required>
          <Input id="d-date" type="date" value={form.dispatchDate} onChange={set('dispatchDate')} />
        </Field>
        <Field label="Weight (kg)" htmlFor="d-weight" hint={`${fmt(lot.remaining_kg)} kg left`}>
          <Input id="d-weight" type="number" step="0.1" inputMode="decimal" value={form.weightKg} placeholder={String(lot.remaining_kg)} onChange={set('weightKg')} />
        </Field>
        <Field label="Customer" htmlFor="d-customer" required>
          <Select id="d-customer" value={form.customerId} onChange={set('customerId')}>
            <option value="">Other buyer…</option>
            {(customers || []).filter((c) => c.active).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {!form.customerId && (
          <Field label="Buyer name" htmlFor="d-buyer" required>
            <Input id="d-buyer" value={form.customerName} onChange={set('customerName')} />
          </Field>
        )}
        <Field label="Vehicle" htmlFor="d-vehicle" hint="Registration number">
          <Input id="d-vehicle" value={form.vehicle} onChange={set('vehicle')} />
        </Field>
        <Field label="Driver" htmlFor="d-driver">
          <Input id="d-driver" value={form.driver} onChange={set('driver')} />
        </Field>
        <Field label="Temperature at loading (°C)" htmlFor="d-temp">
          <Input id="d-temp" type="number" step="0.1" inputMode="decimal" value={form.temperatureC} onChange={set('temperatureC')} />
        </Field>
        <Field label="Notes" htmlFor="d-notes" className="sm:col-span-2">
          <Textarea id="d-notes" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
        {blocked && (
          <div role="alert" className="sm:col-span-2 rounded-lg border border-signal/40 bg-signal/10 px-4 py-3 text-sm space-y-3">
            <p>{blocked}</p>
            {isAdmin ? (
              <Field label="Override reason" htmlFor="d-reason" required>
                <Textarea id="d-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Kept in the audit log" />
              </Field>
            ) : (
              <p className="text-muted">Ask an admin to record this dispatch.</p>
            )}
          </div>
        )}
      </div>
      <FormActions>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Record dispatch'}
        </Button>
      </FormActions>
    </form>
  )
}

function LotReport() {
  const router = useRouter()
  const { user } = useAuth()
  const lotId = typeof router.query.lotId === 'string' ? router.query.lotId : null
  const r = useQuery(api.traceability.lotReport, user && lotId ? { lotId } : 'skip')
  const [dispatching, setDispatching] = useState(false)

  const crumbs = (label) => [
    { label: 'Harvest lots', href: '/trace' },
    { label },
  ]
  if (r === undefined || !lotId) {
    return <div className="flex justify-center items-center h-64 text-muted">Loading trace report…</div>
  }
  if (r === null) {
    return (
      <>
        <PageHeader showTitle={false} breadcrumbs={crumbs('Not found')} />
        <EmptyState
          title="Lot not found"
          description="It may belong to another company, or the link is wrong."
          action={<Button href="/trace">Back to harvest lots</Button>}
        />
      </>
    )
  }

  const downloadCsv = () => {
    const url = URL.createObjectURL(new Blob([traceCsv(r)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `trace-${r.lot.lot_code}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const t = r.trace
  return (
    <div className="max-w-4xl space-y-6 print:max-w-none print:space-y-4">
      <PageHeader
        title={`Lot ${r.lot.lot_code}`}
        breadcrumbs={crumbs(r.lot.lot_code)}
        description={[r.company, r.site, `harvested ${r.lot.harvest_date} from ${r.cage_name}`].filter(Boolean).join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="secondary" size="sm" onClick={downloadCsv}>
              Download CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader title="Lot" />
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-muted">Weight</dt>
            <dd className="font-data tabular-nums">{fmt(r.lot.weight_kg)} kg</dd>
          </div>
          <div>
            <dt className="text-muted">Fish</dt>
            <dd className="font-data tabular-nums">{fmt(r.lot.fish_count, 0)}</dd>
          </div>
          <div>
            <dt className="text-muted">Grade</dt>
            <dd>{r.lot.grade || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Destination</dt>
            <dd>{r.lot.destination || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Batch</dt>
            <dd>
              {r.batch ? (
                <Link href={`/batches/${r.batch.id}`} className="text-lake hover:underline">
                  {r.batch.batch_number}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Species</dt>
            <dd>{r.batch?.species?.replace(/_/g, ' ') || '—'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted">Withdrawal at harvest</dt>
            <dd>
              {r.harvest?.withdrawal_override
                ? `Overridden by an admin: ${r.harvest.withdrawal_override.reason} (period ran until ${r.harvest.withdrawal_override.until})`
                : r.withdrawal_clear_at_harvest
                  ? 'Clear: no withdrawal period running'
                  : 'A withdrawal period was running'}
            </dd>
          </div>
        </dl>
      </Card>

      {!t ? (
        <Card>
          <p className="text-sm text-muted">This harvest is not linked to a batch, so its origin, feed and treatments cannot be traced.</p>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Origin" subtitle="Where the fish came from." />
            <Table
              head={['Batch', 'Opened', 'How', 'Source', 'Fish stocked', 'Start weight']}
              rows={t.origins.map((o) => [
                o.batch_number,
                o.opened_on,
                ORIGIN[o.origin] || o.origin,
                [o.source, o.source_cage].filter(Boolean).join(' · ') || '—',
                fmt(o.stocked_count, 0),
                o.initial_abw_g == null ? '—' : `${fmt(o.initial_abw_g)} g`,
              ])}
              empty="No origin on record."
            />
          </Card>

          <Card>
            <CardHeader title="Movements" subtitle="Stockings, transfers, gradings and harvest, oldest first." />
            <Table
              head={['Date', 'Step', 'Cage', 'Batch', 'With', 'Fish']}
              rows={t.journey.map((s) => [
                s.date,
                STEP[s.kind] || s.kind,
                s.cageName,
                s.batchNumber,
                [s.counterpartCage, s.counterpartBatch, s.source].filter(Boolean).join(' · ') || '—',
                fmt(s.qty, 0),
              ])}
              empty="No movements on record."
            />
          </Card>

          <Card>
            <CardHeader
              title="Feed"
              subtitle="Feed eaten and the feed lots at the site at the time. Lots are matched first in, first out, so these are the candidate lots."
            />
            {t.feed.length === 0 ? (
              <p className="text-sm text-muted">No feed with a feed type on record.</p>
            ) : (
              <div className="space-y-4">
                {t.feed.map((f) => (
                  <div key={f.feed_type}>
                    <p className="text-sm font-medium text-chart-ink">
                      {f.feed_type} · {fmt(f.kg_fed)} kg · {f.first_fed} to {f.last_fed}
                    </p>
                    <Table
                      head={['Lot', 'Received', 'Kg', 'Expiry', 'Supplier', 'Order']}
                      rows={f.lots.map((l) => [l.lot_number || 'No lot number', l.received_on, fmt(l.quantity_kg), l.expiry_date || '—', l.supplier || '—', l.po_number || '—'])}
                      empty="No purchases of this feed on record."
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Treatments" subtitle="Every treatment while these fish (or their parent batches) were in a cage." />
            <Table
              head={['Date', 'Product', 'Diagnosis', 'Cage', 'Dose', 'Withdrawal until']}
              rows={t.treatments.map((x) => [x.date, x.product_name || x.treatment, x.diagnosis || '—', x.cage_name, x.dosage || '—', x.withdrawal_until || '—'])}
              empty="No treatments on record."
            />
          </Card>
        </>
      )}

      <Card>
        <CardHeader title="Documents" subtitle="Health certificates, lab results and delivery notes for this lot." />
        <Attachments entityType="harvestLots" entityId={r.lot.id} />
      </Card>

      <Card>
        <CardHeader
          title="Dispatches"
          subtitle={`${fmt(r.lot.dispatched_kg)} kg dispatched, ${fmt(r.lot.remaining_kg)} kg left.`}
          action={
            !dispatching && r.lot.remaining_kg > 0 ? (
              <span className="print:hidden">
                <Button size="sm" onClick={() => setDispatching(true)}>
                  Dispatch
                </Button>
              </span>
            ) : null
          }
        />
        {dispatching && (
          <div className="mb-5">
            <DispatchForm lot={r.lot} onDone={() => setDispatching(false)} />
          </div>
        )}
        <Table
          head={['Date', 'Customer', 'Kg', 'Vehicle', 'Driver', '°C']}
          rows={r.dispatches.map((d) => [d.dispatch_date, d.customer_name, fmt(d.weight_kg), d.vehicle || '—', d.driver || '—', d.temperature_c ?? '—'])}
          empty="Not dispatched yet."
        />
      </Card>
    </div>
  )
}

export default function TraceLotPage() {
  return (
    <ProtectedRoute>
      <Layout title="Trace report">
        <LotReport />
      </Layout>
    </ProtectedRoute>
  )
}
