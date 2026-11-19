import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { Download, Plus, Printer } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import {
  EmptyState,
  Field,
  GhostButton,
  GradientButton,
  IfPermitted,
  Input,
  KpiStrip,
  Modal,
  Select,
  Textarea,
} from '../../components/ui'
import Attachments from '../../components/Attachments'
import TraceTimeline, { describeStep } from '../../components/trace/TraceTimeline'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { errorCode, errorMessage } from '../../lib/errorMessage'
import { formatDate, formatNumber, localToday } from '../../lib/format'
import { usePermission } from '../../hooks/usePermission'
import { traceCsv } from '../../lib/traceCsv'
import { lotTimeline, maxDispatchTemp, withdrawalSummary } from '../../lib/traceView'
import { useLocale, useT } from '../../lib/i18n/context'

const CARD = 'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'
const TONE_TEXT = { good: 'text-good', warn: 'text-warn', alert: 'text-alert', cyan: 'text-pearl-cyan', muted: 'text-muted' }

function CardHead({ title, meta }) {
  return (
    <div className="flex items-center justify-between gap-3 pb-3">
      <h2 className="text-[15px] font-semibold leading-[18px] text-text">{title}</h2>
      {meta != null && <div className="text-[13px] leading-4 text-muted">{meta}</div>}
    </div>
  )
}

function DispatchModal({ lot, onClose }) {
  const t = useT()
  const { locale } = useLocale()
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
  const left = formatNumber(lot.remaining_kg, { locale, decimals: 1 })

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
      showToast('success', t('tracePage.dispatch.saved'))
      onClose()
    } catch (err) {
      if (errorCode(err) === 'WITHDRAWAL_ACTIVE') setBlocked(errorMessage(err))
      showToast('error', errorMessage(err, t('tracePage.dispatch.failed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      as="form"
      onSubmit={submit}
      noValidate
      onClose={onClose}
      showClose
      title={t('tracePage.dispatch.title', { code: lot.lot_code })}
      description={t('tracePage.dispatch.left', { kg: left })}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>{t('common.cancel')}</GhostButton>
          <GradientButton type="submit" variant="solid" size="sm" disabled={saving}>
            {saving ? t('common.saving') : t('tracePage.dispatch.submit')}
          </GradientButton>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('tracePage.dispatch.date')} htmlFor="d-date" required>
          <Input id="d-date" type="date" value={form.dispatchDate} onChange={set('dispatchDate')} />
        </Field>
        <Field label={t('tracePage.dispatch.weight')} htmlFor="d-weight" hint={t('tracePage.dispatch.left', { kg: left })}>
          <Input id="d-weight" type="number" step="0.1" inputMode="decimal" value={form.weightKg} placeholder={String(lot.remaining_kg)} onChange={set('weightKg')} />
        </Field>
        <Field label={t('tracePage.dispatch.customer')} htmlFor="d-customer" required>
          <Select id="d-customer" value={form.customerId} onChange={set('customerId')}>
            <option value="">{t('tracePage.dispatch.otherBuyer')}</option>
            {(customers || []).filter((c) => c.active).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        {!form.customerId && (
          <Field label={t('tracePage.dispatch.buyerName')} htmlFor="d-buyer" required>
            <Input id="d-buyer" value={form.customerName} onChange={set('customerName')} />
          </Field>
        )}
        <Field label={t('tracePage.dispatch.vehicle')} htmlFor="d-vehicle" hint={t('tracePage.dispatch.vehicleHint')}>
          <Input id="d-vehicle" value={form.vehicle} onChange={set('vehicle')} />
        </Field>
        <Field label={t('tracePage.dispatch.driver')} htmlFor="d-driver">
          <Input id="d-driver" value={form.driver} onChange={set('driver')} />
        </Field>
        <Field label={t('tracePage.dispatch.temperature')} htmlFor="d-temp">
          <Input id="d-temp" type="number" step="0.1" inputMode="decimal" value={form.temperatureC} onChange={set('temperatureC')} />
        </Field>
        <Field label={t('common.notes')} htmlFor="d-notes" className="sm:col-span-2">
          <Textarea id="d-notes" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
        {blocked && (
          <div role="alert" className="flex flex-col gap-3 rounded-input border border-[var(--pill-red-border)] px-4 py-3 text-[13px] leading-[18px] text-text sm:col-span-2">
            <p>{blocked}</p>
            {isAdmin ? (
              <Field label={t('tracePage.dispatch.overrideReason')} htmlFor="d-reason" required>
                <Textarea id="d-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('tracePage.dispatch.overrideHint')} />
              </Field>
            ) : (
              <p className="text-muted">{t('tracePage.dispatch.askAdmin')}</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function FeedLots({ feed }) {
  const t = useT()
  const { locale } = useLocale()
  if (!feed.length) return null
  return (
    <section className={`${CARD} px-[26px] py-6`}>
      <CardHead title={t('tracePage.feedLots')} meta={t('tracePage.feedLotsHint')} />
      <ul className="flex flex-col">
        {feed.map((f) => (
          <li key={f.feed_type} className="flex flex-col gap-[2px] border-t border-line py-[11px]">
            <div className="flex justify-between gap-3 text-[14px] leading-[18px] text-text">
              <span>{f.feed_type}</span>
              <span className="tabular-nums">{formatNumber(f.kg_fed, { locale, decimals: 1 })} kg</span>
            </div>
            <div className="text-xs leading-4 text-muted">
              {formatDate(f.first_fed, { locale })} → {formatDate(f.last_fed, { locale })}
              {' · '}
              {f.lots.length
                ? f.lots.map((l) => [l.lot_number || t('tracePage.noLotNumber'), l.supplier, l.po_number].filter(Boolean).join(' / ')).join('; ')
                : t('tracePage.noPurchases')}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function LotReport() {
  const t = useT()
  const { locale } = useLocale()
  const router = useRouter()
  const { user } = useAuth()
  const lotId = typeof router.query.lotId === 'string' ? router.query.lotId : null
  const r = useQuery(api.traceability.lotReport, user && lotId ? { lotId } : 'skip')
  const [dispatching, setDispatching] = useState(false)

  if (r === undefined || !lotId) {
    return (
      <Layout title={t('tracePage.reportTitle')} eyebrow={t('tracePage.eyebrowLots')}>
        <p className="text-[14px] leading-[18px] text-muted">{t('tracePage.loadingReport')}</p>
      </Layout>
    )
  }
  if (r === null) {
    return (
      <Layout title={t('tracePage.notFound')} eyebrow={t('tracePage.eyebrowLots')}>
        <EmptyState
          title={t('tracePage.notFound')}
          description={t('tracePage.notFoundHint')}
          action={<GhostButton href="/trace">{t('tracePage.back')}</GhostButton>}
        />
      </Layout>
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

  const kg = (v) => `${formatNumber(v, { locale, decimals: 1 })} kg`
  const w = withdrawalSummary(r)
  const temp = maxDispatchTemp(r.dispatches)
  const steps = lotTimeline(r).map((s, i) => ({ key: `${s.kind}-${i}`, tone: s.tone, ...describeStep(t, locale, s, r) }))
  const checks = [
    {
      key: 'withdrawal',
      label: t('tracePage.check.withdrawal'),
      tone: w.state === 'clear' ? 'good' : w.state === 'override' ? 'warn' : 'alert',
      value:
        w.state === 'clear'
          ? w.until ? t('tracePage.clearedOn', { date: formatDate(w.until, { locale }) }) : t('tracePage.clear')
          : w.state === 'override'
            ? t('tracePage.overridden', { reason: r.harvest.withdrawal_override.reason })
            : t('tracePage.running'),
    },
    {
      key: 'cold',
      label: t('tracePage.check.coldChain'),
      tone: temp == null ? 'muted' : 'good',
      value: temp == null ? t('tracePage.notRecorded') : `≤ ${formatNumber(temp, { locale, decimals: 1 })} °C`,
    },
    {
      key: 'stock',
      label: t('tracePage.check.remaining'),
      tone: r.lot.remaining_kg > 0 ? 'cyan' : 'good',
      value: r.lot.remaining_kg > 0 ? kg(r.lot.remaining_kg) : t('tracePage.allDispatched'),
    },
  ]

  return (
    <Layout
      title={t('tracePage.lotTitle', { code: r.lot.lot_code })}
      eyebrow={[t('tracePage.eyebrowLot'), r.company, r.site].filter(Boolean).join(' · ')}
      actions={
        <div className="flex flex-wrap gap-3 print:hidden">
          {r.lot.remaining_kg > 0 && (
            <IfPermitted permission="production.harvest.record">
              <GradientButton icon={Plus} onClick={() => setDispatching(true)}>
                {t('tracePage.addDispatch')}
              </GradientButton>
            </IfPermitted>
          )}
          <GradientButton reverse icon={Download} onClick={downloadCsv}>
            {t('tracePage.exportRecall')}
          </GradientButton>
          <GhostButton icon={Printer} onClick={() => window.print()}>
            {t('tracePage.print')}
          </GhostButton>
        </div>
      }
    >
      <KpiStrip
        items={[
          { key: 'weight', label: t('tracePage.kpi.weight'), value: kg(r.lot.weight_kg), suffix: r.lot.grade ? t('tracePage.grade', { grade: r.lot.grade }) : undefined },
          {
            key: 'fish',
            label: t('tracePage.kpi.fish'),
            value: r.lot.fish_count != null ? formatNumber(r.lot.fish_count, { locale }) : '—',
            suffix: r.harvest ? t('tracePage.avgG', { g: formatNumber(r.harvest.abw_g, { locale, decimals: 0 }) }) : undefined,
          },
          { key: 'dispatched', label: t('tracePage.kpi.dispatched'), value: kg(r.lot.dispatched_kg), suffix: t('tracePage.dispatchCount', { count: r.dispatches.length }) },
          {
            key: 'withdrawal',
            label: t('tracePage.kpi.withdrawal'),
            value: w.state === 'clear' ? t('tracePage.clear') : w.state === 'override' ? t('tracePage.overrideShort') : t('tracePage.runningShort'),
            valueTone: w.state === 'clear' ? undefined : w.state === 'override' ? 'warn' : 'alert',
            suffix: w.until ? t('tracePage.since', { date: formatDate(w.until, { locale }) }) : undefined,
          },
        ]}
      />

      <div className="flex w-full flex-col items-stretch gap-5 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-col gap-5 xl:grow-[1.6] xl:basis-0">
          <section className={`${CARD} p-[22px] sm:p-[28px]`}>
            <CardHead
              title={t('tracePage.farmToCustomer')}
              meta={
                r.batch ? (
                  <Link href={`/batches/${r.batch.id}`} className="rounded-sm hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                    {t('tracePage.batch', { batch: r.batch.batch_number })}
                  </Link>
                ) : null
              }
            />
            {!r.trace && <p className="pb-4 text-[13px] leading-[18px] text-muted">{t('tracePage.noBatch')}</p>}
            <TraceTimeline items={steps} label={t('tracePage.farmToCustomer')} />
          </section>
          {r.trace && <FeedLots feed={r.trace.feed} />}
        </div>

        <div className="flex min-w-0 grow basis-0 flex-col gap-5">
          <section className={`${CARD} px-[26px] py-6`}>
            <CardHead title={t('tracePage.dispatches')} meta={r.dispatches.length} />
            {r.dispatches.length === 0 ? (
              <p className="border-t border-line py-[11px] text-[13px] leading-[18px] text-muted">{t('tracePage.notDispatched')}</p>
            ) : (
              <ul className="flex flex-col">
                {r.dispatches.map((d) => (
                  <li key={d.id} className="flex justify-between gap-3 border-t border-line py-[11px]">
                    <div className="flex min-w-0 flex-col gap-[2px]">
                      <span className="text-[14px] leading-[18px] text-text">{[d.vehicle, d.driver].filter(Boolean).join(' · ') || d.customer_name || '—'}</span>
                      <span className="text-xs leading-4 text-muted">
                        {formatDate(d.dispatch_date, { locale })}
                        {d.customer_name ? ` → ${d.customer_name}` : ''}
                        {d.temperature_c != null ? ` · ${formatNumber(d.temperature_c, { locale, decimals: 1 })} °C` : ''}
                        {d.withdrawal_override ? ` · ${t('tracePage.overrideShort')}` : ''}
                      </span>
                    </div>
                    <span className="shrink-0 text-[14px] leading-[18px] text-text tabular-nums">{kg(d.weight_kg)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${CARD} px-[26px] py-6`}>
            <CardHead title={t('tracePage.complianceChecks')} />
            <dl className="flex flex-col">
              {checks.map((c) => (
                <div key={c.key} className="flex justify-between gap-3 border-t border-line py-[11px]">
                  <dt className="text-[14px] leading-[18px] text-muted">{c.label}</dt>
                  <dd className={`text-right text-[14px] leading-[18px] ${TONE_TEXT[c.tone]}`}>{c.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={`${CARD} px-[26px] py-6 print:hidden`}>
            <CardHead title={t('tracePage.documents')} />
            <p className="pb-3 text-[13px] leading-[18px] text-muted">{t('tracePage.documentsHint')}</p>
            <Attachments entityType="harvestLots" entityId={r.lot.id} />
          </section>
        </div>
      </div>

      {dispatching && <DispatchModal lot={r.lot} onClose={() => setDispatching(false)} />}
    </Layout>
  )
}

export default function TraceLotPage() {
  return (
    <ProtectedRoute>
      <LotReport />
    </ProtectedRoute>
  )
}
