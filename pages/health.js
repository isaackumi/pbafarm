import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Plus, X } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  Button,
  FormCard,
  FormSection,
  FormActions,
  Field,
  GhostButton,
  GradientButton,
  IfPermitted,
  Input,
  KpiStrip,
  Select,
  StatusDot,
  Table,
  Textarea,
} from '../components/ui'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useToast } from '../components/Toast'
import LocationMetaField from '../components/LocationMetaField'
import DoTrendCard from '../components/health/DoTrendCard'
import { waterLogColumns } from '../components/health/WaterLog'
import { DIAGNOSIS_SUGGESTIONS } from '../lib/farmHealth'
import { addDays, formatDate, formatNumber, getActiveLocale, localToday } from '../lib/format'
import { shortDate } from '../lib/projectsView'
import {
  activeTreatments,
  doTrend,
  mainUnitType,
  waterRows,
  waterSummary,
  withdrawalSummary,
} from '../lib/healthWater'
import { usePermission } from '../hooks/usePermission'
import { useLocale, useT } from '../lib/i18n/context'
import Attachments from '../components/Attachments'

const EMPTY_FORM = {
  cageId: '',
  date: '',
  diagnosis: '',
  treatment: '',
  productName: '',
  dosage: '',
  fishAffected: '',
  withdrawalDays: '',
  administeredBy: '',
  notes: '',
}

/** Paper 07 "Log water" glyph (pen and baseline). */
function PenIcon({ size = 16, strokeWidth = 2, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
    </svg>
  )
}

/** Paper 07 dates: "Nov 26". */
const dayMonth = (iso) => shortDate(iso, getActiveLocale()) || '—'

export default function HealthPage() {
  const t = useT()
  const [showForm, setShowForm] = useState(false)
  return (
    <ProtectedRoute>
      <Layout
        title={t('healthWater.title')}
        eyebrow={t('healthWater.eyebrow')}
        actions={
          <>
            <IfPermitted permission="production.daily.record">
              <GradientButton href="/water-entry" variant="lime" icon={PenIcon}>
                {t('healthWater.logWater')}
              </GradientButton>
            </IfPermitted>
            <IfPermitted permission="production.health.record">
              <GradientButton ring="sky" icon={Plus} onClick={() => setShowForm(true)} aria-expanded={showForm}>
                {t('healthWater.newTreatment')}
              </GradientButton>
            </IfPermitted>
          </>
        }
      >
        <HealthTreatments showForm={showForm} setShowForm={setShowForm} />
      </Layout>
    </ProtectedRoute>
  )
}

function HealthTreatments({ showForm, setShowForm }) {
  const t = useT()
  const { locale } = useLocale()
  const { user } = useAuth()
  const isAdmin = usePermission('production.records.delete')
  const { locationArgs } = useLocation()
  const { showToast } = useToast()

  const cages = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const treatments = useQuery(api.health.list, user ? locationArgs : 'skip')
  // asOf: the client's today, so the list rolls over at midnight.
  const today = localToday()
  const withdrawals = useQuery(
    api.health.activeWithdrawals,
    user ? { ...locationArgs, asOf: today } : 'skip',
  )
  const latest = useQuery(api.waterQuality.latestByUnit, user ? locationArgs : 'skip')
  const thresholds = useQuery(api.waterQuality.thresholds, user ? {} : 'skip')
  const records = useQuery(
    api.dailyRecords.list,
    user ? { ...locationArgs, dateFrom: addDays(today, -6), dateTo: today } : 'skip',
  )
  const createTreatment = useMutation(api.health.create)
  const removeTreatment = useMutation(api.health.remove)
  // Treatment whose documents (vet reports, prescriptions) are open.
  const [docsFor, setDocsFor] = useState(null)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const logRef = useRef(null)

  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM, date: today })

  const activeCages = useMemo(
    () => (cages || []).filter((c) => c.status === 'active' || c.status === 'harvesting'),
    [cages],
  )
  const byType = thresholds?.byUnitType
  const rows = useMemo(() => waterRows(cages, latest, byType), [cages, latest, byType])
  const summary = useMemo(() => waterSummary(rows), [rows])
  const trend = useMemo(() => doTrend(records, today), [records, today])
  const doLimit = byType?.[mainUnitType(cages)]?.dissolvedOxygen?.min ?? null
  const active = useMemo(() => activeTreatments(treatments, today), [treatments, today])
  const hold = useMemo(() => withdrawalSummary(withdrawals), [withdrawals])

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (!form.cageId) throw new Error(t('healthWater.form.errUnit'))
      if (!form.treatment.trim()) throw new Error(t('healthWater.form.errTreatment'))
      await createTreatment({
        cageId: form.cageId,
        date: form.date,
        diagnosis: form.diagnosis.trim() || undefined,
        treatment: form.treatment.trim(),
        productName: form.productName.trim() || undefined,
        dosage: form.dosage.trim() || undefined,
        fishAffected:
          form.fishAffected !== '' ? Number(form.fishAffected) : undefined,
        withdrawalDays:
          form.withdrawalDays !== '' ? Number(form.withdrawalDays) : undefined,
        administeredBy: form.administeredBy.trim() || undefined,
        notes: form.notes.trim() || undefined,
      })
      showToast('success', t('healthWater.form.saved'))
      setShowForm(false)
      setForm({ ...EMPTY_FORM, date: localToday() })
    } catch (err) {
      showToast('error', err.message || t('healthWater.form.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }))
  const q = search.trim().toLowerCase()
  const loaded = cages !== undefined && latest !== undefined
  const fmt1 = (v) => (v == null ? '—' : formatNumber(v, { decimals: 1 }))

  const showTreatments = () => {
    setTab('treatments')
    logRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const treatmentRows = (treatments || []).filter(
    (r) => !q || `${r.cage_name} ${r.treatment} ${r.diagnosis || ''}`.toLowerCase().includes(q),
  )
  const logRows = rows
    .filter((r) => tab !== 'alerts' || r.breachCount > 0)
    .filter((r) => !q || String(r.unit.name).toLowerCase().includes(q))
  const docsRow = docsFor && (treatments || []).find((r) => (r.id || r._id) === docsFor)

  const treatmentColumns = [
    { key: 'date', header: t('healthWater.table.date'), width: 130, render: (r) => <span className="tabular-nums">{formatDate(r.date)}</span> },
    { key: 'cage', header: t('healthWater.log.col.unit'), width: 120, render: (r) => <span className="font-medium">{r.cage_name}</span> },
    { key: 'diagnosis', header: t('healthWater.table.diagnosis'), render: (r) => <span className="text-muted">{r.diagnosis || '—'}</span> },
    {
      key: 'treatment',
      header: t('healthWater.table.treatment'),
      render: (r) => r.treatment,
      sub: (r) => (r.product_name ? `${r.product_name}${r.dosage ? ` · ${r.dosage}` : ''}` : null),
    },
    {
      key: 'withdrawal',
      header: t('healthWater.table.withdrawal'),
      width: 140,
      render: (r) => <span className="tabular-nums">{r.withdrawal_until ? formatDate(r.withdrawal_until) : '—'}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('healthWater.table.actions')}</span>,
      align: 'right',
      width: 190,
      render: (r) => {
        const id = r.id || r._id
        return (
          <span className="inline-flex items-center justify-end gap-3 whitespace-nowrap">
            <button
              type="button"
              className="text-[13px] text-pearl-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan rounded-sm"
              aria-expanded={docsFor === id}
              onClick={() => setDocsFor(docsFor === id ? null : id)}
            >
              {t('healthWater.table.documents')}
            </button>
            {isAdmin && (
              <button
                type="button"
                className="text-[13px] text-alert hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan rounded-sm"
                onClick={async () => {
                  try {
                    await removeTreatment({ id })
                    showToast('success', t('healthWater.table.deleted'))
                  } catch (err) {
                    showToast('error', err.message)
                  }
                }}
              >
                {t('healthWater.table.delete')}
              </button>
            )}
          </span>
        )
      },
    },
  ]

  return (
    <div data-tour="page-health" className="flex flex-col gap-[28px]">
      <KpiStrip
        items={[
          {
            key: 'do',
            label: t('healthWater.kpi.avgDo'),
            value: loaded ? (summary.avgDo == null ? '—' : `${fmt1(summary.avgDo)} mg/L`) : '—',
            suffix: summary.lowDoUnits > 0 ? t('healthWater.kpi.belowThreshold', { count: summary.lowDoUnits }) : null,
          },
          {
            key: 'temp',
            label: t('healthWater.kpi.waterTemp'),
            value: loaded && summary.avgTemp != null ? `${fmt1(summary.avgTemp)} °C` : '—',
          },
          {
            key: 'active',
            label: t('healthWater.kpi.activeTreatments'),
            value: treatments === undefined ? '—' : active.length,
          },
          {
            key: 'withdrawal',
            label: t('healthWater.kpi.inWithdrawal'),
            value: withdrawals === undefined ? '—' : t('healthWater.kpi.units', { count: hold.units }),
            suffix: hold.lastUntil ? t('healthWater.kpi.noHarvestUntil', { date: dayMonth(hold.lastUntil) }) : null,
          },
        ]}
      />

      {showForm && (
        <FormCard>
          <form onSubmit={submit}>
            <FormSection title={t('healthWater.form.title')}>
              <div className="mb-4">
                <LocationMetaField />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={t('healthWater.form.unit')} htmlFor="ht-cage" required>
                  <Select id="ht-cage" value={form.cageId} onChange={set('cageId')} required>
                    <option value="">{t('healthWater.form.selectUnit')}</option>
                    {activeCages.map((c) => (
                      <option key={c.id || c._id} value={c.id || c._id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('healthWater.form.date')} htmlFor="ht-date" required>
                  <Input id="ht-date" type="date" value={form.date} onChange={set('date')} required />
                </Field>
                <Field label={t('healthWater.form.diagnosis')} htmlFor="ht-dx">
                  <Input
                    id="ht-dx"
                    list="dx-suggestions"
                    value={form.diagnosis}
                    onChange={set('diagnosis')}
                    placeholder={t('healthWater.form.optional')}
                  />
                  <datalist id="dx-suggestions">
                    {DIAGNOSIS_SUGGESTIONS.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </Field>
                <Field label={t('healthWater.form.treatment')} htmlFor="ht-tx" required>
                  <Input
                    id="ht-tx"
                    value={form.treatment}
                    onChange={set('treatment')}
                    required
                    placeholder={t('healthWater.form.treatmentPlaceholder')}
                  />
                </Field>
                <Field label={t('healthWater.form.product')} htmlFor="ht-product">
                  <Input id="ht-product" value={form.productName} onChange={set('productName')} />
                </Field>
                <Field label={t('healthWater.form.dosage')} htmlFor="ht-dose">
                  <Input id="ht-dose" value={form.dosage} onChange={set('dosage')} />
                </Field>
                <Field label={t('healthWater.form.fishAffected')} htmlFor="ht-fish">
                  <Input
                    id="ht-fish"
                    type="number"
                    min="0"
                    className="font-data"
                    value={form.fishAffected}
                    onChange={set('fishAffected')}
                  />
                </Field>
                <Field label={t('healthWater.form.withdrawalDays')} htmlFor="ht-wd">
                  <Input
                    id="ht-wd"
                    type="number"
                    min="0"
                    className="font-data"
                    value={form.withdrawalDays}
                    onChange={set('withdrawalDays')}
                    placeholder={t('healthWater.form.withdrawalPlaceholder')}
                  />
                </Field>
                <Field label={t('healthWater.form.administeredBy')} htmlFor="ht-by">
                  <Input id="ht-by" value={form.administeredBy} onChange={set('administeredBy')} />
                </Field>
                <Field label={t('healthWater.form.notes')} htmlFor="ht-notes" className="md:col-span-2">
                  <Textarea id="ht-notes" rows={2} value={form.notes} onChange={set('notes')} />
                </Field>
              </div>
            </FormSection>
            <FormActions>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </FormActions>
          </form>
        </FormCard>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <DoTrendCard points={trend} threshold={doLimit} loading={records === undefined} />
        <section
          aria-labelledby="active-treatments-title"
          className="flex min-w-0 flex-col gap-1 rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)]"
        >
          <div className="flex items-center justify-between pb-[10px]">
            <h2 id="active-treatments-title" className="text-[15px] font-semibold leading-[18px] text-text">
              {t('healthWater.active.title')}
            </h2>
            <button
              type="button"
              onClick={showTreatments}
              className="text-[13px] leading-4 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan rounded-sm"
            >
              {t('healthWater.active.viewAll')}
            </button>
          </div>
          {treatments === undefined ? (
            <p className="border-t border-line py-[11px] text-sm text-muted">{t('ui.loading')}</p>
          ) : active.length === 0 ? (
            <p className="border-t border-line py-[11px] text-sm text-muted">{t('healthWater.active.empty')}</p>
          ) : (
            <ul>
              {active.slice(0, 5).map((r) => (
                <li key={r.id || r._id} className="flex items-center gap-[14px] border-t border-line py-[11px]">
                  <StatusDot
                    tone={r.inWithdrawal ? 'alert' : 'warn'}
                    size={7}
                    label={r.inWithdrawal ? t('healthWater.active.inWithdrawal') : t('healthWater.active.recent')}
                  />
                  <div className="flex min-w-0 grow basis-0 flex-col gap-[2px]">
                    <div className="truncate text-[14px] leading-[18px] text-text">
                      {r.cage_name} · {r.treatment}
                    </div>
                    <div className="truncate text-xs leading-4 text-muted">
                      {[dayMonth(r.date), r.administered_by].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="shrink-0 text-[14px] font-medium leading-[18px] text-text tabular-nums">
                    {r.inWithdrawal
                      ? t('healthWater.active.until', { date: dayMonth(r.withdrawal_until) })
                      : t('healthWater.active.noWithdrawal')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div ref={logRef} className="scroll-mt-6">
        {tab === 'treatments' ? (
          <Table
            title={t('healthWater.log.title')}
            tabsLabel={t('healthWater.log.filter')}
            tabs={logTabs(t)}
            tab={tab}
            onTabChange={setTab}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={t('healthWater.log.search')}
            columns={treatmentColumns}
            rows={treatmentRows}
            empty={treatments === undefined ? t('ui.loading') : t('healthWater.table.empty')}
          />
        ) : (
          <Table
            title={t('healthWater.log.title')}
            tabsLabel={t('healthWater.log.filter')}
            tabs={logTabs(t)}
            tab={tab}
            onTabChange={setTab}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={t('healthWater.log.search')}
            rowKey={(r) => r.unit.id || r.unit._id}
            columns={waterLogColumns(t, locale)}
            rows={logRows}
            empty={
              !loaded ? t('ui.loading') : tab === 'alerts' ? t('healthWater.log.emptyAlerts') : t('healthWater.log.empty')
            }
          />
        )}
      </div>

      {tab === 'treatments' && docsRow && (
        <section
          aria-label={t('healthWater.table.documentsFor', { name: `${docsRow.cage_name} · ${docsRow.treatment}` })}
          className="rounded-card border border-line bg-surface px-6 py-5 shadow-[var(--shadow-card)]"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold leading-[18px] text-text">
              {t('healthWater.table.documentsFor', { name: `${docsRow.cage_name} · ${docsRow.treatment}` })}
            </h2>
            <GhostButton size="sm" icon={X} onClick={() => setDocsFor(null)}>
              {t('common.close')}
            </GhostButton>
          </div>
          <Attachments entityType="healthTreatments" entityId={docsFor} />
        </section>
      )}
    </div>
  )
}

const logTabs = (t) => [
  { value: 'all', label: t('healthWater.log.all') },
  { value: 'alerts', label: t('healthWater.log.alerts') },
  { value: 'treatments', label: t('healthWater.log.treatments') },
]
