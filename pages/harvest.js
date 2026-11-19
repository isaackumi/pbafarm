import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Download, Pencil, Plus } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  Field,
  GhostButton,
  GradientButton,
  IfPermitted,
  Input,
  KpiStrip,
  Modal,
  Pill,
  Select,
  StatusDot,
  Table,
  Textarea,
} from '../components/ui'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import HarvestForm from '../components/HarvestForm'
import SamplingForm from '../components/SamplingForm'
import { ReadyToHarvestCard, SizeGradesCard, formatKg } from '../components/harvest/HarvestCards'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { harvestPatchArgs } from '../lib/recordArgs'
import { errorMessage } from '../lib/errorMessage'
import { formatDate, formatNumber, localToday } from '../lib/format'
import {
  inDateRange,
  lastGradedHarvest,
  lotState,
  lotsByHarvest,
  monthTotals,
  readyCages,
} from '../lib/harvestView'
import { useLocale, useT } from '../lib/i18n/context'
import { usePermission } from '../hooks/usePermission'

const NO_RECORDS = []
const EMPTY_EDIT = {
  harvest_date: '',
  harvest_type: 'complete',
  total_weight: '',
  average_body_weight: '',
  estimated_count: '',
  notes: '',
  status: 'completed',
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportCsv(records) {
  const data = records.map((r) => ({
    'Cage Name': r.cage?.name || 'Unknown',
    'Cage Code': r.cage?.code || 'Unknown',
    'Harvest Date': r.harvest_date,
    'Harvest Type': r.harvest_type,
    Status: r.status,
    'Total Weight (kg)': r.total_weight,
    'Average Body Weight (g)': r.average_body_weight,
    'Estimated Count': r.estimated_count,
    FCR: r.fcr,
    'Size Breakdown': JSON.stringify(r.size_breakdown),
    Notes: r.notes,
  }))
  const headers = Object.keys(data[0])
  const csv = [headers.join(','), ...data.map((row) => headers.map((h) => csvCell(row[h])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `harvest_records_${localToday()}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function EditHarvestModal({ record, onClose }) {
  const t = useT()
  const { showToast } = useToast()
  const updateHarvest = useMutation(api.harvest.update)
  const [form, setForm] = useState(() => ({
    harvest_date: record.harvest_date || '',
    harvest_type: record.harvest_type || 'complete',
    total_weight: record.total_weight ?? '',
    average_body_weight: record.average_body_weight ?? '',
    estimated_count: record.estimated_count ?? '',
    notes: record.notes || '',
    status: record.status || 'completed',
  }))
  const [saving, setSaving] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const result = await updateHarvest({
        id: record.id || record._id,
        patch: harvestPatchArgs({
          ...form,
          total_weight: Number(form.total_weight),
          average_body_weight: Number(form.average_body_weight),
          estimated_count: form.estimated_count === '' ? undefined : Number(form.estimated_count),
        }),
      })
      showToast(t('harvestPage.toast.updated'), 'success')
      if (result?.warnings?.length) showToast(result.warnings.join('. '), 'warning')
      onClose()
    } catch (err) {
      showToast(errorMessage(err, t('harvestPage.toast.updateFailed')), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      as="form"
      onSubmit={submit}
      onClose={onClose}
      showClose
      title={t('harvestPage.edit.title', { cage: record.cage?.name || '—' })}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>{t('common.cancel')}</GhostButton>
          <GradientButton type="submit" variant="solid" size="sm" disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </GradientButton>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('harvest.date')} htmlFor="he-date" required>
          <Input id="he-date" type="date" required value={form.harvest_date} onChange={set('harvest_date')} />
        </Field>
        <Field label={t('harvest.type')} htmlFor="he-type">
          <Select id="he-type" value={form.harvest_type} onChange={set('harvest_type')}>
            <option value="complete">{t('harvest.complete')}</option>
            <option value="partial">{t('harvest.partial')}</option>
          </Select>
        </Field>
        <Field label={t('harvest.totalWeightKg')} htmlFor="he-weight" required>
          <Input id="he-weight" type="number" step="any" min="0" inputMode="decimal" required value={form.total_weight} onChange={set('total_weight')} />
        </Field>
        <Field label={t('harvest.abwG')} htmlFor="he-abw" required>
          <Input id="he-abw" type="number" step="any" min="0" inputMode="decimal" required value={form.average_body_weight} onChange={set('average_body_weight')} />
        </Field>
        <Field label={t('harvest.estimatedCount')} htmlFor="he-count">
          <Input id="he-count" type="number" min="0" inputMode="numeric" value={form.estimated_count} onChange={set('estimated_count')} />
        </Field>
        <Field label={t('harvestPage.edit.status')} htmlFor="he-status">
          <Select id="he-status" value={form.status} onChange={set('status')}>
            <option value="completed">{t('harvestPage.edit.completed')}</option>
            <option value="in_progress">{t('harvestPage.edit.inProgress')}</option>
          </Select>
        </Field>
        <Field label={t('common.notes')} htmlFor="he-notes" className="sm:col-span-2">
          <Textarea id="he-notes" value={form.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Modal>
  )
}

function LotStatus({ summary, locale, t }) {
  const state = lotState(summary)
  if (state === 'none') return <span className="text-[13px] leading-4 text-faint">{t('harvestPage.lot.none')}</span>
  return (
    <span className="flex items-center gap-2">
      <StatusDot tone={state === 'open' ? 'good' : 'neutral'} />
      <span className="text-[13px] leading-4 text-muted">
        {state === 'open'
          ? t('harvestPage.lot.open', { sent: formatKg(summary.dispatched, locale) })
          : t('harvestPage.lot.out')}
      </span>
    </span>
  )
}

const Harvest = ({ mode, setMode }) => {
  const t = useT()
  const { locale } = useLocale()
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const { showToast } = useToast()
  const canDelete = usePermission('production.records.delete')
  const canCorrect = usePermission('production.harvest.correct')
  const canRecord = usePermission('production.harvest.record')
  const today = localToday()

  const harvestResult = useQuery(api.harvest.list, user ? locationArgs : 'skip')
  const lots = useQuery(api.traceability.listLots, user ? {} : 'skip')
  const readyResult = useQuery(api.cages.list, user ? { ...locationArgs, filter: 'harvest-ready' } : 'skip')
  const withdrawals = useQuery(api.health.activeWithdrawals, user ? { ...locationArgs, asOf: today } : 'skip')
  const removeHarvest = useMutation(api.harvest.remove)

  const records = harvestResult ?? NO_RECORDS
  const loading = harvestResult === undefined
  const [editing, setEditing] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [range, setRange] = useState({ start: '', end: '' })

  const totals = useMemo(() => monthTotals(records, today), [records, today])
  const graded = useMemo(() => lastGradedHarvest(records), [records])
  const lotMap = useMemo(() => lotsByHarvest(lots), [lots])
  const ready = useMemo(() => readyCages(readyResult, withdrawals, today), [readyResult, withdrawals, today])
  const openLots = (lots || []).filter((l) => l.remaining_kg > 0)
  const readyKg = ready.reduce((s, r) => s + (r.biomassKg || 0), 0)
  const monthName = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(`${today}T12:00:00Z`))

  const q = search.trim().toLowerCase()
  const shown = records.filter(
    (r) =>
      (tab === 'all' || (tab === 'full' ? r.harvest_type !== 'partial' : r.harvest_type === 'partial')) &&
      (!q || [r.cage?.name, r.cage?.code, ...(lotMap.get(r.id)?.codes || [])].some((s) => String(s || '').toLowerCase().includes(q))) &&
      inDateRange(r.harvest_date, range.start, range.end),
  )

  const handleExport = () => {
    if (!shown.length) return showToast(t('harvestPage.toast.nothingToExport'), 'info')
    try {
      exportCsv(shown)
    } catch {
      showToast(t('harvestPage.toast.exportFailed'), 'error')
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    try {
      const result = await removeHarvest({ id: deleteConfirm.id || deleteConfirm._id })
      showToast(t('harvestPage.toast.deleted'), 'success')
      if (result?.warnings?.length) showToast(result.warnings.join('. '), 'warning')
      setDeleteConfirm(null)
    } catch (err) {
      showToast(errorMessage(err, t('harvestPage.toast.deleteFailed')), 'error')
    }
  }

  const linkBtn = 'rounded text-[13px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan hover:underline underline-offset-2'
  const columns = [
    { key: 'date', header: t('harvestPage.col.date'), width: 110, render: (r) => formatDate(r.harvest_date, { locale }) },
    { key: 'cage', header: t('harvestPage.col.cage'), width: 110, render: (r) => r.cage?.name || '—' },
    {
      key: 'type',
      header: t('harvestPage.col.type'),
      width: 110,
      render: (r) =>
        r.harvest_type === 'partial' ? (
          <Pill tone="neutral">{t('harvestPage.type.partial')}</Pill>
        ) : (
          <Pill tone="green">{t('harvestPage.type.full')}</Pill>
        ),
    },
    {
      key: 'lot',
      header: t('harvestPage.col.lot'),
      render: (r) => {
        const codes = lotMap.get(r.id)?.codes || []
        return codes.length ? codes.join(', ') : <span className="text-faint">—</span>
      },
    },
    { key: 'fish', header: t('harvestPage.col.fish'), align: 'right', render: (r) => (r.estimated_count ? formatNumber(r.estimated_count, { locale }) : '—') },
    { key: 'weight', header: t('harvestPage.col.weight'), align: 'right', render: (r) => formatKg(r.total_weight, locale) },
    { key: 'status', header: t('harvestPage.col.status'), render: (r) => <LotStatus summary={lotMap.get(r.id)} locale={locale} t={t} /> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('harvestPage.col.actions')}</span>,
      align: 'right',
      render: (r) => (
        <span className="inline-flex gap-3 whitespace-nowrap">
          {canCorrect && (
            <button type="button" className={`${linkBtn} text-text`} onClick={() => setEditing(r)}>
              {t('common.edit')}
            </button>
          )}
          {canRecord && (
            <button type="button" className={`${linkBtn} text-text`} onClick={() => setMode({ sampling: r })}>
              {t('harvestPage.addSampling')}
            </button>
          )}
          {canDelete && (
            <button type="button" className={`${linkBtn} text-alert`} onClick={() => setDeleteConfirm(r)}>
              {t('harvestPage.delete')}
            </button>
          )}
        </span>
      ),
    },
  ]

  if (mode === 'harvest' || mode?.sampling) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <GhostButton onClick={() => setMode(null)}>{t('harvestPage.backToList')}</GhostButton>
        </div>
        {mode === 'harvest' ? (
          <HarvestForm onComplete={() => setMode(null)} />
        ) : (
          <div className="rounded-card border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
            <SamplingForm harvestId={mode.sampling.id} onComplete={() => setMode(null)} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[28px]">
      <KpiStrip
        items={[
          {
            key: 'month',
            label: t('harvestPage.kpi.harvested', { month: monthName }),
            value: loading ? '—' : formatKg(totals.thisMonth, locale),
            suffix:
              !loading && totals.changePct != null
                ? t('harvestPage.kpi.vsLast', { pct: `${totals.changePct > 0 ? '+' : ''}${totals.changePct}` })
                : null,
          },
          {
            key: 'abw',
            label: t('harvestPage.kpi.avgSize'),
            value: totals.avgAbw != null ? `${formatNumber(totals.avgAbw, { locale })} g` : '—',
            suffix: totals.avgAbw != null ? t('harvestPage.kpi.thisMonth') : null,
          },
          {
            key: 'ready',
            label: t('harvestPage.kpi.ready'),
            value: readyResult === undefined ? '—' : t('harvestPage.kpi.cages', { count: ready.length }),
            suffix: readyKg > 0 ? `~${formatKg(readyKg, locale)}` : null,
          },
          {
            key: 'lots',
            label: t('harvestPage.kpi.openLots'),
            value: lots === undefined ? '—' : openLots.length,
            suffix: lots === undefined ? null : t('harvestPage.kpi.forSale'),
          },
        ]}
      />

      <div className="flex flex-col gap-5 lg:flex-row">
        <SizeGradesCard record={graded} className="lg:grow-[1.4] lg:basis-0" />
        <ReadyToHarvestCard rows={ready} loading={readyResult === undefined} className="lg:grow lg:basis-0" />
      </div>

      <Table
        title={t('harvestPage.table.title')}
        tabsLabel={t('harvestPage.table.filter')}
        tabs={[
          { value: 'all', label: t('harvestPage.table.all') },
          { value: 'full', label: t('harvestPage.type.full') },
          { value: 'partial', label: t('harvestPage.type.partial') },
        ]}
        tab={tab}
        onTabChange={setTab}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('harvestPage.table.search')}
        actions={
          <>
            <input
              type="date"
              aria-label={t('harvestPage.table.from')}
              value={range.start}
              onChange={(e) => setRange((p) => ({ ...p, start: e.target.value }))}
              className="h-8 rounded-pill border border-line bg-transparent px-3 text-[13px] leading-4 text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            />
            <input
              type="date"
              aria-label={t('harvestPage.table.to')}
              value={range.end}
              onChange={(e) => setRange((p) => ({ ...p, end: e.target.value }))}
              className="h-8 rounded-pill border border-line bg-transparent px-3 text-[13px] leading-4 text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            />
            <GhostButton size="sm" icon={Download} onClick={handleExport}>
              {t('harvestPage.table.export')}
            </GhostButton>
          </>
        }
        columns={columns}
        rows={shown}
        rowKey={(r) => r.id}
        empty={
          loading
            ? t('ui.loading')
            : records.length
              ? `${t('harvest.listNoMatch')} ${t('harvest.listNoMatchHint')}`
              : `${t('harvest.listEmpty')} ${t('harvest.listEmptyHint')}`
        }
      />

      {editing && <EditHarvestModal record={editing} onClose={() => setEditing(null)} />}
      <ConfirmDeleteModal
        open={Boolean(deleteConfirm)}
        title={t('harvestPage.deleteTitle')}
        message={t('harvestPage.deleteMessage', {
          cage: deleteConfirm?.cage?.name || '—',
          date: deleteConfirm ? formatDate(deleteConfirm.harvest_date, { locale }) : '',
        })}
        confirmLabel={t('harvestPage.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}

export default function HarvestPage() {
  const t = useT()
  // null (list), 'harvest' (new harvest form) or { sampling: record }.
  const [mode, setMode] = useState(null)
  return (
    <ProtectedRoute>
      <Layout
        title={t('harvestPage.title')}
        eyebrow={t('harvestPage.eyebrow')}
        actions={
          <IfPermitted permission="production.harvest.record">
            <GradientButton icon={Plus} onClick={() => setMode('harvest')}>
              {t('harvestPage.record')}
            </GradientButton>
            <GradientButton reverse icon={Pencil} href="/harvest-sampling">
              {t('harvestPage.sampling')}
            </GradientButton>
          </IfPermitted>
        }
      >
        <Harvest mode={mode} setMode={setMode} />
      </Layout>
    </ProtectedRoute>
  )
}
