import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { ArrowLeft, Plus, X } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import OutboxPanel from '../../components/OutboxPanel'
import { EmptyState, Field, GhostButton, GradientButton, IfPermitted, Input, Modal, Select, Tabs, Textarea } from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'
import { saveOrQueue } from '../../lib/outboxSenders'
import { cleanError } from '../../lib/offlineOutbox'
import { formatDate } from '../../lib/format'
import { useLocale, useT } from '../../lib/i18n/context'
import { useOnline } from '../../hooks/useOutbox'
import { HatcheryNav, LIVE_FEED_LABEL, LIVE_FEED_UNIT, PaperCard, Pill, fmt, label, num, today } from '../../components/hatchery/common'
import { usePermission } from '../../hooks/usePermission'

const SUB = 'text-xs leading-4 text-muted'
const HINT = 'text-[13px] leading-[18px] text-muted'

export default function LarvalPage() {
  return (
    <ProtectedRoute>
      <Larval />
    </ProtectedRoute>
  )
}

function Larval() {
  const t = useT()
  const router = useRouter()
  const { user } = useAuth()
  const [status, setStatus] = useState('active')
  const batches = useQuery(api.nursery.larvalBatches, user ? { status } : 'skip')
  const selectedId = typeof router.query.batch === 'string' ? router.query.batch : null
  const selected = (batches || []).find((b) => b.id === selectedId) || null
  const select = (id) => router.replace({ pathname: '/hatchery/larval', query: id ? { batch: id } : {} }, undefined, { shallow: true })

  return (
    <Layout title={t('hatcheryPage.larval.title')} eyebrow={t('hatcheryPage.larval.eyebrow')}>
      <div className="flex flex-col gap-[28px]">
        <HatcheryNav />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <PaperCard
            padded={false}
            className={selected ? 'hidden lg:block' : ''}
            title={t('hatcheryPage.larval.batches')}
            action={
              <Tabs
                label={t('hatcheryPage.larval.statusFilter')}
                value={status}
                onChange={setStatus}
                tabs={[
                  { value: 'active', label: t('hatcheryPage.larval.active') },
                  { value: 'closed', label: t('hatcheryPage.larval.closed') },
                ]}
              />
            }
          >
            {batches === undefined ? (
              <p className={`px-[26px] pb-6 ${HINT}`}>{t('ui.loading')}</p>
            ) : batches.length === 0 ? (
              <div className="px-[26px] pb-6">
                <EmptyState title={t('hatcheryPage.larval.empty')} description={t('hatcheryPage.larval.emptyHint')} />
              </div>
            ) : (
              <ul className="flex flex-col">
                {batches.map((b) => (
                  <li key={b.id} className="border-t border-line">
                    <button
                      type="button"
                      onClick={() => select(b.id)}
                      aria-current={b.id === selectedId ? 'true' : undefined}
                      className={`flex min-h-12 w-full flex-col gap-1 px-[22px] py-[11px] text-left hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan sm:px-[26px] ${
                        b.id === selectedId ? 'bg-surface-2' : ''
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[13px] font-medium text-text">{b.batch_number}</span>
                        <Pill tone={b.stage === 'larvae' ? 'accent' : 'good'}>{label(t, 'stage', b.stage)}</Pill>
                      </span>
                      <span className={SUB}>
                        {[
                          b.units.map((u) => u.name).join(', ') || null,
                          t('hatcheryPage.fishN', { n: fmt(b.count) }),
                          t('hatcheryPage.dayN', { n: b.days_since_hatch }),
                          b.survival_pct != null ? t('hatcheryPage.survival', { pct: `${fmt(b.survival_pct, 1)}%` }) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {status === 'active' && !b.logged_today && b.stage === 'larvae' && (
                        <span className="text-xs leading-4 text-warn">{t('hatcheryPage.larval.notLogged')}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PaperCard>

          <div className={selected ? '' : 'hidden lg:block'}>
            {selected ? (
              <BatchPanel batch={selected} onBack={() => select(null)} />
            ) : (
              <PaperCard>
                <p className={HINT}>{t('hatcheryPage.larval.choose')}</p>
              </PaperCard>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}

function BatchPanel({ batch, onBack }) {
  const t = useT()
  const { locale } = useLocale()
  const canGrade = usePermission('hatchery.grade')
  const canDispatch = usePermission('hatchery.dispatch')
  const [tab, setTab] = useState('log')
  const tabs = [{ value: 'log', label: t('hatcheryPage.larval.tabLog') }]
  if (canGrade && batch.count > 0) tabs.push({ value: 'grade', label: t('hatcheryPage.larval.tabGrade') })
  if (canDispatch && batch.count > 0) {
    tabs.push({ value: 'move', label: t('hatcheryPage.larval.tabMove') }, { value: 'sell', label: t('hatcheryPage.larval.tabSell') })
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <GhostButton size="sm" icon={ArrowLeft} onClick={onBack} className="self-start lg:hidden">
          {t('hatcheryPage.larval.allBatches')}
        </GhostButton>
        <h2 className="text-[22px] font-semibold leading-7 text-text">
          <Link href={`/batches/${batch.id}`} className="font-mono hover:text-pearl-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
            {batch.batch_number}
          </Link>
        </h2>
        <p className={HINT}>
          {[
            t('hatcheryPage.larval.hatchedOn', { date: formatDate(batch.hatched_on, { locale }) }) +
              (batch.hatched_batch_number !== batch.batch_number ? ` ${t('hatcheryPage.larval.asBatch', { batch: batch.hatched_batch_number })}` : ''),
            t('hatcheryPage.larval.inN', { n: fmt(batch.stocked) }),
            t('hatcheryPage.larval.deadN', { n: fmt(batch.deaths) }),
            t('hatcheryPage.larval.outN', { n: fmt(batch.moved_out) }),
            batch.abw_g ? `${fmt(batch.abw_g, 3)} g` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      {tabs.length > 1 && (
        <div className="border-b border-line">
          <Tabs variant="page" label={t('hatcheryPage.larval.actions')} tabs={tabs} value={tab} onChange={setTab} />
        </div>
      )}
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

function SubHead({ children }) {
  return <h3 className="text-[13px] font-semibold leading-4 text-text">{children}</h3>
}

function DailyLog({ batch }) {
  const t = useT()
  const { locale } = useLocale()
  const { user } = useAuth()
  const { showToast } = useToast()
  const online = useOnline()
  const canLog = usePermission('hatchery.larval.record')
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
        res.queued ? t('hatcheryPage.larval.queued') : t('hatcheryPage.larval.logSaved', { n: fmt(res.data?.alive) }),
      )
    } catch (err) {
      showToast('error', cleanError(err) || errorMessage(err, t('hatcheryPage.larval.logFailed')))
    } finally {
      setSaving(false)
    }
  }

  const numberField = (k, text, opts = {}) => (
    <Field label={text} htmlFor={`log-${k}`} hint={opts.hint}>
      <Input
        id={`log-${k}`}
        type="number"
        inputMode={opts.decimal ? 'decimal' : 'numeric'}
        step={opts.decimal ? 'any' : '1'}
        value={form[k]}
        onChange={set(k)}
        disabled={!canLog}
        className="tabular-nums"
      />
    </Field>
  )
  const setFeedRow = (i, k) => (e) => setFeed((p) => p.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))

  return (
    <>
      <PaperCard title={t('hatcheryPage.larval.tabLog')}>
        <OutboxPanel compact online={online} kinds={['larval-log']} />
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('hatcheryPage.date')} htmlFor="log-date">
              <Input id="log-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={t('hatcheryPage.brood.tank')} htmlFor="log-unit">
              <Select id="log-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {batch.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {fmt(u.count)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {existing && <p className={HINT}>{t('hatcheryPage.larval.alreadyLogged')}</p>}
          <div className="flex flex-col gap-3">
            <SubHead>{t('hatcheryPage.larval.survivalHead')}</SubHead>
            <div className="grid grid-cols-2 gap-4">
              {numberField('mortality', t('hatcheryPage.larval.deadRemoved'))}
              {numberField('countedAlive', t('hatcheryPage.larval.countedAlive'), { hint: t('hatcheryPage.larval.countedHint') })}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <SubHead>{t('hatcheryPage.larval.feeding')}</SubHead>
            {feed.map((f, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2">
                <Field label={i === 0 ? t('hatcheryPage.larval.liveFeed') : undefined} htmlFor={`lf-k-${i}`}>
                  <Select id={`lf-k-${i}`} value={f.kind} onChange={setFeedRow(i, 'kind')} disabled={!canLog}>
                    {Object.keys(LIVE_FEED_LABEL).map((k) => (
                      <option key={k} value={k}>{label(t, 'liveFeed', k)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={i === 0 ? t('hatcheryPage.larval.amount') : undefined} htmlFor={`lf-q-${i}`}>
                  <Input id={`lf-q-${i}`} type="number" inputMode="decimal" step="any" value={f.quantity} onChange={setFeedRow(i, 'quantity')} disabled={!canLog} />
                </Field>
                <Select aria-label={t('hatcheryPage.larval.unit')} value={f.unit} onChange={setFeedRow(i, 'unit')} className="w-28" disabled={!canLog}>
                  {Object.keys(LIVE_FEED_UNIT).map((k) => (
                    <option key={k} value={k}>{label(t, 'unit', k)}</option>
                  ))}
                </Select>
                {canLog && (
                  <GhostButton
                    size="sm"
                    icon={X}
                    aria-label={t('hatcheryPage.larval.removeFeed')}
                    onClick={() => setFeed((p) => p.filter((_, j) => j !== i))}
                  />
                )}
              </div>
            ))}
            {canLog && feed.length < 10 && (
              <div>
                <GhostButton size="sm" icon={Plus} onClick={() => setFeed((p) => [...p, { kind: 'artemia', quantity: '', unit: 'million' }])}>
                  {t('hatcheryPage.larval.addLiveFeed')}
                </GhostButton>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              {numberField('dryFeedG', t('hatcheryPage.larval.dryFeed'), { decimal: true })}
              {numberField('feedingsPerDay', t('hatcheryPage.larval.feedings'))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <SubHead>{t('hatcheryPage.larval.water')}</SubHead>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {numberField('temperatureC', '°C', { decimal: true })}
              {numberField('dissolvedOxygen', t('hatcheryPage.larval.do'), { decimal: true })}
              {numberField('ph', 'pH', { decimal: true })}
              {numberField('salinityPpt', t('hatcheryPage.larval.salinity'), { decimal: true })}
            </div>
          </div>
          <Field label={t('common.notes')} htmlFor="log-notes">
            <Textarea id="log-notes" rows={2} value={form.notes} onChange={set('notes')} disabled={!canLog} />
          </Field>
          {canLog && (
            <div className="flex justify-end">
              <GradientButton type="submit" variant="solid" disabled={saving || !unitId}>
                {saving ? t('common.saving') : existing ? t('hatcheryPage.larval.saveChanges') : t('hatcheryPage.larval.saveLog')}
              </GradientButton>
            </div>
          )}
        </form>
      </PaperCard>

      <PaperCard title={t('hatcheryPage.larval.logs')} meta={logs ? logs.length : undefined}>
        {logs === undefined ? (
          <p className={HINT}>{t('ui.loading')}</p>
        ) : logs.length === 0 ? (
          <p className={`border-t border-line py-[11px] ${HINT}`}>{t('hatcheryPage.larval.noLogs')}</p>
        ) : (
          <div className="-mx-[22px] overflow-x-auto sm:-mx-[26px]">
            <table className="w-full text-[13px] leading-4 tabular-nums">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="px-[22px] py-2 font-normal sm:px-[26px]">{t('hatcheryPage.date')}</th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">{t('hatcheryPage.larval.dead')}</th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">{t('hatcheryPage.larval.counted')}</th>
                  <th scope="col" className="px-2 py-2 font-normal">{t('hatcheryPage.larval.liveFeed')}</th>
                  <th scope="col" className="px-2 py-2 pr-[22px] text-right font-normal sm:pr-[26px]">°C</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-line text-text">
                    <td className="px-[22px] py-[11px] sm:px-[26px]">
                      <button
                        type="button"
                        className="text-pearl-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                        onClick={() => {
                          setDate(l.log_date)
                          setUnitId(l.unit_id)
                        }}
                      >
                        {formatDate(l.log_date, { locale })}
                      </button>
                    </td>
                    <td className="px-2 py-[11px] text-right">{fmt(l.mortality)}</td>
                    <td className="px-2 py-[11px] text-right">{fmt(l.counted_alive)}</td>
                    <td className="px-2 py-[11px] text-muted">
                      {l.live_feed.map((f) => `${label(t, 'liveFeed', f.kind)} ${fmt(f.quantity, 2)} ${label(t, 'unit', f.unit)}`).join(', ') || '—'}
                    </td>
                    <td className="px-2 py-[11px] pr-[22px] text-right sm:pr-[26px]">{fmt(l.temperature_c, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PaperCard>
    </>
  )
}

function useUnits() {
  const { user } = useAuth()
  return useQuery(api.nursery.nurseryUnits, user ? {} : 'skip') || []
}

function GradeForm({ batch }) {
  const t = useT()
  const { showToast } = useToast()
  const units = useUnits()
  const grade = useMutation(api.nursery.gradeFingerlings)
  const [unitId, setUnitId] = useState(batch.units[0]?.id || '')
  const [date, setDate] = useState(today())
  const [culls, setCulls] = useState('')
  const [rows, setRows] = useState([{ unitId: '', quantity: '', abwG: '', batchNumber: '' }])
  const [saving, setSaving] = useState(false)
  const here = batch.units.find((u) => u.id === unitId)
  const total = rows.reduce((sum, r) => sum + (num(r.quantity) || 0), 0) + (num(culls) || 0)
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
        t('hatcheryPage.larval.graded', { count: r.childBatchIds.length }) +
          (r.unaccounted ? ` ${t('hatcheryPage.larval.unaccounted', { n: fmt(r.unaccounted) })}` : ''),
      )
      setRows([{ unitId: '', quantity: '', abwG: '', batchNumber: '' }])
    } catch (err) {
      showToast('error', errorMessage(err, t('hatcheryPage.larval.gradeFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PaperCard title={t('hatcheryPage.larval.tabGrade')}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <p className={HINT}>{t('hatcheryPage.larval.gradeHint')}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('hatcheryPage.larval.tankGraded')} htmlFor="g-unit">
            <Select id="g-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {batch.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {fmt(u.count)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('hatcheryPage.date')} htmlFor="g-date">
            <Input id="g-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-3 border-t border-line pt-4 sm:grid-cols-4">
            <Field label={t('hatcheryPage.larval.gradeTo', { grade: String.fromCharCode(65 + i) })} htmlFor={`g-u-${i}`}>
              <Select id={`g-u-${i}`} value={r.unitId} onChange={setRow(i, 'unitId')}>
                <option value="">{t('hatcheryPage.choose')}</option>
                {units
                  .filter((u) => u.id === unitId || u.count <= 0)
                  .map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
              </Select>
            </Field>
            <Field label={t('hatcheryPage.brood.fish')} htmlFor={`g-q-${i}`}>
              <Input id={`g-q-${i}`} type="number" inputMode="numeric" value={r.quantity} onChange={setRow(i, 'quantity')} />
            </Field>
            <Field label={t('hatcheryPage.abw')} htmlFor={`g-a-${i}`}>
              <Input id={`g-a-${i}`} type="number" inputMode="decimal" step="any" value={r.abwG} onChange={setRow(i, 'abwG')} />
            </Field>
            <Field label={t('hatcheryPage.larval.batchNumber')} htmlFor={`g-b-${i}`}>
              <Input id={`g-b-${i}`} value={r.batchNumber} onChange={setRow(i, 'batchNumber')} placeholder={t('hatcheryPage.larval.automatic')} />
            </Field>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-4">
          {rows.length < 20 && (
            <GhostButton size="sm" icon={Plus} onClick={() => setRows((p) => [...p, { unitId: '', quantity: '', abwG: '', batchNumber: '' }])}>
              {t('hatcheryPage.larval.addGrade')}
            </GhostButton>
          )}
          <Field label={t('hatcheryPage.larval.culls')} htmlFor="g-culls" className="w-32">
            <Input id="g-culls" type="number" inputMode="numeric" value={culls} onChange={(e) => setCulls(e.target.value)} />
          </Field>
          <p className={`pb-3 tabular-nums ${HINT}`}>
            {t('hatcheryPage.larval.accounted', { done: fmt(total), total: fmt(here?.count) })}
          </p>
        </div>
        <div className="flex justify-end">
          <GradientButton type="submit" variant="solid" disabled={saving || !rows.some((r) => r.unitId)}>
            {saving ? t('hatcheryPage.larval.grading') : t('hatcheryPage.larval.tabGrade')}
          </GradientButton>
        </div>
      </form>
    </PaperCard>
  )
}

function MoveForm({ batch }) {
  const t = useT()
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
      showToast('success', t('hatcheryPage.larval.moved'))
    } catch (err) {
      showToast('error', errorMessage(err, t('hatcheryPage.larval.moveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PaperCard title={t('hatcheryPage.larval.tabMove')}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <p className={HINT}>{t('hatcheryPage.larval.moveHint')}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('hatcheryPage.larval.from')} htmlFor="m-src">
            <Select id="m-src" value={sourceUnitId} onChange={(e) => setSource(e.target.value)}>
              {batch.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {fmt(u.count)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('hatcheryPage.date')} htmlFor="m-date">
            <Input id="m-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-3 items-end gap-3 border-t border-line pt-4">
            <Field label={t('hatcheryPage.larval.to')} htmlFor={`m-u-${i}`}>
              <Select id={`m-u-${i}`} value={l.destinationUnitId} onChange={setLine(i, 'destinationUnitId')}>
                <option value="">{t('hatcheryPage.choose')}</option>
                {units
                  .filter((u) => u.id !== sourceUnitId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.count > 0 ? ` · ${fmt(u.count)} (${u.batch_number})` : ` · ${t('hatcheryPage.larval.emptyUnit')}`}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('hatcheryPage.brood.fish')} htmlFor={`m-q-${i}`}>
              <Input id={`m-q-${i}`} type="number" inputMode="numeric" value={l.quantity} onChange={setLine(i, 'quantity')} />
            </Field>
            <Field label={t('hatcheryPage.abw')} htmlFor={`m-a-${i}`}>
              <Input id={`m-a-${i}`} type="number" inputMode="decimal" step="any" value={l.abwG} onChange={setLine(i, 'abwG')} />
            </Field>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {lines.length < 20 ? (
            <GhostButton size="sm" icon={Plus} onClick={() => setLines((p) => [...p, { destinationUnitId: '', quantity: '', abwG: p[0]?.abwG || '' }])}>
              {t('hatcheryPage.larval.addDestination')}
            </GhostButton>
          ) : (
            <span />
          )}
          <GradientButton type="submit" variant="solid" disabled={saving || !lines.some((l) => l.destinationUnitId)}>
            {saving ? t('hatcheryPage.larval.moving') : t('hatcheryPage.larval.moveFish')}
          </GradientButton>
        </div>
      </form>
    </PaperCard>
  )
}

function ReverseModal({ onClose, onConfirm }) {
  const t = useT()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!reason.trim()) return
    setSaving(true)
    const ok = await onConfirm(reason.trim())
    setSaving(false)
    if (ok) onClose()
  }
  return (
    <Modal
      as="form"
      onSubmit={submit}
      noValidate
      size="sm"
      onClose={onClose}
      showClose
      title={t('hatcheryPage.larval.reverseTitle')}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>{t('common.cancel')}</GhostButton>
          <GradientButton type="submit" variant="solid" size="sm" disabled={saving || !reason.trim()}>
            {saving ? t('common.saving') : t('hatcheryPage.larval.reverse')}
          </GradientButton>
        </>
      }
    >
      <Field label={t('hatcheryPage.larval.reverseReason')} htmlFor="rv-reason" required>
        <Textarea id="rv-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  )
}

function SellForm({ batch }) {
  const t = useT()
  const { locale } = useLocale()
  const { user } = useAuth()
  const { showToast } = useToast()
  const customers = useQuery(api.sales.listCustomers, user ? {} : 'skip')
  const movements = useQuery(api.nursery.listMovements, { batchId: batch.id })
  const dispatch = useMutation(api.nursery.dispatchFingerlings)
  const reverse = useMutation(api.nursery.reverseMovement)
  const [reversing, setReversing] = useState(null)
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
      showToast('success', form.kind === 'sale' ? t('hatcheryPage.larval.saleSaved') : t('hatcheryPage.larval.dispatchSaved'))
      setForm((p) => ({ ...p, quantity: '', withdrawalOverrideReason: '' }))
    } catch (err) {
      showToast('error', errorMessage(err, t('hatcheryPage.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  const undo = async (reason) => {
    try {
      await reverse({ id: reversing, reason })
      showToast('success', t('hatcheryPage.larval.reversed'))
      return true
    } catch (err) {
      showToast('error', errorMessage(err, t('hatcheryPage.larval.reverseFailed')))
      return false
    }
  }

  return (
    <>
      <PaperCard title={t('hatcheryPage.larval.tabSell')}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('hatcheryPage.larval.fingerlingsAre')} htmlFor="d-kind">
              <Select id="d-kind" value={form.kind} onChange={set('kind')}>
                <option value="sale">{t('hatcheryPage.larval.sold')}</option>
                <option value="external">{t('hatcheryPage.larval.sentFarm')}</option>
              </Select>
            </Field>
            <Field label={t('hatcheryPage.larval.from')} htmlFor="d-unit">
              <Select id="d-unit" value={form.unitId} onChange={set('unitId')}>
                {batch.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {fmt(u.count)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('hatcheryPage.date')} htmlFor="d-date">
              <Input id="d-date" type="date" value={form.date} onChange={set('date')} />
            </Field>
            <Field label={t('hatcheryPage.brood.fish')} htmlFor="d-q" required>
              <Input id="d-q" type="number" inputMode="numeric" value={form.quantity} onChange={set('quantity')} />
            </Field>
            <Field label={t('hatcheryPage.abw')} htmlFor="d-a" required>
              <Input id="d-a" type="number" inputMode="decimal" step="any" value={form.abwG} onChange={set('abwG')} />
            </Field>
            {form.kind === 'sale' ? (
              <>
                <Field
                  label={t('hatcheryPage.larval.pricePerFish')}
                  htmlFor="d-p"
                  required
                  hint={total ? t('hatcheryPage.larval.total', { amount: fmt(total, 2) }) : undefined}
                >
                  <Input id="d-p" type="number" inputMode="decimal" step="any" value={form.pricePerUnit} onChange={set('pricePerUnit')} />
                </Field>
                <Field label={t('hatcheryPage.larval.customer')} htmlFor="d-c">
                  <Select id="d-c" value={form.customerId} onChange={set('customerId')}>
                    <option value="">{t('hatcheryPage.larval.otherBuyer')}</option>
                    {(customers || []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
                {!form.customerId && (
                  <Field label={t('hatcheryPage.larval.buyerName')} htmlFor="d-cn" required>
                    <Input id="d-cn" value={form.customerName} onChange={set('customerName')} />
                  </Field>
                )}
                <Field label={t('hatcheryPage.larval.payment')} htmlFor="d-ps">
                  <Select id="d-ps" value={form.paymentStatus} onChange={set('paymentStatus')}>
                    <option value="pending">{t('hatcheryPage.larval.pay.pending')}</option>
                    <option value="partial">{t('hatcheryPage.larval.pay.partial')}</option>
                    <option value="paid">{t('hatcheryPage.larval.pay.paid')}</option>
                  </Select>
                </Field>
              </>
            ) : (
              <Field label={t('hatcheryPage.larval.receivingFarm')} htmlFor="d-f" required>
                <Input id="d-f" value={form.destinationFarm} onChange={set('destinationFarm')} />
              </Field>
            )}
            <Field
              label={t('hatcheryPage.larval.overrideReason')}
              htmlFor="d-w"
              hint={t('hatcheryPage.larval.overrideHint')}
              className="sm:col-span-2"
            >
              <Input id="d-w" value={form.withdrawalOverrideReason} onChange={set('withdrawalOverrideReason')} />
            </Field>
          </div>
          <div className="flex justify-end">
            <GradientButton type="submit" variant="solid" disabled={saving}>
              {saving ? t('common.saving') : form.kind === 'sale' ? t('hatcheryPage.larval.recordSale') : t('hatcheryPage.larval.recordDispatch')}
            </GradientButton>
          </div>
        </form>
      </PaperCard>
      <PaperCard title={t('hatcheryPage.larval.fishOut')} meta={movements ? movements.length : undefined}>
        {!movements || movements.length === 0 ? (
          <p className={`border-t border-line py-[11px] ${HINT}`}>{t('hatcheryPage.larval.noneYet')}</p>
        ) : (
          <ul className="flex flex-col">
            {movements.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-[11px]">
                <div className="flex min-w-0 flex-col gap-[2px]">
                  <span className="text-[14px] leading-[18px] text-text">
                    {t(`hatcheryPage.larval.mv.${m.kind === 'transfer' ? 'moved' : m.kind === 'sale' ? 'sold' : 'sent'}`, {
                      date: formatDate(m.date, { locale }),
                      n: fmt(m.quantity),
                      dest: m.destination || '—',
                    })}
                  </span>
                  <span className={SUB}>
                    {t('hatcheryPage.larval.fromUnit', { unit: m.source_unit })}
                    {m.amount != null ? ` · ${t('hatcheryPage.larval.amountEach', { amount: fmt(m.amount, 2), each: fmt(m.price_per_unit, 2) })}` : ''}
                  </span>
                </div>
                {m.status === 'reversed' ? (
                  <Pill tone="warn">{t('hatcheryPage.larval.reversedPill')}</Pill>
                ) : (
                  <IfPermitted permission="hatchery.correct">
                    <GhostButton size="sm" tone="danger" onClick={() => setReversing(m.id)}>
                      {t('hatcheryPage.larval.reverse')}
                    </GhostButton>
                  </IfPermitted>
                )}
              </li>
            ))}
          </ul>
        )}
      </PaperCard>
      {reversing && <ReverseModal onClose={() => setReversing(null)} onConfirm={undo} />}
    </>
  )
}
