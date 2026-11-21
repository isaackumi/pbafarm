import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import { Plus, X } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { errorMessage } from '../lib/errorMessage'
import { GhostButton, GradientButton, KpiStrip, LoadingState, Pill } from './ui'
import { formatNumber, getActiveZone, localToday } from '../lib/format'
import { useLocale, useT } from '../lib/i18n/context'
import {
  classBounds,
  densityAfter,
  formatRounds,
  gradingCv,
  parseRounds,
  sampleStats,
  weeksToTarget,
} from '../convex/lib/gradingMath'

const CARD = 'flex min-w-0 flex-col rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'
// Paper 52 class tones. Dots: Large lime, Medium sky, Small muted (52 Light:
// #A8C93A, #3D86E6, #8A9098). Ink: the sample labels and the after-bar
// labels (lime-ink, sky-ink, muted in both themes).
const DOT = {
  large: 'bg-lime [html[data-theme=light]_&]:bg-[#A8C93A]',
  medium: 'bg-sky-ink [html[data-theme=light]_&]:bg-[#3D86E6]',
  small: 'bg-muted [html[data-theme=light]_&]:bg-[#8A9098]',
}
const INK = { large: 'text-lime-ink', medium: 'text-sky-ink', small: 'text-muted' }
// Number cells read as plain 14/18 text (Paper 52) and become fields on focus.
const CELL =
  'h-[30px] w-[calc(100%+8px)] -mr-2 rounded-[8px] border bg-transparent px-2 text-right text-[14px] leading-[18px] text-text tabular-nums placeholder:text-faint hover:border-line-strong focus:border-cyan focus:bg-bg focus:outline-none'
// Inline header fields (grader bars, date): 13/16 muted text. The global
// input colour rule is unlayered, so the colour needs `!`.
const INLINE_FIELD =
  'rounded-[6px] bg-transparent text-[13px] leading-4 !text-muted [field-sizing:content] placeholder:text-faint hover:!text-text focus:!text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

const newGrade = (cageId = '') => ({
  key: Math.random().toString(36).slice(2),
  cageId,
  quantity: '',
  abw: '',
  batchNumber: '',
  samples: [],
})
const posInt = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0)
const round1 = (n) => Math.round(n * 10) / 10
// No value yet (an en dash, as in SiteConditions).
const EMPTY = '\u2013'

/** Paper 52 "Save draft" glyph (clock arc). */
export function DraftIcon({ size = 16, strokeWidth = 2, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <path d="M12 8v4l3 2M21 12a9 9 0 11-9-9" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  )
}

/** Class tone by position: heaviest first, lightest last. */
function toneOf(i, n) {
  if (i === 0) return 'large'
  if (i === n - 1) return 'small'
  return 'medium'
}

function useClassName() {
  const t = useT()
  return (i, n) => {
    if (n === 1) return t('gradingPage.split.classN', { n: 1 })
    if (i === 0) return t('gradingPage.split.large')
    if (i === n - 1) return t('gradingPage.split.small')
    return n === 3 ? t('gradingPage.split.medium') : t('gradingPage.split.mediumN', { n: i })
  }
}

/** A number shown as text (thousands separators, unit) that edits as a field. */
function NumCell({ id, label, value, fallback = null, suffix = '', decimals = 0, onChange, inputMode = 'numeric' }) {
  const { locale } = useLocale()
  const [focused, setFocused] = useState(false)
  const shown =
    value !== ''
      ? `${formatNumber(Number(value), { locale, decimals: Number.isInteger(Number(value)) ? 0 : decimals })}${suffix}`
      : fallback != null
        ? `${formatNumber(fallback, { locale, decimals: Number.isInteger(fallback) ? 0 : decimals })}${suffix}`
        : ''
  return (
    <div className="w-[80px] shrink-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        value={focused ? value : shown}
        placeholder={focused && fallback != null ? String(fallback) : suffix ? 'g' : '0'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))}
        className={`${CELL} ${shown ? 'border-transparent' : 'border-line-strong'}`}
      />
    </div>
  )
}

/** Paper 52 destination pill: 13/16 text, 6/12 padding, 12px chevron. */
function PillSelect({ id, label, value, onChange, children, className = '' }) {
  return (
    <div className={`relative inline-flex max-w-full ${className}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={onChange}
        className="h-[30px] max-w-full cursor-pointer appearance-none truncate rounded-pill border [field-sizing:content] border-line-strong bg-transparent pl-3 pr-8 text-[13px] leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      >
        {children}
      </select>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
      >
        <path d="M6 9l6 6 6-6" fill="none" stroke="#8B9097" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function SampleCheck({ grades, stats, names, tones, sampler, onSamples }) {
  const t = useT()
  const { locale } = useLocale()
  const [open, setOpen] = useState(null)
  const [text, setText] = useState('')
  const editing = grades.find((g) => g.key === open)
  const n = grades.length
  const sampled = stats.filter(Boolean)
  const uniform =
    sampled.length > 0 &&
    sampled.length === n &&
    sampled.every((s) => s.perRound != null && s.perRound === sampled[0].perRound && s.rounds === sampled[0].rounds)
  const title = uniform
    ? t('gradingPage.sample.rounds', { r: sampled[0].rounds, n: sampled[0].perRound })
    : sampled.length
      ? t('gradingPage.sample.weighed', { n: sampled.reduce((s, x) => s + x.n, 0) })
      : t('gradingPage.sample.title')
  const time = sampler?.at
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: getActiveZone() }).format(
        new Date(sampler.at),
      )
    : null
  const toggle = (g) => {
    if (open === g.key) return setOpen(null)
    setOpen(g.key)
    setText(formatRounds(g.samples))
  }
  return (
    <section className={`${CARD} gap-4 px-[26px] py-6`} aria-labelledby="gr-sample-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="gr-sample-title" className="text-[15px] font-semibold leading-[18px] text-text">
          {title}
        </h2>
        <p className="text-[13px] leading-4 text-muted">
          {sampler?.name && time ? t('gradingPage.sample.by', { name: sampler.name, time }) : t('gradingPage.sample.notYet')}
        </p>
      </div>
      {n === 0 ? (
        <p className="text-[13px] leading-4 text-muted">{t('gradingPage.sample.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:flex">
          {grades.map((g, i) => {
            const s = stats[i]
            return (
              <button
                key={g.key}
                type="button"
                aria-expanded={open === g.key}
                aria-controls="gr-sample-editor"
                aria-label={t('gradingPage.sample.editAria', { name: names[i] })}
                onClick={() => toggle(g)}
                className={`flex min-w-0 grow basis-0 flex-col gap-1 rounded-[14px] bg-surface-2 px-4 py-[14px] text-left hover:ring-1 hover:ring-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                  open === g.key ? 'ring-1 ring-line-strong' : ''
                }`}
              >
                <span className={`text-xs leading-4 ${INK[tones[i]]}`}>{names[i]}</span>
                {s ? (
                  <span className="text-[20px] font-semibold leading-6 tracking-[-0.02em] text-text tabular-nums">
                    {formatNumber(Math.round(s.mean), { locale })} g{' '}
                    <span className="text-[13px] font-normal tracking-[-0.02em] text-muted [html[data-theme=light]_&]:text-text">
                      ± {formatNumber(Math.round(s.sd), { locale })}
                    </span>
                  </span>
                ) : (
                  <span className="text-[13px] leading-6 text-muted">{t('gradingPage.sample.add')}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
      {editing && (
        <div id="gr-sample-editor" className="flex flex-col gap-2">
          <label htmlFor="gr-sample-text" className="text-[13px] leading-4 text-text">
            {t('gradingPage.sample.editorLabel', { name: names[grades.indexOf(editing)] })}
          </label>
          <textarea
            id="gr-sample-text"
            rows={3}
            value={text}
            aria-describedby="gr-sample-hint"
            onChange={(e) => {
              setText(e.target.value)
              onSamples(editing.key, parseRounds(e.target.value))
            }}
            className="w-full rounded-input border border-line-strong bg-bg px-3 py-2 font-mono text-[13px] leading-5 text-text tabular-nums focus:border-cyan focus:outline-none"
          />
          <div className="flex items-center justify-between gap-3">
            <p id="gr-sample-hint" className="text-xs leading-4 text-muted">
              {t('gradingPage.sample.editorHint')}
            </p>
            <GhostButton type="button" size="sm" onClick={() => setOpen(null)}>
              {t('gradingPage.sample.done')}
            </GhostButton>
          </div>
        </div>
      )}
    </section>
  )
}

const tonnes = (kg, locale, decimals = 2) => formatNumber(kg / 1000, { locale, decimals })

function BeforeAfter({ source, outputs, densities, cageName }) {
  const t = useT()
  const { locale } = useLocale()
  const totalKg = outputs.reduce((s, o) => s + o.kg, 0)
  const known = densities.filter((d) => d.kgPer != null)
  const measures = new Set(known.map((d) => d.measure))
  const unitOf = (m) => (m === 'area' ? 'kg/m²' : 'kg/m³')
  const limits = new Set(densities.filter((d) => d.fish.max).map((d) => `${d.fish.max}|${d.fish.unit}`))
  const [limitMax, limitUnit] = limits.size === 1 ? [...limits][0].split('|') : [null, null]
  const levelTone = { over: 'text-alert', warn: 'text-warn' }
  return (
    <section className={`${CARD} gap-5 px-[26px] py-6`} aria-labelledby="gr-ba-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="gr-ba-title" className="text-[15px] font-semibold leading-[18px] text-text">
          {t('gradingPage.beforeAfter.title')}
        </h2>
        <p className="text-[13px] leading-4 text-muted">{t('gradingPage.beforeAfter.sub')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex justify-between gap-2 text-[13px] leading-4">
          <span className="text-muted">{t('gradingPage.beforeAfter.before', { cage: source?.cage_name ?? '…' })}</span>
          <span className="text-text tabular-nums">
            {source && source.biomass_kg != null
              ? t('gradingPage.beforeAfter.beforeValue', { t: tonnes(source.biomass_kg, locale), n: source.count })
              : EMPTY}
          </span>
        </div>
        <div
          aria-hidden
          className="h-[14px] shrink-0 rounded-pill opacity-55 [background-image:linear-gradient(in_oklab_90deg,#8B9097_0%,#6AA8F5_50%,#D7F75B_100%)] [html[data-theme=light]_&]:[background-image:linear-gradient(in_oklab_90deg,#A8C93A_0%,#3D86E6_100%)]"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex justify-between gap-2 text-[13px] leading-4">
          <span className="text-muted">{t('gradingPage.beforeAfter.after')}</span>
          <span className="text-text tabular-nums">
            {outputs.length
              ? t('gradingPage.beforeAfter.afterValue', { t: tonnes(totalKg, locale), count: outputs.length })
              : EMPTY}
          </span>
        </div>
        {outputs.length ? (
          <>
            <div className="flex h-[14px] shrink-0 gap-1" aria-hidden>
              {outputs.map((o) => (
                <div key={o.key} className={`rounded-pill ${DOT[o.tone]}`} style={{ width: `${(o.kg / totalKg) * 100}%` }} />
              ))}
            </div>
            <ul className="flex gap-1">
              {outputs.map((o) => {
                const pct = (o.kg / totalKg) * 100
                return (
                  <li
                    key={o.key}
                    className={`min-w-0 truncate text-xs leading-4 ${INK[o.tone]}`}
                    style={{ width: `${pct}%` }}
                    title={`${cageName(o.cageId)} · ${tonnes(o.kg, locale)} t`}
                  >
                    {cageName(o.cageId)}
                    {pct >= 20 ? ` · ${tonnes(o.kg, locale)} t` : <span className="sr-only">{` · ${tonnes(o.kg, locale)} t`}</span>}
                  </li>
                )
              })}
            </ul>
          </>
        ) : (
          <p className="text-xs leading-4 text-muted">
            {source ? t('gradingPage.beforeAfter.noDest') : t('gradingPage.beforeAfter.noSource')}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-[2px] border-t border-line pt-4">
        <h3 className="text-[14px] font-normal leading-[18px] text-text">{t('gradingPage.beforeAfter.density')}</h3>
        <p className="text-xs leading-4 text-muted tabular-nums">
          {known.length === 0
            ? t('gradingPage.beforeAfter.densityEmpty')
            : known.map((d, i) => (
                <React.Fragment key={d.unitId}>
                  {i > 0 ? ' · ' : ''}
                  <span className={levelTone[d.fish.level] || ''}>
                    {cageName(d.unitId)} {formatNumber(d.kgPer, { locale, decimals: d.kgPer >= 1 ? 0 : 1 })}
                    {measures.size > 1 ? ` ${unitOf(d.measure)}` : ''}
                  </span>
                </React.Fragment>
              ))}
          {known.length > 0 && measures.size === 1 ? ` ${unitOf([...measures][0])}` : ''}
          {known.length > 0 && limitMax
            ? ` · ${t('gradingPage.beforeAfter.limit', { max: Number(limitMax), unit: limitUnit })}`
            : ''}
        </p>
      </div>
    </section>
  )
}

/**
 * Grade every fish in a cage into size classes (doc 05 §7.3, Paper 52). Each
 * class becomes a child batch in the cage it goes to; culls are recorded as
 * deaths; fish the classes do not account for are recorded as unaccounted.
 * A grading in progress saves as a draft (convex/grading.ts) and resumes.
 */
export default function GradingForm({ initialCageId = '', formId = 'grading-form', aside = null }) {
  const t = useT()
  const { locale } = useLocale()
  const className = useClassName()
  const { user } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const [today] = useState(() => localToday())
  const cages = useQuery(api.cages.list, user ? {} : 'skip')
  const drafts = useQuery(api.grading.drafts, user ? {} : 'skip')
  const grade = useMutation(api.batches.grade)
  const saveDraft = useMutation(api.grading.saveDraft)

  const [cageId, setCageId] = useState(initialCageId)
  const [date, setDate] = useState(today)
  const [graderBars, setGraderBars] = useState('')
  const [grades, setGrades] = useState([newGrade(initialCageId), newGrade()])
  const [culls, setCulls] = useState('')
  const [reason, setReason] = useState('')
  const [sampler, setSampler] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(null)
  const view = useQuery(api.grading.view, user && cageId ? { cageId, asOf: today } : 'skip')

  // Resume: with no cage asked for, open the latest draft.
  const picked = useRef(!!initialCageId)
  useEffect(() => {
    if (picked.current || !drafts) return
    picked.current = true
    if (!cageId && drafts.length) setCageId(drafts[0].cage_id)
  }, [drafts, cageId])

  // Load the saved draft of the chosen cage once, when it arrives.
  const hydrated = useRef('')
  useEffect(() => {
    if (!cageId || !view || hydrated.current === cageId) return
    hydrated.current = cageId
    const d = view.draft
    if (!d) return
    setDate(d.date)
    setGraderBars(d.grader_bars ?? '')
    setGrades(
      d.classes.length
        ? d.classes.map((c) => ({
            ...newGrade(c.cageId ?? ''),
            quantity: c.quantity != null ? String(c.quantity) : '',
            abw: c.abw != null ? String(c.abw) : '',
            batchNumber: c.batchNumber ?? '',
            samples: c.samples,
          }))
        : [newGrade(cageId)],
    )
    setCulls(d.culls != null ? String(d.culls) : '')
    setReason(d.reason ?? '')
    setSampler(d.sampled_by && d.sampled_at ? { name: d.sampled_by, at: d.sampled_at } : null)
  }, [cageId, view])

  const list = useMemo(() => cages || [], [cages])
  const byId = useMemo(() => new Map(list.map((c) => [String(c.id), c])), [list])
  const draftIds = useMemo(() => new Set((drafts || []).map((d) => String(d.cage_id))), [drafts])
  const source = byId.get(String(cageId))
  const available = source?.current_count ?? 0
  const cageName = (id) => byId.get(String(id))?.name ?? '?'
  // A class can go back into the graded cage or into an empty one.
  const targets = list.filter((c) => String(c.id) === String(cageId) || (c.current_count ?? 0) === 0)
  const setGrade = (key, patch) => setGrades((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)))

  const n = grades.length
  const names = grades.map((_, i) => className(i, n))
  const tones = grades.map((_, i) => toneOf(i, n))
  const stats = grades.map((g) => sampleStats(g.samples))
  const counts = grades.map((g) => posInt(g.quantity))
  const abws = grades.map((g, i) => (Number(g.abw) > 0 ? Number(g.abw) : stats[i] ? round1(stats[i].mean) : null))
  const classSum = counts.reduce((s, c) => s + c, 0)
  const cullsN = posInt(culls)
  const gap = available - classSum - cullsN
  const massG = counts.reduce((s, c, i) => s + c * (abws[i] || 0), 0)
  const avgAbw = classSum && massG ? massG / classSum : null
  const cv = gradingCv(counts.map((count, i) => ({ count, stats: stats[i] })))
  const bounds = classBounds(abws.map((abw, i) => ({ abw, stats: stats[i] })))

  const outputs = grades
    .map((g, i) => ({ key: g.key, cageId: g.cageId, count: counts[i], abw: abws[i], tone: tones[i] }))
    .filter((o) => o.cageId && o.count > 0 && o.abw > 0 && byId.has(String(o.cageId)))
    .map((o) => ({ ...o, kg: (o.count * o.abw) / 1000 }))
  const densities = view
    ? densityAfter(
        outputs.map((o) => ({ unit: byId.get(String(o.cageId)), count: o.count, abwG: o.abw })),
        view.farm_rules,
      )
    : []

  // Row hints: weeks to market for the heaviest class, a lower density for the lightest.
  const weighed = abws.map((a, i) => ({ a, i })).filter((x) => x.a > 0)
  const heaviest = weighed.length ? weighed.reduce((m, x) => (x.a > m.a ? x : m)).i : -1
  const lightest = weighed.length > 1 ? weighed.reduce((m, x) => (x.a < m.a ? x : m)).i : -1
  const market = view?.source?.market
  const densityByCage = new Map(densities.map((d) => [d.unitId, d.kgPer]))
  const knownDensities = densities.map((d) => d.kgPer).filter((x) => x != null)
  const hintOf = (i) => {
    if (i === heaviest && market) {
      const w = weeksToTarget(abws[i], market.target_g, market.tgc, market.eff_temp_c)
      if (w === 0) return t('gradingPage.split.marketNow')
      if (w != null) return t('gradingPage.split.market', { count: w })
    }
    if (i === lightest && knownDensities.length > 1) {
      const own = densityByCage.get(String(grades[i].cageId))
      if (own != null && own === Math.min(...knownDensities) && own < Math.max(...knownDensities)) {
        return t('gradingPage.split.lowerDensity')
      }
    }
    return null
  }
  const subtitleOf = (i) => {
    const b = bounds[i]
    const parts = []
    if (b.above != null && b.below != null) parts.push(t('gradingPage.split.between', { lo: b.above, hi: b.below }))
    else if (b.above != null) parts.push(t('gradingPage.split.above', { g: b.above }))
    else if (b.below != null) parts.push(t('gradingPage.split.below', { g: b.below }))
    if (classSum > 0 && counts[i] > 0) parts.push(t('gradingPage.split.share', { pct: Math.round((counts[i] / classSum) * 100) }))
    const hint = hintOf(i)
    if (hint) parts.push(hint)
    return parts.join(' · ')
  }

  const chooseCage = (id) => {
    setCageId(id)
    hydrated.current = ''
    // The first class stays in the graded cage unless it already goes elsewhere.
    setGrades((gs) => gs.map((g, i) => (i === 0 && (!g.cageId || g.cageId === cageId) ? { ...g, cageId: id } : g)))
  }

  const classesPayload = () =>
    grades.map((g) => ({
      cageId: g.cageId || undefined,
      quantity: g.quantity !== '' && Number.isInteger(Number(g.quantity)) ? Number(g.quantity) : undefined,
      abw: Number(g.abw) > 0 ? Number(g.abw) : undefined,
      batchNumber: g.batchNumber.trim() || undefined,
      samples: g.samples,
    }))

  const onSave = async () => {
    if (!cageId) return setError(t('gradingPage.errors.chooseCage'))
    setSaving('draft')
    try {
      await saveDraft({
        cageId,
        date,
        graderBars: graderBars.trim() || undefined,
        classes: classesPayload(),
        culls: culls !== '' && Number.isInteger(Number(culls)) ? Number(culls) : undefined,
        reason: reason.trim() || undefined,
      })
      showToast('success', t('gradingPage.draftSaved'))
    } catch (err) {
      const message = errorMessage(err, t('gradingPage.errors.draftFailed'))
      setError(message)
      showToast('error', message)
    } finally {
      setSaving(null)
    }
  }

  const onConfirm = async () => {
    const filled = grades
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => g.cageId || g.quantity || g.abw || g.samples.length)
    if (!cageId) return setError(t('gradingPage.errors.chooseCage'))
    if (!filled.length) return setError(t('gradingPage.errors.addClass'))
    if (filled.some(({ g, i }) => !g.cageId || !posInt(g.quantity) || !(abws[i] > 0))) {
      return setError(t('gradingPage.errors.classFields'))
    }
    if (new Set(filled.map(({ g }) => g.cageId)).size !== filled.length) return setError(t('gradingPage.errors.oneEach'))
    setSaving('confirm')
    try {
      const r = await grade({
        cageId,
        date,
        graderBars: graderBars.trim() || undefined,
        outputs: filled.map(({ g, i }) => ({
          cageId: g.cageId,
          quantity: posInt(g.quantity),
          abw: abws[i],
          batchNumber: g.batchNumber.trim() || undefined,
          samples: g.samples.length ? g.samples : undefined,
        })),
        culls: cullsN,
        reason: reason.trim() || undefined,
      })
      showToast(
        'success',
        r.unaccounted
          ? t('gradingPage.gradedUnaccounted', { n: r.childBatchIds.length, u: r.unaccounted })
          : t('gradingPage.graded', { n: r.childBatchIds.length }),
      )
      router.push(`/batches/${r.childBatchIds[0]}`)
    } catch (err) {
      const message = errorMessage(err, t('gradingPage.errors.saveFailed'))
      setError(message)
      showToast('error', message)
    } finally {
      setSaving(null)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    if (saving) return
    setError('')
    if (e.nativeEvent?.submitter?.value === 'draft') return onSave()
    return onConfirm()
  }

  if (cages === undefined) {
    return (
      <div className="flex flex-col gap-[28px]">
        <div className={`${CARD} px-[26px] py-6`}>
          <LoadingState label={t('ui.loading')} />
        </div>
        {aside}
      </div>
    )
  }

  const src = view?.source
  const sourceLabel = (
    <>
      {t('gradingPage.kpi.source')} ·{' '}
      <label htmlFor="gr-cage" className="sr-only">
        {t('gradingPage.kpi.sourceAria')}
      </label>
      <select
        id="gr-cage"
        value={cageId}
        onChange={(e) => chooseCage(e.target.value)}
        className="cursor-pointer appearance-none rounded-[4px] bg-transparent uppercase tracking-[0.06em] !text-faint [field-sizing:content] hover:!text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      >
        <option value="">{t('gradingPage.kpi.chooseCage')}</option>
        {list
          .filter((c) => (c.current_count ?? 0) > 0 || String(c.id) === String(cageId))
          .map((c) => (
            <option key={c.id} value={c.id}>
              {/* The chosen cage reads as in Paper ("Source · C-07"); others flag a saved draft. */}
              {draftIds.has(String(c.id)) && String(c.id) !== String(cageId) ? t('gradingPage.draftMark', { name: c.name }) : c.name}
            </option>
          ))}
      </select>
    </>
  )

  return (
    <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-[28px]">
      {/* Paper 52 KPI strip: the cage being graded, the count, weight and size spread. */}
      <KpiStrip
        items={[
          {
            key: 'source',
            label: sourceLabel,
            value: src?.batch_number ?? EMPTY,
            suffix: src?.day != null ? t('gradingPage.kpi.day', { n: src.day }) : undefined,
            suffixTone: 'note',
          },
          {
            key: 'counted',
            label: t('gradingPage.kpi.counted'),
            value: formatNumber(classSum, { locale }),
            suffix: source ? t('gradingPage.kpi.of', { n: available }) : undefined,
            suffixTone: 'note',
          },
          {
            key: 'abw',
            label: t('gradingPage.kpi.avg'),
            value: avgAbw == null ? EMPTY : `${formatNumber(Math.round(avgAbw), { locale })} g`,
            suffix: massG ? t('gradingPage.kpi.biomass', { t: formatNumber(massG / 1e6, { locale, decimals: 1 }) }) : undefined,
            suffixTone: 'note',
          },
          {
            key: 'cv',
            label: t('gradingPage.kpi.cv'),
            value: cv ? `${Math.round(cv.beforePct)}%` : EMPTY,
            suffix: cv ? t('gradingPage.kpi.cvAfter', { pct: Math.round(cv.afterPct) }) : t('gradingPage.kpi.cvEmpty'),
            suffixTone: cv ? 'noteWarn' : 'note',
          },
        ]}
      />

      <div className="flex flex-col items-start gap-5 xl:flex-row">
        <div className="flex w-full min-w-0 flex-col gap-5 xl:w-[700px] xl:shrink-0">
          {/* Size-class split (Paper GB1-0) */}
          <section className={CARD} aria-labelledby="gr-split-title">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="gr-split-title" className="text-[17px] font-semibold leading-[22px] text-text">
                  {t('gradingPage.split.title')}
                </h2>
                <p className="flex items-center gap-1 text-[13px] leading-4 text-muted">
                  <label htmlFor="gr-bars">{t('gradingPage.split.graderBars')}</label>
                  <input
                    id="gr-bars"
                    value={graderBars}
                    maxLength={40}
                    placeholder="18 / 24"
                    aria-label={t('gradingPage.split.graderBarsAria')}
                    onChange={(e) => setGraderBars(e.target.value)}
                    className={`${INLINE_FIELD} min-w-[3ch]`}
                  />
                  <span aria-hidden>{t('gradingPage.split.mm')}</span>
                  <span aria-hidden className="px-1">
                    ·
                  </span>
                  <label htmlFor="gr-date" className="sr-only">
                    {t('gradingPage.split.dateAria')}
                  </label>
                  <input
                    id="gr-date"
                    type="date"
                    value={date}
                    max={today}
                    onChange={(e) => setDate(e.target.value)}
                    className={INLINE_FIELD}
                  />
                </p>
              </div>
              <button
                type="button"
                disabled={grades.length >= 20}
                onClick={() => setGrades((gs) => [...gs, newGrade()])}
                className="inline-flex items-center gap-[6px] rounded-sm text-[13px] leading-4 text-sky-ink hover:underline [html[data-theme=light]_&]:text-[#1562D6] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50"
              >
                {/* Paper 52: the plus is stroked #9FE3E6 beside sky text (#1562D6 for both on 52 Light). */}
                <Plus size={14} strokeWidth={2} aria-hidden className="text-[#9FE3E6] [html[data-theme=light]_&]:text-[#1562D6]" />
                {t('gradingPage.split.addClass')}
              </button>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                <div className="flex items-center gap-6 px-6 py-3 text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint" aria-hidden>
                  <div className="grow basis-0">{t('gradingPage.split.class')}</div>
                  <div className="w-[80px] shrink-0 text-right">{t('gradingPage.split.count')}</div>
                  <div className="w-[80px] shrink-0 text-right">{t('gradingPage.split.avgWt')}</div>
                  <div className="w-[150px] shrink-0">{t('gradingPage.split.destination')}</div>
                </div>
                <ul>
                  {grades.map((g, i) => {
                    const sub = subtitleOf(i)
                    return (
                      <li key={g.key} className="group relative flex items-center gap-6 border-t border-line px-6 py-4">
                        <div className="flex min-w-0 grow basis-0 items-center gap-3">
                          <span className={`size-[10px] shrink-0 rounded-pill ${DOT[tones[i]]}`} aria-hidden />
                          <div className="flex min-w-0 flex-col gap-[2px]">
                            <p className="text-[14px] leading-[18px] text-text">{names[i]}</p>
                            <p className="min-h-4 text-xs leading-4 text-muted tabular-nums">{sub}</p>
                          </div>
                        </div>
                        <NumCell
                          id={`gr-qty-${g.key}`}
                          label={t('gradingPage.split.countAria', { name: names[i] })}
                          value={g.quantity}
                          onChange={(v) => setGrade(g.key, { quantity: v.replace(/[.,]/g, '') })}
                        />
                        <NumCell
                          id={`gr-abw-${g.key}`}
                          label={t('gradingPage.split.abwAria', { name: names[i] })}
                          value={g.abw}
                          fallback={stats[i] ? Math.round(stats[i].mean) : null}
                          suffix=" g"
                          decimals={1}
                          inputMode="decimal"
                          onChange={(v) => setGrade(g.key, { abw: v })}
                        />
                        <div className="flex w-[150px] shrink-0">
                          <PillSelect
                            id={`gr-to-${g.key}`}
                            label={t('gradingPage.split.destAria', { name: names[i] })}
                            value={g.cageId}
                            onChange={(e) => setGrade(g.key, { cageId: e.target.value })}
                            className="min-w-0"
                          >
                            <option value="">{t('gradingPage.split.chooseDest')}</option>
                            {targets.map((c) => (
                              <option key={c.id} value={c.id}>
                                {String(c.id) === String(cageId)
                                  ? t('gradingPage.split.stay', { cage: c.name })
                                  : t('gradingPage.split.move', { cage: c.name })}
                              </option>
                            ))}
                          </PillSelect>
                          {grades.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setGrades((gs) => gs.filter((x) => x.key !== g.key))}
                              aria-label={t('gradingPage.split.remove', { name: names[i] })}
                              className="absolute right-[2px] top-1/2 -translate-y-1/2 rounded-sm p-1 text-faint opacity-0 hover:text-alert focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan group-hover:opacity-100"
                            >
                              <X size={14} strokeWidth={2} aria-hidden />
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <div className="flex items-center gap-6 rounded-b-card border-t border-line bg-[#0E1012] px-6 py-4 [html[data-theme=light]_&]:bg-[#F4F7FB]">
                  <div className="flex grow basis-0 flex-wrap items-center whitespace-pre text-[13px] leading-4 text-muted">
                    <span>{`${t('gradingPage.split.total')} · `}</span>
                    <label htmlFor="gr-culls" className="sr-only">
                      {t('gradingPage.split.cullsAria')}
                    </label>
                    <input
                      id="gr-culls"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="0"
                      value={culls}
                      onChange={(e) => setCulls(e.target.value.replace(/\D/g, ''))}
                      className={`h-[22px] min-w-[3ch] rounded-[6px] border bg-transparent px-px text-center text-[13px] leading-4 !text-muted tabular-nums [field-sizing:content] hover:border-line-strong focus:border-cyan focus:!text-text focus:outline-none ${
                        culls ? 'border-transparent' : 'border-line-strong'
                      }`}
                    />
                    <span>{` ${t('gradingPage.split.culls')}`}</span>
                  </div>
                  <div className="w-[80px] shrink-0 text-right text-[14px] font-semibold leading-[18px] text-text tabular-nums">
                    {formatNumber(classSum, { locale })}
                  </div>
                  <div className="w-[80px] shrink-0 text-right text-[14px] font-semibold leading-[18px] text-text tabular-nums">
                    {avgAbw == null ? EMPTY : `${formatNumber(Math.round(avgAbw), { locale })} g`}
                  </div>
                  <div className="flex w-[150px] shrink-0">
                    {source &&
                      (gap === 0 ? (
                        <Pill tone="green">{t('gradingPage.split.balance')}</Pill>
                      ) : gap > 0 ? (
                        <Pill tone="amber">{t('gradingPage.split.unaccounted', { n: gap })}</Pill>
                      ) : (
                        <Pill tone="red">{t('gradingPage.split.over', { n: -gap })}</Pill>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {error && (
            <p className="text-sm text-alert" role="alert">
              {error}
            </p>
          )}

          <SampleCheck
            grades={grades}
            stats={stats}
            names={names}
            tones={tones}
            sampler={sampler}
            onSamples={(key, samples) => {
              setGrade(key, { samples })
              setSampler({ name: user?.full_name || user?.name || user?.email || '', at: Date.now() })
            }}
          />

          <div className="flex flex-wrap justify-end gap-3 sm:hidden">
            <GhostButton type="submit" name="intent" value="draft" icon={DraftIcon} size="xl" disabled={!!saving}>
              {saving === 'draft' ? t('gradingPage.saving') : t('gradingPage.saveDraft')}
            </GhostButton>
            <GradientButton type="submit" name="intent" value="confirm" variant="lime" disabled={!!saving}>
              {saving === 'confirm' ? t('gradingPage.saving') : t('gradingPage.confirm')}
            </GradientButton>
          </div>
        </div>
        <div className="flex w-full min-w-0 flex-col gap-5 xl:grow xl:basis-0">
          <BeforeAfter source={src} outputs={outputs} densities={densities} cageName={cageName} />
          {aside}
        </div>
      </div>
    </form>
  )
}
