import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Download, Pencil, Plus, Trash2, X } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  EmptyState,
  LoadingState,
  GradientButton,
  KpiStrip,
  Segmented,
  Table,
} from '../components/ui'
import { HeaderAction } from '../components/ui/HeaderAction'
import { formatNumber } from '../lib/format'
import { useT } from '../lib/i18n/context'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
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
const NONE = []
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
  const updateRecord = useMutation(api.dailyRecords.update)
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
    let warnings
    try {
      warnings = (await updateRecord({ id: idOf(record), patch }))?.warnings
    } catch (err) {
      return setError(cleanError(err))
    } finally {
      setSaving(false)
    }
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
        className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-card sm:rounded-card border border-line bg-surface p-5 sm:p-6 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
      >
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h2 id="edit-record-title" className="text-[17px] font-semibold leading-[22px] text-text">
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
            className="h-11 w-11 -mr-2 -mt-2 inline-flex items-center justify-center rounded-pill text-muted hover:bg-surface-2"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-input border border-[var(--pill-red-border)] bg-[color-mix(in_oklab,var(--alert)_8%,transparent)] p-3 text-sm text-alert">
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
  return (
    <ProtectedRoute>
      <DailyRecords />
    </ProtectedRoute>
  )
}

function DailyRecords() {
  const t = useT()
  const { showToast } = useToast()
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const isAdmin = usePermission('production.records.delete')
  const removeRecord = useMutation(api.dailyRecords.remove)
  const [range, setRange] = useState('7')
  const [cageId, setCageId] = useState('')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const dateFrom = daysAgo(Number(range) - 1)
  const dateTo = isoDay(new Date())

  const recordsResult = useQuery(
    api.dailyRecords.list,
    user ? { ...locationArgs, dateFrom, dateTo, ...(cageId ? { cageId } : {}) } : 'skip',
  )
  const records = recordsResult ?? NONE
  const loading = recordsResult === undefined
  const cages = useOptionalQuery(api.cages.list, user ? locationArgs : 'skip', NONE) ?? NONE
  const feedTypesResult = useOptionalQuery(api.feed.listFeedTypes, user ? {} : 'skip', NONE)
  const feedTypes = useMemo(
    () => (feedTypesResult ?? NONE).filter((t) => !t.deleted_at),
    [feedTypesResult],
  )

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
    let warnings
    try {
      warnings = (await removeRecord({ id: idOf(deleting) }))?.warnings
    } catch (error) {
      showToast(cleanError(error), 'error')
      return
    } finally {
      setBusyDelete(false)
    }
    showToast('Record deleted. Feed returned to stock', 'success')
    if (warnings?.length) showToast(warnings.join('. '), 'warning')
    setDeleting(null)
  }

  const cageCell = (r) => cageName(r.cage_id)
  const actionsCell = (r) => (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={() => setEditing(r)}
        aria-label={t('daily.records.editAria', { cage: cageName(r.cage_id), date: r.date })}
        className="inline-flex size-9 items-center justify-center rounded-pill text-muted hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      >
        <Pencil size={16} aria-hidden />
      </button>
      {isAdmin && (
        <button
          type="button"
          onClick={() => setDeleting(r)}
          aria-label={t('daily.records.deleteAria', { cage: cageName(r.cage_id), date: r.date })}
          className="inline-flex size-9 items-center justify-center rounded-pill text-muted hover:bg-surface-2 hover:text-alert focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          <Trash2 size={16} aria-hidden />
        </button>
      )}
    </div>
  )
  const columns = [
    { key: 'date', header: t('daily.records.colDate'), width: 110, render: (r) => <span className="tabular-nums whitespace-nowrap">{r.date}</span> },
    { key: 'cage', header: t('daily.records.colCage'), width: 120, render: (r) => <span className="font-semibold whitespace-nowrap">{cageCell(r)}</span> },
    { key: 'feedType', header: t('daily.records.colFeedType'), render: (r) => <span className="text-muted">{feedName(r) || '—'}</span> },
    { key: 'feed', header: t('daily.records.colFeedKg'), width: 100, align: 'right', render: (r) => fmtKg(r.feed_amount) },
    { key: 'mort', header: t('daily.records.colMortality'), width: 100, align: 'right', render: (r) => <span className={r.mortality > 0 ? 'text-alert' : ''}>{r.mortality || 0}</span> },
    { key: 'cause', header: t('daily.records.colCause'), render: (r) => <span className="text-muted">{r.mortality > 0 ? causeLabel(r.mortality_cause) : ''}</span> },
    { key: 'do', header: t('daily.records.colDo'), width: 80, align: 'right', render: (r) => <span className="text-muted">{r.dissolved_oxygen ?? ''}</span> },
    { key: 'temp', header: t('daily.records.colTemp'), width: 80, align: 'right', render: (r) => <span className="text-muted">{r.temperature_c ?? ''}</span> },
    { key: 'notes', header: t('daily.records.colNotes'), render: (r) => <span className="block max-w-[16rem] truncate text-muted" title={r.notes || ''}>{r.notes || ''}</span> },
    { key: 'actions', header: <span className="sr-only">{t('daily.records.colActions')}</span>, width: 96, align: 'right', render: actionsCell },
  ]

  return (
    <Layout
      title={t('daily.records.title')}
      eyebrow={t('daily.records.eyebrow')}
      actions={
        <>
          <HeaderAction icon={Plus} href="/daily-entry">
            {t('daily.records.newEntry')}
          </HeaderAction>
          <GradientButton reverse icon={Download} onClick={exportCsv} disabled={!records.length}>
            {t('daily.records.exportCsv')}
          </GradientButton>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <p className="text-sm text-muted">{t('daily.records.description')}</p>
        <div className="flex flex-wrap items-end gap-4">
          <Segmented
            label={t('daily.records.dateRange')}
            options={RANGES.map((r) => ({ value: r.id, label: t('daily.records.rangeDays', { count: Number(r.id) }) }))}
            value={range}
            onChange={setRange}
          />
          <Field label={t('daily.records.colCage')} htmlFor="filter-cage" className="w-full sm:w-56">
            <Select id="filter-cage" value={cageId} onChange={(e) => setCageId(e.target.value)}>
              <option value="">{t('daily.records.allCages')}</option>
              {cages.map((c) => (
                <option key={idOf(c)} value={idOf(c)}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Card>
          <KpiStrip
            items={[
              { key: 'records', label: t('daily.records.kpiRecords'), value: formatNumber(records.length) },
              { key: 'feed', label: t('daily.records.kpiFeed'), value: fmtKg(totals.feed), suffix: 'kg' },
              { key: 'cost', label: t('daily.records.kpiCost'), value: formatNumber(totals.cost) },
              {
                key: 'mort',
                label: t('daily.records.kpiMortality'),
                value: formatNumber(totals.mort),
                valueTone: totals.mort > 0 ? 'alert' : undefined,
              },
            ]}
          />
        </Card>

        {loading ? (
          <LoadingState label={t('daily.records.loading')} />
        ) : records.length === 0 ? (
          <Card>
            <EmptyState
              title={t('daily.records.emptyTitle', { count: Number(range) })}
              description={cageId ? t('daily.records.emptyCage') : t('daily.records.emptyAll')}
              action={<Button href="/daily-entry">{t('daily.records.openEntry')}</Button>}
            />
          </Card>
        ) : (
          <>
            {/* Phone: one card per record */}
            <ul className="space-y-3 md:hidden">
              {records.map((r) => (
                <li key={idOf(r)} className="rounded-card border border-line bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-text">{cageName(r.cage_id)}</p>
                      <p className="text-xs text-muted tabular-nums">{r.date}</p>
                    </div>
                    <div className="-mr-2 -mt-2">{actionsCell(r)}</div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm tabular-nums">
                    <dt className="text-muted">{t('daily.records.feed')}</dt>
                    <dd className="text-right">{r.feed_amount > 0 ? `${fmtKg(r.feed_amount)} kg ${feedName(r)}` : t('daily.none')}</dd>
                    <dt className="text-muted">{t('daily.records.colMortality')}</dt>
                    <dd className={`text-right ${r.mortality > 0 ? 'text-alert' : ''}`}>
                      {r.mortality || 0}
                      {r.mortality > 0 && r.mortality_cause ? `, ${causeLabel(r.mortality_cause)}` : ''}
                    </dd>
                    {(r.dissolved_oxygen != null || r.temperature_c != null) && (
                      <>
                        <dt className="text-muted">{t('daily.records.water')}</dt>
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
            <div className="hidden md:block">
              <Table
                title={t('daily.records.tableTitle')}
                columns={columns}
                rows={records}
                rowKey={(r) => idOf(r)}
              />
            </div>
          </>
        )}

      {editing && (
        <EditSheet
          record={editing}
          cages={cages}
          feedTypes={feedTypes}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
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
      </div>
    </Layout>
  )
}
