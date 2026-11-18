import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Pencil, Plus, Trash2, X } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { PageHeader, Button, Card, Field, Input, Select, EmptyState } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { dailyRecordService } from '../lib/databaseService'
import { cageService } from '../lib/cageService'
import { feedTypeService } from '../lib/feedTypeService'
import { cleanError } from '../lib/offlineOutbox'
import { MORTALITY_CAUSES } from '../lib/farmHealth'
import { usePermission } from '../hooks/usePermission'

const isoDay = (d) => d.toISOString().split('T')[0]
const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoDay(d)
}
const idOf = (x) => x?.id || x?._id
const causeLabel = (v) => MORTALITY_CAUSES.find((c) => c.value === v)?.label || v || ''
const fmtKg = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })
const optNum = (v) =>
  v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v)

const RANGES = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
]

function EditSheet({ record, cages, feedTypes, onClose, onSaved }) {
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(() => ({
    date: record.date,
    feedTypeId: record.feed_type_id || '',
    feedAmount: String(record.feed_amount ?? ''),
    mortality: String(record.mortality ?? ''),
    mortalityCause: record.mortality_cause || 'unknown',
    dissolvedOxygen: record.dissolved_oxygen ?? '',
    temperatureC: record.temperature_c ?? '',
    notes: record.notes || '',
  }))
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const cageName = cages.find((c) => idOf(c) === record.cage_id)?.name || 'Cage'

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (e) => {
    e.preventDefault()
    const feedAmount = Number(form.feedAmount) || 0
    const mortality = Number(form.mortality) || 0
    if (feedAmount < 0 || mortality < 0) return setError('Values cannot be negative')
    if (!Number.isInteger(mortality)) return setError('Mortality must be a whole number')
    if (feedAmount > 0 && !form.feedTypeId) return setError('Choose a feed type')

    // Only send what changed, so an untouched feed line never touches stock.
    const patch = {}
    if (form.date !== record.date) patch.date = form.date
    if (feedAmount !== Number(record.feed_amount || 0)) patch.feedAmount = feedAmount
    if (form.feedTypeId && form.feedTypeId !== (record.feed_type_id || '')) {
      patch.feedTypeId = form.feedTypeId
    }
    if (mortality !== Number(record.mortality || 0)) patch.mortality = mortality
    const cause = mortality > 0 ? form.mortalityCause : ''
    if (cause !== (record.mortality_cause || '')) patch.mortalityCause = cause
    const doVal = optNum(form.dissolvedOxygen)
    if (doVal !== undefined && doVal !== record.dissolved_oxygen) patch.dissolvedOxygen = doVal
    const tVal = optNum(form.temperatureC)
    if (tVal !== undefined && tVal !== record.temperature_c) patch.temperatureC = tVal
    if (form.notes !== (record.notes || '')) patch.notes = form.notes

    if (!Object.keys(patch).length) return onClose()

    setSaving(true)
    setError('')
    const { error: err, warnings } = await dailyRecordService.editDailyRecord(idOf(record), patch)
    setSaving(false)
    if (err) return setError(cleanError(err))
    showToast(`${cageName} on ${form.date} updated`, 'success')
    if (warnings?.length) showToast(warnings.join('. '), 'warning')
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <form
        onSubmit={save}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-record-title"
        className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-xl bg-surface p-5 sm:p-6 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
      >
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h2 id="edit-record-title" className="font-display text-lg font-medium text-chart-ink">
              Edit {cageName}
            </h2>
            <p className="text-sm text-muted mt-1">
              Feed changes re-post stock. Mortality changes adjust the cage count
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-11 w-11 -mr-2 -mt-2 inline-flex items-center justify-center rounded-lg text-muted hover:bg-foam"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-signal/20 bg-signal/10 p-3 text-sm text-signal">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date" htmlFor="e-date" className="col-span-2">
            <Input id="e-date" type="date" max={isoDay(new Date())} value={form.date} onChange={set('date')} required />
          </Field>
          <Field label="Feed type" htmlFor="e-feed" className="col-span-2">
            <Select id="e-feed" value={form.feedTypeId} onChange={set('feedTypeId')}>
              <option value="">None</option>
              {feedTypes.map((f) => (
                <option key={idOf(f)} value={idOf(f)}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Feed (kg)" htmlFor="e-kg">
            <Input id="e-kg" type="number" inputMode="decimal" step="0.1" min="0" value={form.feedAmount} onChange={set('feedAmount')} className="tabular-nums" />
          </Field>
          <Field label="Mortality" htmlFor="e-mort">
            <Input id="e-mort" type="number" inputMode="numeric" step="1" min="0" value={form.mortality} onChange={set('mortality')} className="tabular-nums" />
          </Field>
          {Number(form.mortality) > 0 && (
            <Field label="Cause of death" htmlFor="e-cause" className="col-span-2">
              <Select id="e-cause" value={form.mortalityCause} onChange={set('mortalityCause')}>
                {MORTALITY_CAUSES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="DO (mg/L)" htmlFor="e-do">
            <Input id="e-do" type="number" inputMode="decimal" step="0.1" min="0" value={form.dissolvedOxygen} onChange={set('dissolvedOxygen')} className="tabular-nums" />
          </Field>
          <Field label="Temp (°C)" htmlFor="e-temp">
            <Input id="e-temp" type="number" inputMode="decimal" step="0.1" value={form.temperatureC} onChange={set('temperatureC')} className="tabular-nums" />
          </Field>
          <Field label="Notes" htmlFor="e-notes" className="col-span-2">
            <Input id="e-notes" value={form.notes} onChange={set('notes')} />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}

export default function DailyRecordsPage() {
  const { showToast } = useToast()
  const { hasRole } = useAuth()
  const isAdmin = usePermission('production.records.delete')
  const [range, setRange] = useState('7')
  const [cageId, setCageId] = useState('')
  const [records, setRecords] = useState([])
  const [cages, setCages] = useState([])
  const [feedTypes, setFeedTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const dateFrom = daysAgo(Number(range) - 1)
  const dateTo = isoDay(new Date())

  useEffect(() => {
    Promise.all([cageService.getAllCages(), feedTypeService.getAllFeedTypes()]).then(
      ([c, f]) => {
        setCages(c.data || [])
        setFeedTypes((f.data || []).filter((t) => !t.deleted_at))
      },
    )
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await dailyRecordService.listRecords({
      dateFrom,
      dateTo,
      cageId: cageId || undefined,
    })
    setLoadError(error ? cleanError(error) : '')
    setRecords(data || [])
    setLoading(false)
  }, [dateFrom, dateTo, cageId])

  useEffect(() => {
    load()
  }, [load])

  const cageById = useMemo(() => new Map(cages.map((c) => [idOf(c), c])), [cages])
  const feedById = useMemo(() => new Map(feedTypes.map((f) => [idOf(f), f])), [feedTypes])
  const cageName = (id) => cageById.get(id)?.name || 'Unknown cage'
  const feedName = (r) => feedById.get(r.feed_type_id)?.name || r.feed_type || ''

  const totals = records.reduce(
    (a, r) => ({
      feed: a.feed + (Number(r.feed_amount) || 0),
      mort: a.mort + (Number(r.mortality) || 0),
      cost: a.cost + (Number(r.feed_cost) || 0),
    }),
    { feed: 0, mort: 0, cost: 0 },
  )

  const exportCsv = () => {
    const header = ['Date', 'Cage', 'Feed type', 'Feed kg', 'Feed cost', 'Mortality', 'Cause', 'DO mg/L', 'Temp C', 'Notes']
    const esc = (v) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const rows = records.map((r) => [
      r.date,
      cageName(r.cage_id),
      feedName(r),
      r.feed_amount ?? 0,
      r.feed_cost ?? 0,
      r.mortality ?? 0,
      r.mortality > 0 ? causeLabel(r.mortality_cause) : '',
      r.dissolved_oxygen ?? '',
      r.temperature_c ?? '',
      r.notes ?? '',
    ])
    const csv = [header, ...rows].map((row) => row.map(esc).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `daily-records_${dateFrom}_to_${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setBusyDelete(true)
    const { error, warnings } = await dailyRecordService.deleteDailyRecord(idOf(deleting))
    setBusyDelete(false)
    if (error) {
      showToast(cleanError(error), 'error')
      return
    }
    showToast('Record deleted. Feed returned to stock', 'success')
    if (warnings?.length) showToast(warnings.join('. '), 'warning')
    setDeleting(null)
    load()
  }

  return (
    <ProtectedRoute>
      <Layout title="Daily records">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Operations' },
            { label: 'Daily records' },
          ]}
          description="Everything logged through daily entry. Fix a wrong number here; stock and fish counts follow."
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!records.length}>
                <Download size={16} aria-hidden />
                Export CSV
              </Button>
              <Button size="sm" href="/daily-entry">
                <Plus size={16} aria-hidden />
                New entry
              </Button>
            </>
          }
        />

        <div className="flex flex-wrap items-end gap-4 mb-6">
          <div className="inline-flex rounded-lg bg-foam p-1 border border-foam-deep" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                aria-pressed={range === r.id}
                className={`px-3 min-h-9 text-sm font-medium rounded-md transition-colors ${
                  range === r.id ? 'bg-surface text-chart-ink shadow-sm' : 'text-muted hover:text-chart-ink'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Field label="Cage" htmlFor="filter-cage" className="w-full sm:w-56">
            <Select id="filter-cage" value={cageId} onChange={(e) => setCageId(e.target.value)}>
              <option value="">All cages</option>
              {cages.map((c) => (
                <option key={idOf(c)} value={idOf(c)}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card>
            <p className="text-sm text-muted">Records</p>
            <p className="mt-3 text-[28px] leading-none font-medium tabular-nums">{records.length}</p>
          </Card>
          <Card>
            <p className="text-sm text-muted">Feed given</p>
            <p className="mt-3 text-[28px] leading-none font-medium tabular-nums">
              {fmtKg(totals.feed)} <span className="text-sm font-normal text-muted">kg</span>
            </p>
          </Card>
          <Card>
            <p className="text-sm text-muted">Feed cost</p>
            <p className="mt-3 text-[28px] leading-none font-medium tabular-nums">
              {totals.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </Card>
          <Card>
            <p className="text-sm text-muted">Mortality</p>
            <p className={`mt-3 text-[28px] leading-none font-medium tabular-nums ${totals.mort > 0 ? 'text-signal' : ''}`}>
              {totals.mort.toLocaleString()}
            </p>
          </Card>
        </div>

        {loadError ? (
          <p role="alert" className="rounded-lg border border-signal/20 bg-signal/10 p-3 text-sm text-signal">
            {loadError}
          </p>
        ) : loading ? (
          <p className="text-sm text-muted">Loading records…</p>
        ) : records.length === 0 ? (
          <Card>
            <EmptyState
              title={`Nothing logged in the last ${range} days`}
              description={cageId ? 'Try another cage or a longer range.' : 'Daily entries appear here once saved.'}
              action={<Button href="/daily-entry">Open daily entry</Button>}
            />
          </Card>
        ) : (
          <>
            {/* Phone: one card per record */}
            <ul className="md:hidden space-y-3">
              {records.map((r) => (
                <li key={idOf(r)} className="rounded-xl border border-foam-deep bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-chart-ink">{cageName(r.cage_id)}</p>
                      <p className="text-sm text-muted tabular-nums">{r.date}</p>
                    </div>
                    <div className="flex -mr-2 -mt-2">
                      <button type="button" onClick={() => setEditing(r)} aria-label="Edit record" className="h-11 w-11 inline-flex items-center justify-center rounded-lg text-muted hover:bg-foam">
                        <Pencil size={16} />
                      </button>
                      {isAdmin && (
                        <button type="button" onClick={() => setDeleting(r)} aria-label="Delete record" className="h-11 w-11 inline-flex items-center justify-center rounded-lg text-muted hover:bg-foam hover:text-signal">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm tabular-nums">
                    <dt className="text-muted">Feed</dt>
                    <dd className="text-right">{r.feed_amount > 0 ? `${fmtKg(r.feed_amount)} kg ${feedName(r)}` : 'None'}</dd>
                    <dt className="text-muted">Mortality</dt>
                    <dd className={`text-right ${r.mortality > 0 ? 'text-signal' : ''}`}>
                      {r.mortality || 0}
                      {r.mortality > 0 && r.mortality_cause ? `, ${causeLabel(r.mortality_cause)}` : ''}
                    </dd>
                    {(r.dissolved_oxygen != null || r.temperature_c != null) && (
                      <>
                        <dt className="text-muted">Water</dt>
                        <dd className="text-right">
                          {[r.dissolved_oxygen != null && `${r.dissolved_oxygen} mg/L`, r.temperature_c != null && `${r.temperature_c} °C`].filter(Boolean).join(', ')}
                        </dd>
                      </>
                    )}
                  </dl>
                  {r.notes && <p className="mt-2 text-sm text-muted">{r.notes}</p>}
                </li>
              ))}
            </ul>

            {/* Tablet and up: table */}
            <div className="hidden md:block page-card overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-foam-deep">
                  <tr className="text-left text-muted">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Cage</th>
                    <th className="px-4 py-3 font-medium">Feed type</th>
                    <th className="px-4 py-3 font-medium text-right">Feed kg</th>
                    <th className="px-4 py-3 font-medium text-right">Mortality</th>
                    <th className="px-4 py-3 font-medium">Cause</th>
                    <th className="px-4 py-3 font-medium text-right">DO</th>
                    <th className="px-4 py-3 font-medium text-right">Temp</th>
                    <th className="px-4 py-3 font-medium">Notes</th>
                    <th className="px-4 py-3 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foam-deep">
                  {records.map((r) => (
                    <tr key={idOf(r)} className="hover:bg-foam/60">
                      <td className="px-4 py-3 tabular-nums whitespace-nowrap">{r.date}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{cageName(r.cage_id)}</td>
                      <td className="px-4 py-3 text-muted">{feedName(r) || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtKg(r.feed_amount)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${r.mortality > 0 ? 'text-signal' : ''}`}>{r.mortality || 0}</td>
                      <td className="px-4 py-3 text-muted">{r.mortality > 0 ? causeLabel(r.mortality_cause) : ''}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted">{r.dissolved_oxygen ?? ''}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted">{r.temperature_c ?? ''}</td>
                      <td className="px-4 py-3 text-muted max-w-[16rem] truncate" title={r.notes || ''}>{r.notes || ''}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-right">
                        <button type="button" onClick={() => setEditing(r)} aria-label={`Edit ${cageName(r.cage_id)} on ${r.date}`} className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-muted hover:bg-foam hover:text-chart-ink">
                          <Pencil size={16} />
                        </button>
                        {isAdmin && (
                          <button type="button" onClick={() => setDeleting(r)} aria-label={`Delete ${cageName(r.cage_id)} on ${r.date}`} className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-muted hover:bg-foam hover:text-signal">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {editing && (
          <EditSheet
            record={editing}
            cages={cages}
            feedTypes={feedTypes}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              load()
            }}
          />
        )}

        <ConfirmDeleteModal
          open={Boolean(deleting)}
          title="Delete daily record"
          message={
            deleting
              ? `Delete ${cageName(deleting.cage_id)} on ${deleting.date}? Its feed goes back to stock and its ${deleting.mortality || 0} dead fish are added back to the cage count.`
              : ''
          }
          busy={busyDelete}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      </Layout>
    </ProtectedRoute>
  )
}
