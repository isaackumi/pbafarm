import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from 'convex/react'
import { ArrowLeftRight, Plus } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Field, GhostButton, GradientButton, IfPermitted, Input, KpiStrip, Modal, Select } from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'
import { daysBetween, formatDate } from '../../lib/format'
import { useLocale, useT } from '../../lib/i18n/context'
import { HatcheryNav, PaperCard, Pill, fmt, label, num, statusTone, today } from '../../components/hatchery/common'

export default function HatcheryPage() {
  return (
    <ProtectedRoute>
      <HatcheryOverview />
    </ProtectedRoute>
  )
}

const ITEM = 'flex flex-col gap-[6px] rounded-[14px] border border-line bg-surface-2 px-4 py-[14px]'
const pct = (v) => (v == null ? '—' : `${fmt(v, 1)}%`)

function Column({ title, items, empty, children }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-[18px] shadow-[var(--shadow-card)]" aria-label={title}>
      <div className="flex justify-between">
        <h2 className="text-[14px] font-semibold leading-[18px] text-text">{title}</h2>
        <span className="text-[13px] leading-4 text-muted tabular-nums">{items === undefined ? '…' : items.length}</span>
      </div>
      {items === undefined ? null : items.length === 0 ? <p className="text-xs leading-4 text-faint">{empty}</p> : <ul className="flex flex-col gap-3">{children}</ul>}
    </section>
  )
}

function Item({ title, sub, meta, children }) {
  return (
    <li className={ITEM}>
      <span className="text-[14px] font-medium leading-[18px] text-text">{title}</span>
      {sub && <span className="text-xs leading-4 text-muted">{sub}</span>}
      {meta && <span className="text-xs leading-4 text-pearl-cyan">{meta}</span>}
      {children}
    </li>
  )
}

function HatcheryOverview() {
  const t = useT()
  const { locale } = useLocale()
  const { user } = useAuth()
  const kpis = useQuery(api.hatchery.kpis, user ? {} : 'skip')
  const board = useQuery(api.hatchery.incubationBoard, user ? {} : 'skip')
  const spawnings = useQuery(api.hatchery.listSpawnings, user ? { limit: 20 } : 'skip')
  const larval = useQuery(api.nursery.larvalBatches, user ? { status: 'active' } : 'skip')
  const k = kpis || {}
  const d = (iso) => (iso === today() ? t('hatcheryPage.today') : formatDate(iso, { locale }))
  const waiting = spawnings?.filter((s) => s.status === 'spawned')
  const incubating = board?.filter((l) => l.status === 'incubating')
  const recent = (board || []).filter((l) => l.status !== 'incubating').slice(0, 8)
  const larvae = larval?.filter((b) => b.stage === 'larvae')
  const nursery = larval?.filter((b) => b.stage !== 'larvae')
  const sum = (rows) => (rows || []).reduce((s, b) => s + b.count, 0)
  const units = (b) => b.units.map((u) => u.name).join(', ')

  return (
    <Layout
      title={t('hatcheryPage.title')}
      eyebrow={t('hatcheryPage.eyebrow')}
      actions={
        <>
          <IfPermitted permission="hatchery.spawning.record">
            <GradientButton icon={Plus} href="/hatchery/spawning">
              {t('hatcheryPage.newSpawning')}
            </GradientButton>
          </IfPermitted>
          <IfPermitted permission="hatchery.dispatch">
            <GradientButton reverse icon={ArrowLeftRight} href="/hatchery/larval">
              {t('hatcheryPage.moveToNursery')}
            </GradientButton>
          </IfPermitted>
        </>
      }
    >
      <div className="flex flex-col gap-[28px]">
        <HatcheryNav />

        <KpiStrip
          items={[
            {
              key: 'brood',
              label: t('hatcheryPage.kpi.broodstock'),
              value: fmt(k.broodstock_total),
              suffix: k.broodstock_by_status ? t('hatcheryPage.readyN', { n: fmt(k.broodstock_by_status.ready || 0) }) : undefined,
            },
            { key: 'eggs', label: t('hatcheryPage.kpi.eggs'), value: fmt(k.eggs_incubating), suffix: t('hatcheryPage.lotsN', { count: k.lots_incubating || 0 }) },
            {
              key: 'larvae',
              label: t('hatcheryPage.kpi.larvae'),
              value: fmt(sum(larvae)),
              suffix: k.larval_survival_pct != null ? t('hatcheryPage.survival', { pct: pct(k.larval_survival_pct) }) : undefined,
            },
            { key: 'fingerlings', label: t('hatcheryPage.kpi.fingerlings'), value: fmt(sum(nursery)), suffix: t('hatcheryPage.batchesN', { count: nursery?.length || 0 }) },
          ]}
        />

        <div className="grid w-full items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Column title={t('hatcheryPage.col.spawning')} items={waiting} empty={t('hatcheryPage.emptySpawning')}>
            {waiting?.map((s) => (
              <Item
                key={s.id}
                title={[s.female_codes.join(', '), s.male_codes.length ? s.male_codes.join(', ') : null].filter(Boolean).join(' × ')}
                sub={[s.unit_name, s.eggs_collected != null ? t('hatcheryPage.eggsN', { n: fmt(s.eggs_collected) }) : t('hatcheryPage.eggsNotCounted')].filter(Boolean).join(' · ')}
                meta={d(s.spawn_date)}
              />
            ))}
          </Column>
          <Column title={t('hatcheryPage.col.incubation')} items={incubating} empty={t('hatcheryPage.emptyIncubation')}>
            {incubating?.map((l) => (
              <IncubationItem key={l.id} lot={l} />
            ))}
          </Column>
          <Column title={t('hatcheryPage.col.larvae')} items={larvae} empty={t('hatcheryPage.emptyLarvae')}>
            {larvae?.map((b) => (
              <Item
                key={b.id}
                title={<Link href={`/batches/${b.id}`} className="hover:text-pearl-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">{b.batch_number}</Link>}
                sub={[units(b), fmt(b.count)].filter(Boolean).join(' · ')}
                meta={[t('hatcheryPage.dayN', { n: b.days_since_hatch }), b.survival_pct != null ? pct(b.survival_pct) : null].filter(Boolean).join(' · ')}
              />
            ))}
          </Column>
          <Column title={t('hatcheryPage.col.nursery')} items={nursery} empty={t('hatcheryPage.emptyNursery')}>
            {nursery?.map((b) => (
              <Item
                key={b.id}
                title={<Link href={`/batches/${b.id}`} className="hover:text-pearl-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">{b.batch_number}</Link>}
                sub={[units(b), fmt(b.count)].filter(Boolean).join(' · ')}
                meta={b.abw_g != null ? `${fmt(b.abw_g, 2)} g` : t('hatcheryPage.dayN', { n: b.days_since_hatch })}
              />
            ))}
          </Column>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <PaperCard title={t('hatcheryPage.performance')} meta={t('hatcheryPage.spawningsN', { count: k.spawnings || 0 })}>
            <dl className="flex flex-col">
              {[
                [t('hatcheryPage.kpi.eggsCollected'), fmt(k.eggs_collected)],
                [t('hatcheryPage.kpi.fertilization'), pct(k.fertilization_pct)],
                [t('hatcheryPage.kpi.hatchRate'), pct(k.hatch_rate_pct)],
                [t('hatcheryPage.kpi.larvaeHatched'), fmt(k.larvae_hatched)],
                [t('hatcheryPage.kpi.fryPerKg'), fmt(k.fry_per_kg_female)],
              ].map(([key, v]) => (
                <div key={key} className="flex justify-between gap-3 border-t border-line py-[11px]">
                  <dt className="text-[14px] leading-[18px] text-muted">{key}</dt>
                  <dd className="text-[14px] leading-[18px] text-text tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </PaperCard>
          <PaperCard title={t('hatcheryPage.latestHatches')}>
            {recent.length === 0 ? (
              <p className="border-t border-line py-[11px] text-[13px] leading-[18px] text-muted">{t('hatcheryPage.noHatches')}</p>
            ) : (
              <ul className="flex flex-col">
                {recent.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 border-t border-line py-[11px]">
                    <div className="flex min-w-0 flex-col gap-[2px]">
                      <span className="text-[14px] leading-[18px] text-text">
                        {l.batch_id ? (
                          <Link href={`/batches/${l.batch_id}`} className="hover:text-pearl-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                            {l.batch_number}
                          </Link>
                        ) : (
                          l.unit_name
                        )}
                      </span>
                      <span className="text-xs leading-4 text-muted">
                        {t('hatcheryPage.hatchLine', { date: formatDate(l.hatched_on, { locale }), larvae: fmt(l.larvae_count), eggs: fmt(l.eggs) })}
                      </span>
                    </div>
                    {l.status === 'failed' ? (
                      <Pill tone={statusTone(l.status)}>{label(t, 'status', l.status)}</Pill>
                    ) : (
                      <span className="text-[14px] leading-[18px] text-text tabular-nums">{pct(l.hatch_pct)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </PaperCard>
        </div>
      </div>
    </Layout>
  )
}

function IncubationItem({ lot }) {
  const t = useT()
  const { locale } = useLocale()
  const [mode, setMode] = useState(null)
  const days = daysBetween(lot.started_on, today())
  return (
    <Item
      title={lot.unit_name}
      sub={[t('hatcheryPage.eggsN', { n: fmt(lot.eggs) }), lot.spawn_date ? t('hatcheryPage.spawnedOn', { date: formatDate(lot.spawn_date, { locale }) }) : null, lot.fertilization_pct != null ? t('hatcheryPage.fertilized', { pct: pct(lot.fertilization_pct) }) : null]
        .filter(Boolean)
        .join(' · ')}
      meta={t('hatcheryPage.dayN', { n: days })}
    >
      <IfPermitted permission="hatchery.spawning.record">
        <div className="flex flex-wrap gap-2 pt-1">
          <GhostButton size="sm" onClick={() => setMode('hatch')}>{t('hatcheryPage.recordHatch')}</GhostButton>
          <GhostButton size="sm" tone="danger" onClick={() => setMode('fail')}>{t('hatcheryPage.failed')}</GhostButton>
        </div>
      </IfPermitted>
      {mode && <HatchModal lot={lot} mode={mode} onClose={() => setMode(null)} />}
    </Item>
  )
}

function HatchModal({ lot, mode, onClose }) {
  const t = useT()
  const { showToast } = useToast()
  const { user } = useAuth()
  const units = useQuery(api.nursery.nurseryUnits, user ? {} : 'skip')
  const recordHatch = useMutation(api.hatchery.recordHatch)
  const markFailed = useMutation(api.hatchery.markLotFailed)
  const [form, setForm] = useState({ date: today(), larvae: '', unitId: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const emptyUnits = (units || []).filter((u) => u.nursery && u.count <= 0 && u.id !== lot.unit_id)

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (mode === 'hatch') {
        const r = await recordHatch({ lotId: lot.id, hatchedOn: form.date, larvaeCount: num(form.larvae), larvalUnitId: form.unitId || undefined })
        showToast('success', t('hatcheryPage.hatchSaved', { batch: r.batchNumber, n: fmt(num(form.larvae)) }))
      } else {
        await markFailed({ lotId: lot.id, date: form.date, reason: form.reason })
        showToast('success', t('hatcheryPage.failSaved'))
      }
      onClose()
    } catch (err) {
      showToast('error', errorMessage(err, t('hatcheryPage.saveFailed')))
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
      size="sm"
      title={mode === 'hatch' ? t('hatcheryPage.hatchTitle', { unit: lot.unit_name || '—' }) : t('hatcheryPage.failTitle', { unit: lot.unit_name || '—' })}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>{t('common.cancel')}</GhostButton>
          <GradientButton type="submit" variant="solid" size="sm" disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </GradientButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('hatcheryPage.date')} htmlFor={`d-${lot.id}`}>
          <Input id={`d-${lot.id}`} type="date" value={form.date} onChange={set('date')} />
        </Field>
        {mode === 'hatch' ? (
          <>
            <Field label={t('hatcheryPage.larvaeHatched')} htmlFor={`n-${lot.id}`} required>
              <Input id={`n-${lot.id}`} type="number" inputMode="numeric" value={form.larvae} onChange={set('larvae')} className="tabular-nums" />
            </Field>
            <Field label={t('hatcheryPage.stockIn')} htmlFor={`u-${lot.id}`} hint={t('hatcheryPage.stockInHint')}>
              <Select id={`u-${lot.id}`} value={form.unitId} onChange={set('unitId')}>
                <option value="">{lot.unit_name}</option>
                {emptyUnits.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </Field>
          </>
        ) : (
          <Field label={t('hatcheryPage.reason')} htmlFor={`r-${lot.id}`} required>
            <Input id={`r-${lot.id}`} value={form.reason} onChange={set('reason')} placeholder={t('hatcheryPage.reasonPlaceholder')} />
          </Field>
        )}
      </div>
    </Modal>
  )
}
