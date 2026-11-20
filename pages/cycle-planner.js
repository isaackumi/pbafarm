import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useMutation, useQuery } from 'convex/react'
import { ChevronDown, Columns2, PenLine, Plus, Trash2 } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { EmptyState, ErrorState, GhostButton, GradientButton, Input, LoadingState } from '../components/ui'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useCurrency } from '../hooks/useCurrency'
import { errorMessage } from '../lib/errorMessage'
import { addDays, getActiveLocale, localToday } from '../lib/format'
import { useT } from '../lib/i18n/context'
import { PLAN_DEFAULTS, PLAN_LIMITS, compareNote, planCycle, planProblems } from '../convex/lib/cyclePlan'
import { DEFAULT_SPECIES } from '../convex/lib/species'

const PlanChart = dynamic(() => import('../components/charts/CyclePlanChart'), {
  ssr: false,
  loading: () => <div className="h-full" />,
})

/**
 * Cycle planner (Paper 50, plans/2026-11-20 §3): pick units, a stocking date,
 * fingerlings and prices; see the harvest date, feed, cash and margin before
 * labour, recomputed live from lib/cyclePlan with the farm's own last cycles
 * (or species defaults). Saved plans sit side by side in the compare table.
 */
export default function CyclePlannerPage() {
  const t = useT()
  return (
    <ProtectedRoute permission="production.plan.manage">
      <CyclePlanner title={t('cyclePlanner.title')} eyebrow={t('cyclePlanner.eyebrow')} />
    </ProtectedRoute>
  )
}

// Paper 50: A lime, B sky, C coral (#F2A07B); a fourth plan uses good.
const PLAN_DOTS = ['bg-lime', 'bg-sky-ink', 'bg-[#F2A07B]', 'bg-good']
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
/** "A · Stock 2 Mar" → "A"; other names stay whole. */
const shortName = (name) => name.split(' · ')[0]

/** Wait `ms` after the last change before recomputing (typing stays smooth). */
function useDebounced(value, ms = 200) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

const num = (s) => {
  const n = Number(String(s).replace(/[\s,]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

function speciesTarget(key) {
  return DEFAULT_SPECIES.find((s) => s.key === key)?.targetHarvestAbwG ?? 500
}

function defaultInputs(currency) {
  const ghs = currency === 'GHS'
  return {
    stockOn: addDays(localToday(), 30),
    fishPerUnit: '20000',
    stockAbwG: '5',
    harvestAbwG: '400',
    feedPricePerBag: ghs ? '375' : '',
    bagKg: String(PLAN_DEFAULTS.bagKg),
    salePricePerKg: ghs ? '38' : '',
    fingerlingPrice: ghs ? '0.6' : '',
  }
}

const toInputs = (form, units) => ({
  stockOn: form.stockOn,
  units,
  fishPerUnit: Math.round(num(form.fishPerUnit)),
  stockAbwG: num(form.stockAbwG),
  harvestAbwG: num(form.harvestAbwG),
  feedPricePerBag: num(form.feedPricePerBag || 0),
  bagKg: num(form.bagKg),
  salePricePerKg: num(form.salePricePerKg || 0),
  fingerlingPrice: num(form.fingerlingPrice || 0),
})

function CyclePlanner({ title, eyebrow }) {
  const t = useT()
  const { showToast } = useToast()
  const { canUseApp } = useAuth()
  const { locationArgs } = useLocation()
  const { currency, symbol } = useCurrency()
  const cages = useQuery(api.cages.list, canUseApp ? { ...locationArgs, filter: 'all' } : 'skip')
  const plans = useQuery(api.cyclePlans.list, canUseApp ? {} : 'skip')
  const savePlan = useMutation(api.cyclePlans.save)
  const removePlan = useMutation(api.cyclePlans.remove)

  const [planId, setPlanId] = useState(null)
  const [name, setName] = useState('')
  const [unitIds, setUnitIds] = useState([])
  const [form, setForm] = useState(() => defaultInputs(currency))
  const [overrides, setOverrides] = useState({})
  const [editAssumptions, setEditAssumptions] = useState(false)
  const [compareIds, setCompareIds] = useState([])
  const [busy, setBusy] = useState(false)
  const compareRef = useRef(null)
  const asOf = useMemo(() => localToday(), [])

  // Prices follow the organization's currency once it has loaded (a new plan only).
  useEffect(() => {
    if (!planId) setForm((f) => (f.feedPricePerBag || f.salePricePerKg ? f : defaultInputs(currency)))
  }, [currency, planId])

  // First visit: start from the first six units at the chosen site.
  useEffect(() => {
    if (!unitIds.length && cages?.length && !planId) setUnitIds(cages.slice(0, 6).map((c) => c._id))
  }, [cages, unitIds.length, planId])

  const assumptionArgs = useMemo(() => (unitIds.length ? { unitIds, asOf } : 'skip'), [unitIds, asOf])
  const learned = useQuery(api.cyclePlans.assumptions, canUseApp ? assumptionArgs : 'skip')

  const assumptions = useMemo(() => {
    if (!learned) return null
    const base = learned.assumptions
    const pick = (k) => (overrides[k] !== undefined && Number.isFinite(num(overrides[k])) ? num(overrides[k]) : base[k])
    return {
      ...base,
      survivalPct: pick('survivalPct'),
      fcr: pick('fcr'),
      tgc: pick('tgc'),
      sources: {
        survival: overrides.survivalPct !== undefined ? 'edited' : base.sources.survival,
        fcr: overrides.fcr !== undefined ? 'edited' : base.sources.fcr,
        growth: overrides.tgc !== undefined ? 'edited' : base.sources.growth,
      },
    }
  }, [learned, overrides])

  const debouncedForm = useDebounced(form)
  const inputs = useMemo(() => toInputs(debouncedForm, Math.max(1, unitIds.length)), [debouncedForm, unitIds.length])
  const problems = useMemo(() => (assumptions ? planProblems(inputs, assumptions) : []), [inputs, assumptions])
  const result = useMemo(
    () => (assumptions && problems.length === 0 ? planCycle(inputs, assumptions) : null),
    [inputs, assumptions, problems],
  )

  const nextName = () => {
    const used = new Set((plans ?? []).map((p) => shortName(p.name)))
    const letter = [...LETTERS].find((l) => !used.has(l)) ?? 'Z'
    return letter
  }

  const resetToNew = () => {
    setPlanId(null)
    setName('')
    setOverrides({})
    setEditAssumptions(false)
    setForm(defaultInputs(currency))
  }

  const loadPlan = (p) => {
    setPlanId(p._id)
    setName(p.name)
    setUnitIds(p.units.map((u) => u.id))
    const i = p.inputs
    setForm(Object.fromEntries(Object.entries(i).map(([k, val]) => [k, String(val)])))
    const a = p.assumptions
    const o = {}
    if (a.sources.survival === 'edited') o.survivalPct = String(a.survivalPct)
    if (a.sources.fcr === 'edited') o.fcr = String(a.fcr)
    if (a.sources.growth === 'edited') o.tgc = String(a.tgc)
    setOverrides(o)
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  const onSave = async () => {
    if (!assumptions || problems.length) return
    const label = name.trim() || `${nextName()} · ${t('cyclePlanner.stockShort', { date: shortDate(form.stockOn) })}`
    setBusy(true)
    try {
      const { units: _u, ...rest } = toInputs(form, unitIds.length)
      const id = await savePlan({
        ...(planId ? { planId } : {}),
        name: label,
        unitIds,
        inputs: rest,
        assumptions: {
          speciesKey: assumptions.speciesKey,
          survivalPct: assumptions.survivalPct,
          fcr: assumptions.fcr,
          tgc: assumptions.tgc,
          tempC: assumptions.tempC,
          monthlyTempC: assumptions.monthlyTempC,
          sources: assumptions.sources,
          cycles: assumptions.cycles,
        },
      })
      setPlanId(id)
      setName(label)
      setCompareIds((ids) => (ids.includes(id) ? ids : [...ids, id].slice(-PLAN_LIMITS.maxPlansCompared)))
      showToast('success', t('cyclePlanner.saved'))
    } catch (err) {
      showToast('error', errorMessage(err, t('cyclePlanner.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (p) => {
    if (!window.confirm(t('cyclePlanner.confirmDelete', { name: p.name }))) return
    try {
      await removePlan({ planId: p._id })
      setCompareIds((ids) => ids.filter((x) => x !== p._id))
      if (planId === p._id) resetToNew()
      showToast('success', t('cyclePlanner.deleted'))
    } catch (err) {
      showToast('error', errorMessage(err, t('cyclePlanner.saveFailed')))
    }
  }

  const money = useMoney(symbol)
  const locale = getActiveLocale()
  const shortDate = (iso) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })

  return (
    <Layout
      title={title}
      eyebrow={eyebrow}
      actions={
        <>
          <GradientButton variant="lime" icon={PenLine} onClick={onSave} disabled={busy || !result || !unitIds.length}>
            {planId ? t('cyclePlanner.updatePlan') : t('cyclePlanner.savePlan')}
          </GradientButton>
          <GradientButton ring="sky" icon={Columns2} onClick={() => compareRef.current?.scrollIntoView({ behavior: 'smooth' })}>
            {t('cyclePlanner.comparePlans')}
          </GradientButton>
        </>
      }
    >
      {cages === undefined ? (
        <LoadingState />
      ) : cages.length === 0 ? (
        <EmptyState title={t('cyclePlanner.noUnits')} description={t('cyclePlanner.noUnitsBody')} />
      ) : (
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <InputsCard
            name={name}
            setName={setName}
            planId={planId}
            cages={cages}
            unitIds={unitIds}
            setUnitIds={setUnitIds}
            form={form}
            setForm={setForm}
            learned={learned}
            assumptions={assumptions}
            overrides={overrides}
            setOverrides={setOverrides}
            editAssumptions={editAssumptions}
            setEditAssumptions={setEditAssumptions}
            problems={problems}
            symbol={symbol}
          />
          <div className="flex min-w-0 grow flex-col gap-5">
            {!unitIds.length ? (
              <EmptyState title={t('cyclePlanner.pickUnits')} />
            ) : learned === undefined ? (
              <LoadingState />
            ) : learned === null ? (
              <ErrorState message={t('cyclePlanner.unitsUnavailable')} />
            ) : result ? (
              <Results result={result} inputs={inputs} money={money} shortDate={shortDate} locale={locale} />
            ) : (
              <p className="rounded-card border border-line bg-surface p-5 text-sm text-muted">{t('cyclePlanner.fixInputs')}</p>
            )}
            <div ref={compareRef}>
              <CompareTable
                plans={plans}
                compareIds={compareIds}
                setCompareIds={setCompareIds}
                currentId={planId}
                money={money}
                shortDate={shortDate}
                onOpen={loadPlan}
                onDelete={onDelete}
                onNew={resetToNew}
              />
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

/** "GH₵ 939k", "GH₵ 1.57m": compact money in the organization's currency. */
function useMoney(symbol) {
  return useMemo(() => {
    const locale = getActiveLocale()
    const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2, minimumFractionDigits: 0 })
    const k = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 0 })
    return (n) => {
      if (!Number.isFinite(n)) return '—'
      const abs = Math.abs(n)
      const body = abs >= 1e6 ? compact.format(n) : abs >= 1e3 ? k.format(n) : new Intl.NumberFormat(locale).format(Math.round(n))
      return `${symbol} ${body}`
    }
  }, [symbol])
}

const fmt = (n, decimals = 0) =>
  new Intl.NumberFormat(getActiveLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n)
const tonnes = (kg) => `${fmt(kg / 1000, 1)} t`

const LABEL = 'text-xs leading-4 text-muted'
/** Paper 50 fields: 42px, 12px radius, sky border when focused. */
const BOX = 'h-[42px] rounded-[12px] px-3.5 text-[14px] leading-[18px] focus:border-sky-ink focus-visible:ring-0'
const FIELD = `font-data tabular-nums ${BOX}`

function InputsCard({
  name,
  setName,
  planId,
  cages,
  unitIds,
  setUnitIds,
  form,
  setForm,
  learned,
  assumptions,
  overrides,
  setOverrides,
  editAssumptions,
  setEditAssumptions,
  problems,
  symbol,
}) {
  const t = useT()
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const target = speciesTarget(learned?.speciesKey)
  const min = Math.round(target * 0.5)
  const max = Math.round(target * 1.1)
  const bad = (k) => problems.includes(k)
  const sourceLabel = assumptions
    ? Object.values(assumptions.sources).every((s) => s === 'history') && assumptions.cycles > 0
      ? t('cyclePlanner.fromCycles', { count: assumptions.cycles })
      : Object.values(assumptions.sources).every((s) => s === 'default')
        ? t('cyclePlanner.fromDefaults')
        : t('cyclePlanner.fromMixed')
    : ''

  return (
    <div className="flex w-full shrink-0 flex-col gap-1 rounded-card border border-line bg-surface p-5 xl:w-[340px]">
      <div className="flex items-center justify-between gap-3 pb-3">
        <input
          aria-label={t('cyclePlanner.planName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={PLAN_LIMITS.nameLength}
          placeholder={t('cyclePlanner.planNamePlaceholder')}
          className="min-w-0 grow bg-transparent text-base font-semibold leading-5 text-text placeholder:text-faint focus:outline-none"
        />
        <span className="shrink-0 text-xs leading-4 text-faint">{planId ? t('cyclePlanner.saved') : t('cyclePlanner.draft')}</span>
      </div>

      <div className="flex flex-col gap-1.5 py-2.5">
        <span className={LABEL}>{t('cyclePlanner.units')}</span>
        <UnitPicker cages={cages} unitIds={unitIds} setUnitIds={setUnitIds} siteName={learned?.siteName} />
      </div>

      <div className="flex gap-2.5 py-2.5">
        <label className="flex min-w-0 grow basis-0 flex-col gap-1.5">
          <span className={LABEL}>{t('cyclePlanner.stockOn')}</span>
          <Input type="date" className={BOX} value={form.stockOn} onChange={set('stockOn')} aria-invalid={bad('stockOn')} />
        </label>
        <div className="flex min-w-0 grow basis-0 flex-col gap-1.5">
          <label htmlFor="cp-fish" className={LABEL}>
            {t('cyclePlanner.fishPerUnit')}
          </label>
          {/* Paper 50: the fingerling weight sits inside this field, "at 5 g". */}
          <div className="flex h-[42px] items-center justify-between gap-2 rounded-[12px] border border-line-strong bg-bg px-3.5 focus-within:border-sky-ink">
            <input
              id="cp-fish"
              inputMode="numeric"
              value={form.fishPerUnit}
              onChange={set('fishPerUnit')}
              aria-invalid={bad('fishPerUnit')}
              className="w-0 min-w-0 grow bg-transparent font-data text-[14px] leading-[18px] tabular-nums text-text focus:outline-none"
            />
            <span className="flex shrink-0 items-center gap-1 text-xs leading-4 text-faint">
              {t('cyclePlanner.at')}
              <input
                inputMode="decimal"
                aria-label={t('cyclePlanner.stockAbw')}
                value={form.stockAbwG}
                onChange={set('stockAbwG')}
                aria-invalid={bad('stockAbwG')}
                style={{ width: `${Math.max(1, String(form.stockAbwG).length)}ch` }}
                className="bg-transparent text-right text-xs leading-4 text-faint focus:text-text focus:outline-none aria-[invalid=true]:text-alert"
              />
              g
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 py-2.5">
        <div className="flex justify-between">
          <label htmlFor="cp-harvest" className={LABEL}>
            {t('cyclePlanner.harvestAt')}
          </label>
          <span className="font-data text-sm leading-4 text-text">{fmt(num(form.harvestAbwG) || 0)} g</span>
        </div>
        <input
          id="cp-harvest"
          type="range"
          min={min}
          max={max}
          step={10}
          value={Math.min(max, Math.max(min, num(form.harvestAbwG) || min))}
          onChange={set('harvestAbwG')}
          className="plan-range h-4 w-full cursor-pointer"
          style={{ '--pct': `${((Math.min(max, Math.max(min, num(form.harvestAbwG) || min)) - min) / Math.max(1, max - min)) * 100}%` }}
        />
        <div className="flex justify-between text-[11px] leading-[14px] text-faint">
          <span>{min} g</span>
          <span>{max} g</span>
        </div>
      </div>

      <div className="flex gap-2.5 py-2.5">
        <label className="flex grow basis-0 flex-col gap-1.5">
          <span className={LABEL}>{t('cyclePlanner.feedPricePerBag', { kg: form.bagKg || PLAN_DEFAULTS.bagKg })}</span>
          <Input inputMode="decimal" className={FIELD} value={form.feedPricePerBag} onChange={set('feedPricePerBag')} placeholder={symbol} aria-invalid={bad('feedPricePerBag')} />
        </label>
        <label className="flex grow basis-0 flex-col gap-1.5">
          <span className={LABEL}>{t('cyclePlanner.salePricePerKg')}</span>
          <Input inputMode="decimal" className={FIELD} value={form.salePricePerKg} onChange={set('salePricePerKg')} placeholder={symbol} aria-invalid={bad('salePricePerKg')} />
        </label>
      </div>
      {assumptions ? (
        <div className="mt-3 flex flex-col gap-2.5 rounded-[14px] bg-surface-2 p-4">
          <span className="font-data text-[11px] uppercase leading-[14px] tracking-[0.06em] text-muted">{sourceLabel}</span>
          <AssumptionRow
            label={t('cyclePlanner.survival')}
            value={`${fmt(assumptions.survivalPct, 0)}%`}
            source={assumptions.sources.survival}
            edit={editAssumptions}
            raw={overrides.survivalPct ?? String(assumptions.survivalPct)}
            onChange={(v) => setOverrides((o) => ({ ...o, survivalPct: v }))}
            invalid={problems.includes('survivalPct')}
          />
          <AssumptionRow
            label={t('cyclePlanner.fcr')}
            value={fmt(assumptions.fcr, 2)}
            source={assumptions.sources.fcr}
            edit={editAssumptions}
            raw={overrides.fcr ?? String(assumptions.fcr)}
            onChange={(v) => setOverrides((o) => ({ ...o, fcr: v }))}
            invalid={problems.includes('fcr')}
          />
          <AssumptionRow
            label={t('cyclePlanner.growth')}
            value={
              learned?.tempRange
                ? t('cyclePlanner.growthWater', { min: fmt(learned.tempRange.min), max: fmt(learned.tempRange.max) })
                : t('cyclePlanner.growthTgc', { tgc: fmt(assumptions.tgc, 2), temp: fmt(assumptions.tempC) })
            }
            source={assumptions.sources.growth}
            edit={editAssumptions}
            raw={overrides.tgc ?? String(assumptions.tgc)}
            onChange={(v) => setOverrides((o) => ({ ...o, tgc: v }))}
            invalid={problems.includes('tgc')}
            hint={editAssumptions ? t('cyclePlanner.tgcHint') : null}
          />
          {/* Not on Paper 50's default view: edited with the other assumptions. */}
          {editAssumptions ? (
        <div className="flex gap-2.5 pt-1">
          <label className="flex grow basis-0 flex-col gap-1.5">
            <span className={LABEL}>{t('cyclePlanner.fingerlingPrice')}</span>
            <Input inputMode="decimal" className={FIELD} value={form.fingerlingPrice} onChange={set('fingerlingPrice')} placeholder={symbol} aria-invalid={bad('fingerlingPrice')} />
          </label>
          <label className="flex grow basis-0 flex-col gap-1.5">
            <span className={LABEL}>{t('cyclePlanner.bagKg')}</span>
            <Input inputMode="decimal" className={FIELD} value={form.bagKg} onChange={set('bagKg')} aria-invalid={bad('bagKg')} />
          </label>
        </div>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <button type="button" onClick={() => setEditAssumptions((e) => !e)} className="text-left text-xs leading-[17px] text-sky-ink hover:underline">
              {editAssumptions ? t('cyclePlanner.doneEditing') : t('cyclePlanner.changeAssumptions')}
            </button>
            {Object.keys(overrides).length ? (
              <button type="button" onClick={() => setOverrides({})} className="text-left text-xs leading-[17px] text-muted hover:underline">
                {t('cyclePlanner.resetAssumptions')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AssumptionRow({ label, value, source, edit, raw, onChange, invalid, hint }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm leading-4 text-muted">
          {label}
          {source !== 'history' ? <span className="ml-1.5 text-[11px] text-faint">{t(`cyclePlanner.source.${source}`)}</span> : null}
        </span>
        {edit ? (
          <input
            aria-label={label}
            inputMode="decimal"
            value={raw}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid}
            className="w-24 rounded-input border border-line-strong bg-bg px-2 py-1 text-right font-data text-sm text-text focus:border-sky-ink focus:outline-none aria-[invalid=true]:border-alert"
          />
        ) : (
          <span className="text-right font-data text-sm leading-4 text-text">{value}</span>
        )}
      </div>
      {hint ? <span className="text-[11px] leading-[14px] text-faint">{hint}</span> : null}
    </div>
  )
}

function UnitPicker({ cages, unitIds, setUnitIds, siteName }) {
  const t = useT()
  const ref = useRef(null)
  const chosen = new Set(unitIds)
  const toggle = (id) =>
    setUnitIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(0, PLAN_LIMITS.maxUnits)))
  const summary = unitIds.length
    ? [t('cyclePlanner.unitCount', { count: unitIds.length }), siteName].filter(Boolean).join(' · ')
    : t('cyclePlanner.pickUnits')
  return (
    <details ref={ref} className="group relative">
      <summary className="flex h-[42px] cursor-pointer list-none items-center justify-between gap-2 rounded-[12px] border border-line-strong bg-bg px-3.5 text-[14px] leading-[18px] text-text group-open:border-sky-ink [&::-webkit-details-marker]:hidden">
        <span className="truncate">{summary}</span>
        <ChevronDown size={12} strokeWidth={1.7} className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="absolute inset-x-0 top-[46px] z-30 max-h-72 overflow-y-auto rounded-[14px] border border-line-strong bg-surface p-2 shadow-[var(--shadow-card)]">
        <div className="flex justify-between px-2 pb-2 text-xs">
          <button type="button" className="text-sky-ink hover:underline" onClick={() => setUnitIds(cages.slice(0, PLAN_LIMITS.maxUnits).map((c) => c._id))}>
            {t('cyclePlanner.selectAll')}
          </button>
          <button type="button" className="text-muted hover:underline" onClick={() => setUnitIds([])}>
            {t('cyclePlanner.clear')}
          </button>
        </div>
        {cages.map((c) => (
          <label key={c._id} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-surface-2">
            <input type="checkbox" checked={chosen.has(c._id)} onChange={() => toggle(c._id)} className="accent-[var(--color-lime)]" />
            <span className="grow truncate">{c.name}</span>
            {c.location ? <span className="shrink-0 text-xs text-faint">{c.location}</span> : null}
          </label>
        ))}
      </div>
    </details>
  )
}

function Results({ result: r, inputs, money, shortDate, locale }) {
  const t = useT()
  const harvest = new Date(`${r.harvestDate}T12:00:00Z`)
  const dayMonth = harvest.toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' })
  const year = harvest.getUTCFullYear()
  const lowMonth = new Date(`${r.cashLowOn}T12:00:00Z`).toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' })
  const lowPart = Number(r.cashLowOn.slice(8, 10)) > 20 ? 'late' : Number(r.cashLowOn.slice(8, 10)) > 10 ? 'mid' : 'early'
  const monthLabel = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
  const chartData = r.months.map((m) => ({
    label: m.harvest ? `${monthLabel(m.month)} · ${t('cyclePlanner.harvest')}` : monthLabel(m.month),
    feedT: Math.round(m.feedKg / 100) / 10,
    abwG: Math.round(m.abwG),
    harvest: m.harvest,
  }))

  return (
    <>
      <div className="flex flex-col gap-4 px-1 pt-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm leading-4 text-muted">{t('cyclePlanner.ifYouStock', { date: shortDate(inputs.stockOn) })}</span>
          {r.reached ? (
            <span className="text-[36px] font-semibold leading-[44px] tracking-[-0.02em] text-text sm:text-[48px] sm:leading-[56px]">
              {dayMonth} <span className="text-muted">{year}</span>
            </span>
          ) : (
            <span className="text-2xl font-semibold leading-8 text-text">{t('cyclePlanner.notReached', { days: PLAN_LIMITS.maxDays })}</span>
          )}
        </div>
        <div className="flex flex-col gap-1 pb-1.5 sm:items-end">
          <span className="font-data text-[28px] leading-8 text-lime-ink">{tonnes(r.harvestKg)}</span>
          <span className="text-sm leading-4 text-muted">
            {t('cyclePlanner.fishAt', { fish: fmt(r.fish), g: fmt(inputs.harvestAbwG), day: fmt(r.days) })}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-card border border-line bg-surface lg:grid-cols-4">
        <MoneyCell index={0} label={t('cyclePlanner.feedToBuy')} value={tonnes(r.feedKg)} sub={t('cyclePlanner.bags', { bags: fmt(r.bags), cost: money(r.feedCost) })} />
        <MoneyCell
          index={1}
          label={t('cyclePlanner.cashNeeded')}
          value={money(r.cashNeeded)}
          tone="text-warn"
          sub={t(`cyclePlanner.lowPoint.${lowPart}`, { month: lowMonth })}
        />
        <MoneyCell index={2} label={t('cyclePlanner.sales')} value={money(r.sales)} sub={t('cyclePlanner.atPrice', { price: money(inputs.salePricePerKg) })} />
        <MoneyCell
          index={3}
          label={t('cyclePlanner.marginBeforeLabour')}
          value={money(r.margin)}
          tone={r.margin >= 0 ? 'text-good' : 'text-alert'}
          sub={r.marginPct == null ? '—' : t('cyclePlanner.ofSales', { pct: fmt(r.marginPct) })}
        />
      </div>

      <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold leading-5 text-text">{t('cyclePlanner.chartTitle')}</h2>
          <div className="flex items-center gap-4 text-xs leading-4 text-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-line-strong" aria-hidden />
              {t('cyclePlanner.feedT')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 bg-lime" aria-hidden />
              {t('cyclePlanner.avgWeight')}
            </span>
          </div>
        </div>
        <div className="h-[230px]">
          <PlanChart
            data={chartData}
            labels={{ feed: t('cyclePlanner.feedT'), weight: t('cyclePlanner.avgWeight') }}
            formatFeed={(v) => fmt(v, 1)}
            formatWeight={(v) => `${fmt(v)} g`}
          />
        </div>
      </div>
    </>
  )
}

function MoneyCell({ index, label, value, sub, tone = 'text-text' }) {
  const edges = [index < 2 ? 'border-b lg:border-b-0' : '', index % 2 === 0 ? 'border-r' : '', index === 1 ? 'lg:border-r' : ''].join(' ')
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 border-line px-5 py-[18px] ${edges}`}>
      <span className="text-xs leading-4 text-muted">{label}</span>
      <span className={`font-data text-[22px] leading-7 ${tone}`}>{value}</span>
      <span className="text-xs leading-4 text-faint">{sub}</span>
    </div>
  )
}

function CompareTable({ plans, compareIds, setCompareIds, currentId, money, shortDate, onOpen, onDelete, onNew }) {
  const t = useT()
  const rows = useMemo(() => {
    if (!plans) return []
    const picked = compareIds.length ? plans.filter((p) => compareIds.includes(p._id)) : plans.slice(0, PLAN_LIMITS.maxPlansCompared)
    return picked.slice(0, PLAN_LIMITS.maxPlansCompared).map((p) => {
      const inputs = { ...p.inputs, units: Math.max(1, p.units.length) }
      const ok = planProblems(inputs, p.assumptions).length === 0
      return { plan: p, result: ok ? planCycle(inputs, p.assumptions) : null }
    })
  }, [plans, compareIds])
  const note = useMemo(
    () => compareNote(rows.filter((r) => r.result).map((r) => ({ name: shortName(r.plan.name), result: r.result }))),
    [rows],
  )
  const toggle = (id) =>
    setCompareIds((ids) => {
      const base = ids.length ? ids : rows.map((r) => r.plan._id)
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id].slice(-PLAN_LIMITS.maxPlansCompared)
    })
  const shown = new Set(rows.map((r) => r.plan._id))

  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
      {plans === undefined ? (
        <LoadingState />
      ) : plans.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <span className="text-sm text-muted">{t('cyclePlanner.noPlans')}</span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[640px] w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs leading-4 text-faint">
                <th className="w-[240px] px-5 py-3 font-normal">{t('cyclePlanner.col.plan')}</th>
                <th className="px-3 py-3 font-normal">{t('cyclePlanner.col.harvest')}</th>
                <th className="px-3 py-3 font-normal">{t('cyclePlanner.col.tonnes')}</th>
                <th className="px-3 py-3 font-normal">{t('cyclePlanner.col.cash')}</th>
                <th className="px-3 py-3 text-right font-normal">{t('cyclePlanner.col.margin')}</th>
                <th className="w-[72px] px-3 py-3" aria-label={t('cyclePlanner.col.actions')} />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ plan: p, result: r }, i) => {
                const best = r && rows.every((o) => !o.result || o.result.margin <= r.margin)
                return (
                  <tr key={p._id} className={`border-b border-line ${p._id === currentId ? 'bg-surface-2' : ''}`}>
                    <td className="px-5 py-3.5">
                      <button type="button" onClick={() => onOpen(p)} className="flex items-center gap-2.5 text-left">
                        <span className={`size-2 shrink-0 rounded-pill ${PLAN_DOTS[i % PLAN_DOTS.length]}`} aria-hidden />
                        <span className="flex flex-col gap-0.5">
                          <span className={`${p._id === currentId ? 'font-semibold' : 'font-medium'} text-[14px] leading-[18px] text-text hover:underline`}>{p.name}</span>
                          <span className="text-xs leading-4 text-muted">
                            {t('cyclePlanner.planLine', { fish: fmt(p.inputs.fishPerUnit), g: fmt(p.inputs.harvestAbwG) })}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-3.5 text-text">{r?.reached ? shortDate(r.harvestDate) : '—'}</td>
                    <td className="px-3 py-3.5 font-data text-text">{r ? tonnes(r.harvestKg) : '—'}</td>
                    <td className="px-3 py-3.5 font-data text-text">{r ? money(r.cashNeeded) : '—'}</td>
                    <td className={`px-3 py-3.5 text-right font-data ${best && rows.length > 1 ? 'text-good' : 'text-text'}`}>{r ? money(r.margin) : '—'}</td>
                    <td className="px-3 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => onDelete(p)}
                        className="inline-flex size-8 items-center justify-center rounded-pill text-muted hover:bg-surface-2 hover:text-alert"
                        aria-label={t('cyclePlanner.deletePlan', { name: p.name })}
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {plans && plans.length > rows.length ? (
        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          <span className="text-xs leading-6 text-faint">{t('cyclePlanner.alsoSaved')}</span>
          {plans
            .filter((p) => !shown.has(p._id))
            .slice(0, 12)
            .map((p) => (
              <GhostButton key={p._id} size="sm" onClick={() => toggle(p._id)}>
                {p.name}
              </GhostButton>
            ))}
        </div>
      ) : null}
      <div className="flex items-center gap-3 px-5 py-3.5">
        {note ? (
          <>
            <span className="flex size-[22px] shrink-0 items-center justify-center rounded-pill bg-lime font-data text-[11px] font-semibold leading-3 text-ink" aria-hidden>
              a
            </span>
            <p className="grow text-sm leading-[19px] text-muted">
              {note.kind === 'same'
                ? t('cyclePlanner.note.same', { name: note.name })
                : t('cyclePlanner.note.tradeoff', {
                    fast: note.fast,
                    best: note.best,
                    weeks: note.weeks,
                    gap: money(note.marginGap),
                    leader: note.perMonthLeader,
                    perMonth: money(note.perMonth),
                  })}
            </p>
          </>
        ) : (
          <p className="grow text-sm leading-[19px] text-muted">{t('cyclePlanner.note.none')}</p>
        )}
        <button type="button" onClick={onNew} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium leading-[18px] text-sky-ink hover:underline">
          <Plus size={14} aria-hidden />
          {t('cyclePlanner.addPlan')}
        </button>
      </div>
    </div>
  )
}
