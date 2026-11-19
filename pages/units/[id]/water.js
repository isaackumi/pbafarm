import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import UnitTabs from '../../../components/UnitTabs'
import WaterQualityForm from '../../../components/WaterQualityForm'
import Link from 'next/link'
import { Droplets } from 'lucide-react'
import { Button, EmptyState, Field, GhostButton, GradientButton, Input, LoadingState, Pill, Segmented, Select, Table, Textarea } from '../../../components/ui'
import { FilterSelect } from '../../../components/units/UnitViewSwitch'
import { usePermissions } from '../../../hooks/usePermission'
import { useT } from '../../../lib/i18n/context'
import { useToast } from '../../../components/Toast'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../convex/_generated/api'
import { WQ_PARAMETERS } from '../../../convex/lib/waterQuality'
import { errorMessage } from '../../../lib/errorMessage'
import { formatDate, localToday, unitLabel } from '../../../lib/format'

const card = 'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'

const WaterQualityChart = dynamic(() => import('../../../components/charts/WaterQualityChart'), {
  ssr: false,
  loading: () => <div className="h-full grid place-items-center text-sm text-muted">Loading chart…</div>,
})

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

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
  const t = useT()
  const { can } = usePermissions()
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
    return <Layout title={t('waterUi.title')}><LoadingState /></Layout>
  }
  if (ws === null) {
    return <Layout title={t('waterUi.title')}><EmptyState title={t('cageDetail.notFound')} action={<Button href="/units">{t('cageDetail.back')}</Button>} /></Layout>
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

  const head = 'flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5'
  const h2 = 'text-[17px] font-semibold leading-[22px] text-text'

  return (
    <Layout
      title={unit.name}
      eyebrow={
        <>
          <Link href="/cages" className="hover:text-text hover:underline">{unitLabel(ws.unitType, { plural: true })}</Link>
          {ws.group?.name ? ` / ${ws.group.name}` : ''} · {t('waterUi.thresholdsFor', { units: unitLabel(ws.unitType, { plural: true }).toLowerCase() })}
        </>
      }
      actions={
        can('production.daily.record') && (
          <GradientButton href="#log-reading" icon={Droplets}>
            {t('waterUi.logReading')}
          </GradientButton>
        )
      }
    >
      <div className="flex flex-col gap-7">
        <UnitTabs unitId={id} active="water" unitType={ws.unitType} />

        <section aria-labelledby="trend-title" className={card}>
          <div className={head}>
            <h2 id="trend-title" className={h2}>{t('waterUi.trend')}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect label={t('waterUi.parameter')} value={param} onChange={setParam}>
                {(present.length ? present : ['dissolvedOxygen']).map((k) => (
                  <option key={k} value={k}>{WQ_PARAMETERS[k].label}</option>
                ))}
              </FilterSelect>
              <Segmented
                label={t('waterUi.range')}
                options={RANGES.map((r) => ({ value: String(r.days), label: t('waterUi.days', { count: r.days }) }))}
                value={String(days)}
                onChange={(v) => setDays(Number(v))}
              />
            </div>
          </div>
          <div className="p-6">
            {points.length < 2 ? (
              <p className="text-sm text-muted">
                {points.length === 0 ? t('waterUi.noParam') : t('waterUi.oneReading')}
              </p>
            ) : (
              <div className="h-64">
                <WaterQualityChart points={points} range={range} unit={spec.unit} label={spec.label} />
              </div>
            )}
            {range && (
              <p className="mt-3 text-xs text-faint">
                {t('waterUi.threshold')}: {range.min != null ? `min ${range.min}` : ''}
                {range.min != null && range.max != null ? ', ' : ''}
                {range.max != null ? `max ${range.max}` : ''} {spec.unit}
              </p>
            )}
          </div>
        </section>

        {can('production.daily.record') && (
          <section id="log-reading" aria-labelledby="log-title" className={`${card} scroll-mt-24`}>
            <div className={head}>
              <div className="flex flex-col gap-1">
                <h2 id="log-title" className={h2}>{t('waterUi.logReading')}</h2>
                <p className="text-xs text-muted">{t('waterUi.logHint')}</p>
              </div>
            </div>
            <div className="p-6">
              <WaterQualityForm unitType={ws.unitType} onSave={save} />
            </div>
          </section>
        )}

        {!log ? (
          <LoadingState />
        ) : log.rows.length === 0 ? (
          <section className={card}>
            <EmptyState title={t('waterUi.noReadings')} description={t('waterUi.noReadingsBody')} />
          </section>
        ) : (
          <Table
            title={t('waterUi.readings')}
            columns={[
              {
                key: 'when',
                header: t('waterUi.when'),
                render: (r) => (
                  <span className="whitespace-nowrap tabular-nums">
                    {r.date && r.source !== 'manual' ? formatDate(r.date) : new Date(r.measuredAt).toLocaleString()}
                  </span>
                ),
              },
              { key: 'source', header: t('waterUi.source'), render: (r) => <span className="text-muted">{t.or(`waterUi.sourceLabel.${r.source}`, r.source)}</span> },
              ...present.map((k) => ({
                key: k,
                header: WQ_PARAMETERS[k].short,
                align: 'right',
                render: (r) => {
                  const bad = r.breaches.some((b) => b.parameter === k)
                  return <span className={`tabular-nums ${bad ? 'font-medium text-alert' : ''}`}>{fmt(r.values[k])}</span>
                },
              })),
            ]}
            rows={log.rows.slice(0, 100)}
            rowKey={(r) => r.id}
          />
        )}

        <section aria-labelledby="events-title" className={card}>
          <div className={head}>
            <div className="flex flex-col gap-1">
              <h2 id="events-title" className={h2}>{isPond ? t('waterUi.management') : t('waterUi.events')}</h2>
              <p className="text-xs text-muted">{t('waterUi.eventsHint')}</p>
            </div>
          </div>
          <div className="p-6">
            {can('production.daily.record') && <WaterEventForm unitId={id} />}
            {events && events.length > 0 && (
              <ul className="mt-5 text-sm">
                {events.map((e) => (
                  <li key={e._id} className="flex flex-wrap justify-between gap-2 border-t border-line py-[11px]">
                    <span>
                      <span className="tabular-nums text-muted">{formatDate(e.date)}</span>{' '}
                      <span className="font-medium text-text">{EVENT_KINDS.find((k) => k.value === e.kind)?.label || e.kind}</span>
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
          </div>
        </section>

        <section aria-labelledby="treat-title" className={card}>
          <div className={head}>
            <h2 id="treat-title" className={h2}>{t('waterUi.treatments')}</h2>
            <GhostButton size="sm" href="/health">{t('waterUi.recordTreatment')}</GhostButton>
          </div>
          {!treatments || treatments.length === 0 ? (
            <p className="px-6 py-5 text-sm text-muted">{t('waterUi.noTreatments')}</p>
          ) : (
            <ul className="text-sm">
              {treatments.slice(0, 20).map((tr) => (
                <li key={tr.id || tr._id} className="flex flex-wrap justify-between gap-2 border-t border-line px-6 py-[11px] first:border-t-0">
                  <span>
                    <span className="tabular-nums text-muted">{formatDate(tr.date)}</span> <span className="text-text">{tr.treatment}</span>
                    {tr.product_name ? ` · ${tr.product_name}` : ''}
                  </span>
                  {tr.withdrawal_until && (
                    <Pill tone="amber">{t('waterUi.withdrawalUntil', { date: formatDate(tr.withdrawal_until) })}</Pill>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
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
