import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from 'convex/react'
import { ArrowRight, ChevronDown, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, Field, GradientButton, Input, KpiStrip, Pill, Select, Table } from '../components/ui'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { useCurrency } from '../hooks/useCurrency'
import { buildFeedOverview, feedMoney, formatMass } from '../lib/feedOverview'
import { rangeToDates } from '../lib/feedData'
import { formatNumber } from '../lib/format'
import { useToast } from '../components/Toast'
import { kg, rationText } from '../components/RationSuggestion'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { usePermission } from '../hooks/usePermission'
import { errorMessage } from '../lib/errorMessage'
import { FISH_SPECIES } from '../lib/fishSpecies'
import { useLocale, useT } from '../lib/i18n/context'
import { RATION_LIMITS, bandProblems } from '../convex/lib/ration'

/**
 * Feed types & plans (PROD-015, Paper 67 J2W-0): feed tables per species
 * (ABW band → % body weight/day, meals, pellet size), the feed types they
 * use, and today's ration for one unit with a one-tap issue.
 */
export default function FeedingPlansPage() {
  return (
    <ProtectedRoute permission="production.view">
      <FeedingPlans />
    </ProtectedRoute>
  )
}

const speciesLabel = (p) => p.speciesName || FISH_SPECIES.find((s) => s.value === p.speciesKey)?.label || p.speciesKey

/** Paper 67 pellet column: 13/18 Geist Mono in #C9CDD2 (muted on the undesigned light theme). */
const PELLET = 'font-geist text-[13px] leading-[18px] text-[#C9CDD2] [html[data-theme=light]_&]:text-muted'
/** Paper 67 table head: 11/14 caps, 0.08em, faint. */
const HEAD = 'text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint'

const pelletText = (mm) => `${formatNumber(mm, { decimals: 1 })} mm`
/** "1.0 mm" ↔ a feed type's free-text pellet size ("1mm", "1.0 mm"). */
const pelletOf = (feedType) => {
  const n = parseFloat(String(feedType?.pellet_size || '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function FeedingPlans() {
  const t = useT()
  const { canUseApp } = useAuth()
  const { currency } = useCurrency()
  const canIssue = usePermission('inventory.issue')
  const canEdit = usePermission('org.settings.manage')
  const { locationArgs } = useLocation()
  const locationId = locationArgs?.locationId
  const rations = useQuery(api.feedingPlans.rations, canUseApp ? (locationId ? { locationId } : {}) : 'skip')
  const plans = useQuery(api.feedingPlans.list, canUseApp ? {} : 'skip')
  // Secondary reads (inventory / reports permissions): the page renders without them.
  const range = useMemo(() => rangeToDates('30d'), [])
  const feedTypes = useOptionalQuery(api.feed.listFeedTypes, canUseApp ? {} : 'skip')
  const stockLevels = useOptionalQuery(api.inventory.listStockLevels, canUseApp ? locationArgs : 'skip')
  const usage = useOptionalQuery(api.feed.listUsage, canUseApp ? { ...locationArgs, ...range } : 'skip')
  const kpis = useOptionalQuery(api.reports.dashboardKpis, canUseApp ? { ...locationArgs, dateRange: 30, asOf: range.dateTo } : 'skip')

  const [speciesKey, setSpeciesKey] = useState('')
  const [cageId, setCageId] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const editorRef = useRef(null)

  const withTable = (plans || []).filter((p) => p.bands?.length)
  const current = withTable.find((p) => p.speciesKey === speciesKey) ?? withTable[0] ?? null
  const rows = rations?.rows ?? []
  const onPlan = rows.filter((r) => r.ration.ok && current && r.speciesKey === current.speciesKey)
  const cage = onPlan.find((r) => r.cageId === cageId) ?? onPlan[0] ?? null

  const activeTypes = (feedTypes || []).filter((f) => f.active !== false)
  const feedForPellet = (mm) => activeTypes.find((f) => pelletOf(f) === mm) ?? null
  const overview = buildFeedOverview(stockLevels, usage, 30)
  const coverById = Object.fromEntries(overview.rows.map((r) => [r.id, r]))
  const today = range.dateTo
  const issuedToday = (usage || []).filter((u) => u.usage_date === today).reduce((s, u) => s + Number(u.quantity || 0), 0)

  const openEditor = () => {
    setEditorOpen(true)
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const fcr = kpis?.avg_fcr
  return (
    <Layout
      title={t('feedingPlan.paper.title')}
      eyebrow={t('feedingPlan.paper.eyebrow')}
      actions={
        <>
          {canEdit && (
            <GradientButton variant="lime" icon={Plus} onClick={openEditor}>
              {t('feedingPlan.paper.newPlan')}
            </GradientButton>
          )}
          {canIssue && (
            <GradientButton ring="sky" href="/feed-issue" icon={ArrowRight}>
              {t('ops.feed.issueFeed')}
            </GradientButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-[28px]">
        <KpiStrip
          items={[
            {
              key: 'plans',
              label: t('feedingPlan.paper.activePlans'),
              value: plans === undefined ? '—' : formatNumber(withTable.length),
              suffix: rations ? t('feedingPlan.paper.cagesOnPlan', { count: rations.planned }) : undefined,
            },
            {
              key: 'ration',
              label: t('feedingPlan.paper.rationToday'),
              value: rations ? formatMass(rations.totalKgPerDay) : '—',
              suffix: usage ? t('feedingPlan.paper.issuedSoFar', { amount: formatMass(issuedToday) }) : undefined,
            },
            {
              key: 'fcr',
              label: t('feedingPlan.paper.fcr30d'),
              value: fcr != null ? formatNumber(fcr, { decimals: 2 }) : '—',
            },
            {
              key: 'cover',
              label: t('feedingPlan.paper.feedCover'),
              value: overview.coverDays != null ? t('ops.feed.days', { count: Math.round(overview.coverDays) }) : '—',
              suffix: stockLevels ? t('feedingPlan.paper.inStore', { amount: formatMass(overview.totalKg) }) : undefined,
            },
          ]}
        />

        <div className="flex flex-col items-start gap-[20px] xl:flex-row">
          <div className="flex w-full min-w-0 flex-col gap-[20px] xl:w-[700px] xl:shrink-0">
            <PlanTable
              plans={withTable}
              current={current}
              onSpecies={(key) => { setSpeciesKey(key); setCageId('') }}
              onPlan={onPlan}
              highlight={cage?.ration.ok ? cage.ration.bandIndex : null}
              feedForPellet={feedForPellet}
              loading={plans === undefined}
            />
            <FeedTypesPanel types={activeTypes} coverById={coverById} currency={currency} loading={feedTypes === undefined} />
          </div>
          <TodayCard cage={cage} cages={onPlan} onCage={setCageId} feedForPellet={feedForPellet} loading={rations === undefined} canIssue={canIssue} />
        </div>

        <AllRations rations={rations} plans={plans} />
        {(editorOpen || !withTable.length) && (
          <div ref={editorRef}>
            <FeedTables plans={plans} />
          </div>
        )}
      </div>
    </Layout>
  )
}

/** Paper 67 plan table: segmented links, plan picker, one row per weight band. */
function PlanTable({ plans, current, onSpecies, onPlan, highlight, feedForPellet, loading }) {
  const t = useT()
  const bands = current?.bands ?? []
  const seg = 'rounded-pill px-[14px] py-2 text-[14px] leading-[18px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
  return (
    <section aria-label={t('feedingPlan.paper.plans')} className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4 pl-4 pr-6">
        <nav aria-label={t('feedingPlan.paper.title')} className="flex items-center gap-1">
          <span aria-current="page" className={`${seg} bg-surface-2 font-medium text-text`}>{t('feedingPlan.paper.plans')}</span>
          <Link href="/feed-types" className={`${seg} text-muted hover:text-text`}>{t('ops.tab.feedTypes')}</Link>
          <Link href="/feed-issue" className={`${seg} text-muted hover:text-text`}>{t('ops.feed.issueFeed')}</Link>
        </nav>
        {current && (
          <label className="relative flex items-center gap-2 rounded-pill border border-line-strong px-[14px] py-[7px] focus-within:ring-2 focus-within:ring-cyan">
            <span className="text-[13px] leading-4 text-text">{current.name || speciesLabel(current)}</span>
            <ChevronDown size={14} strokeWidth={2} aria-hidden className="shrink-0 text-muted" />
            <select
              aria-label={t('feedingPlan.col.species')}
              value={current.speciesKey}
              onChange={(e) => onSpecies(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              {plans.map((p) => (
                <option key={p.speciesKey} value={p.speciesKey}>
                  {p.name || speciesLabel(p)} · {speciesLabel(p)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          <div className="flex items-center gap-[20px] px-6 py-3">
            <div className={`w-[120px] shrink-0 ${HEAD}`}>{t('feedingPlan.paper.weightBand')}</div>
            <div className={`w-[70px] shrink-0 ${HEAD}`}>{t('feedingPlan.paper.pellet')}</div>
            <div className={`min-w-0 grow basis-0 ${HEAD}`}>{t('feedingPlan.paper.feed')}</div>
            <div className={`w-[90px] shrink-0 text-right ${HEAD}`}>{t('feedingPlan.paper.bwPerDay')}</div>
            <div className={`w-[70px] shrink-0 text-right ${HEAD}`}>{t('feedingPlan.paper.meals')}</div>
            <div className={`w-[60px] shrink-0 text-right ${HEAD}`}>{t('feedingPlan.paper.cages')}</div>
          </div>
          {loading ? (
            <p className="border-t border-line px-6 py-[14px] text-[14px] leading-[18px] text-muted">{t('common.loading')}</p>
          ) : !bands.length ? (
            <p className="border-t border-line px-6 py-[14px] text-[14px] leading-[18px] text-muted">{t('feedingPlan.source.none')}</p>
          ) : (
            bands.map((b, i) => {
              const next = bands[i + 1]?.minAbwG
              const on = i === highlight
              const count = onPlan.filter((r) => r.ration.bandIndex === i).length
              const feed = feedForPellet(b.pelletMm)
              const last = i === bands.length - 1
              return (
                <div
                  key={b.minAbwG}
                  className={`flex items-center gap-[20px] border-t border-line px-6 ${last ? 'pb-4 pt-[14px]' : 'py-[14px]'} ${on ? 'bg-surface-2' : ''}`}
                >
                  <div className="flex w-[120px] shrink-0 items-center gap-2">
                    {on && <span aria-hidden className="size-[6px] shrink-0 rounded-pill bg-sky-ink" />}
                    <span className={`text-[14px] leading-[18px] text-text ${on ? 'font-medium' : ''}`}>
                      {next != null
                        ? t('feedingPlan.paper.band', { from: formatNumber(b.minAbwG), to: formatNumber(next) })
                        : t('feedingPlan.paper.bandOpen', { from: formatNumber(b.minAbwG) })}
                    </span>
                  </div>
                  <div className={`w-[70px] shrink-0 ${PELLET}`}>{pelletText(b.pelletMm)}</div>
                  <div className="min-w-0 grow basis-0 truncate text-[14px] leading-[18px] text-text">
                    {feed ? [feed.name, feed.protein_percentage != null ? `${feed.protein_percentage}%` : null].filter(Boolean).join(' ') : '—'}
                  </div>
                  <div className="w-[90px] shrink-0 text-right text-[14px] leading-[18px] tabular-nums text-text">{formatNumber(b.bodyWeightPct, { decimals: b.bodyWeightPct % 1 ? 1 : 0 })}%</div>
                  <div className="w-[70px] shrink-0 text-right text-[14px] leading-[18px] tabular-nums text-text">{b.feedingsPerDay}</div>
                  <div className={`w-[60px] shrink-0 text-right text-[14px] leading-[18px] tabular-nums ${on ? 'text-sky-ink' : count ? 'text-text' : 'text-faint'}`}>{count}</div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </section>
  )
}

/** Paper 67 "Feed types": name (+ cover pill when low), protein, pellet, price per bag. */
function FeedTypesPanel({ types, coverById, currency, loading }) {
  const t = useT()
  const bagSizes = [...new Set(types.map((f) => Number(f.bag_size_kg)).filter((n) => n > 0))]
  const meta = [
    t('feedingPlan.paper.skus', { count: types.length }),
    bagSizes.length === 1 ? t('feedingPlan.paper.bags', { kg: formatNumber(bagSizes[0]) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <section aria-labelledby="fp-feed-types" className="flex flex-col gap-1 rounded-card border border-line bg-surface px-6 py-[22px] shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3 pb-[10px]">
        <h2 id="fp-feed-types" className="text-[15px] font-semibold leading-[18px] text-text">{t('ops.tab.feedTypes')}</h2>
        {!loading && types.length > 0 && <span className="text-[13px] leading-4 text-muted">{meta}</span>}
      </div>
      {loading ? (
        <p className="border-t border-line py-[11px] text-[14px] leading-[18px] text-muted">{t('common.loading')}</p>
      ) : !types.length ? (
        <p className="border-t border-line py-[11px] text-[14px] leading-[18px] text-muted">{t('ops.feed.noFeedTypes')}</p>
      ) : (
        types.map((f) => {
          const id = f.id || f._id
          const cover = coverById[id]
          const low = cover && cover.tone !== 'good' && cover.coverDays != null
          const pellet = pelletOf(f)
          const bag = Number(f.bag_size_kg) || 0
          return (
            <div key={id} className="flex items-center gap-[20px] border-t border-line py-[11px]">
              <div className="flex min-w-0 grow basis-0 items-center gap-[10px]">
                <span className="truncate text-[14px] leading-[18px] text-text">{f.name}</span>
                {low && (
                  <Pill size="sm" tone={cover.tone === 'alert' ? 'red' : 'amber'} className="py-[2px]! text-[11px]! leading-[14px]!">
                    {t('ops.feed.daysCover', { count: Math.round(cover.coverDays) })}
                  </Pill>
                )}
              </div>
              <div className="w-[90px] shrink-0 text-[13px] leading-4 text-muted">{f.protein_percentage != null ? `${f.protein_percentage}%` : '—'}</div>
              <div className="w-[110px] shrink-0 font-geist text-xs leading-4 text-muted">{pellet != null ? pelletText(pellet) : '—'}</div>
              <div className="w-[110px] shrink-0 text-right text-[14px] leading-[18px] tabular-nums text-text">
                {bag > 0 ? t('feedingPlan.paper.perBag', { amount: feedMoney(Number(f.price_per_kg || 0) * bag, currency) }) : '—'}
              </div>
            </div>
          )
        })
      )}
    </section>
  )
}

/** Paper 67 "Today's plan": one unit's ration, its meals, and the issue button. */
function TodayCard({ cage, cages, onCage, feedForPellet, loading, canIssue }) {
  const t = useT()
  const { locale } = useLocale()
  // Paper 67 "Wed 19": weekday then day, in every language.
  const now = new Date()
  const day = `${new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(now)} ${now.getDate()}`
  const r = cage?.ration
  return (
    <section aria-labelledby="fp-today" className="flex w-full min-w-0 grow basis-0 flex-col gap-[18px] rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase leading-4 tracking-[0.06em] text-faint">{t('feedingPlan.paper.today', { day })}</div>
        {cage ? (
          <label className="relative flex w-fit items-center gap-1">
            <h2 id="fp-today" className="text-[20px] font-semibold leading-6 text-text">{cage.cageName}</h2>
            {cages.length > 1 && (
              <>
                <ChevronDown size={14} strokeWidth={2} aria-hidden className="shrink-0 text-muted" />
                <select
                  aria-label={t('feedingPlan.col.unit')}
                  value={cage.cageId}
                  onChange={(e) => onCage(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                >
                  {cages.map((c) => (
                    <option key={c.cageId} value={c.cageId}>{c.cageName}</option>
                  ))}
                </select>
              </>
            )}
          </label>
        ) : (
          <h2 id="fp-today" className="text-[20px] font-semibold leading-6 text-text">{t('feedingPlan.todayTitle')}</h2>
        )}
        {cage && r?.ok && (
          <div className="text-[13px] leading-4 text-muted">
            {t('feedingPlan.paper.biomass', { kg: formatNumber(r.biomassKg), abw: formatNumber(cage.abwG) })}
          </div>
        )}
      </div>
      {loading ? (
        <p className="text-[13px] leading-4 text-muted">{t('common.loading')}</p>
      ) : !cage || !r?.ok ? (
        <p className="text-[13px] leading-4 text-muted">{t('feedingPlan.noUnits')}</p>
      ) : (
        <TodayBody cage={cage} r={r} feed={feedForPellet(r.pelletMm)} canIssue={canIssue} />
      )}
    </section>
  )
}

function TodayBody({ cage, r, feed, canIssue }) {
  const t = useT()
  const planKg = (r.biomassKg * r.tablePct) / 100
  const cut = Math.round((1 - r.tempFactor) * 100)
  const meals = Array.from({ length: r.feedingsPerDay }, (_, i) => i)
  const bag = Number(feed?.bag_size_kg) || 0
  const qty = Math.round(r.kgPerDay * 10) / 10
  const issueHref = `/feed-issue?cage=${encodeURIComponent(cage.cageId)}&qty=${qty}${feed ? `&feedType=${encodeURIComponent(feed.id || feed._id)}` : ''}`
  return (
    <>
      <div className="flex flex-col gap-[10px] rounded-[14px] border border-line bg-bg px-[18px] py-4">
        <div className="flex justify-between gap-3">
          <span className="text-[13px] leading-4 text-muted">{t('feedingPlan.paper.planPct', { pct: formatNumber(r.tablePct, { decimals: r.tablePct % 1 ? 1 : 0 }) })}</span>
          <span className="text-[13px] leading-4 tabular-nums text-[#C9CDD2] [html[data-theme=light]_&]:text-muted">{formatMass(planKg)}</span>
        </div>
        {cut !== 0 && (
          <div className="flex justify-between gap-3">
            <span className="text-[13px] leading-4 text-muted">
              {t('feedingPlan.paper.tempCut', { temp: r.tempC != null ? formatNumber(r.tempC, { decimals: 1 }) : '—' })}
            </span>
            <span className="text-[13px] leading-4 tabular-nums text-alert">{cut > 0 ? `− ${cut}%` : `+ ${-cut}%`}</span>
          </div>
        )}
        <div className="flex items-end justify-between gap-3 border-t border-line pt-[10px]">
          <span className="text-[14px] leading-[18px] text-text">{t('feedingPlan.paper.rationToday')}</span>
          <span className="text-[32px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-text">{formatMass(r.kgPerDay)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="pb-2 text-[15px] font-semibold leading-[18px] text-text">{t('feedingPlan.paper.meals', { count: r.feedingsPerDay })}</h3>
        {meals.map((i) => (
          <div key={i} className="flex items-center gap-3 border-t border-line py-3">
            <span className="w-[52px] shrink-0 whitespace-nowrap text-[14px] leading-[18px] text-text">{t('feedingPlan.paper.meal', { n: i + 1 })}</span>
            <span aria-hidden className="h-[6px] grow basis-0 rounded-pill bg-line" />
            <span className="w-[56px] shrink-0 text-right text-[14px] leading-[18px] tabular-nums text-text">{formatMass(r.kgPerFeeding)}</span>
          </div>
        ))}
      </div>
      {canIssue && (
        <div className="flex flex-col gap-[10px]">
          {feed && bag > 0 && (
            <div className="flex justify-between gap-3">
              <span className="truncate text-[13px] leading-4 text-muted">{t('feedingPlan.paper.fromStore', { feed: feed.name })}</span>
              <span className="shrink-0 text-[13px] leading-4 tabular-nums text-[#C9CDD2] [html[data-theme=light]_&]:text-muted">
                {t('feedingPlan.paper.bagCount', { count: formatNumber(r.kgPerDay / bag, { decimals: 1 }) })}
              </span>
            </div>
          )}
          <Link
            href={issueHref}
            className="group flex rounded-pill p-[1.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            style={{ backgroundImage: 'var(--gradient-sky)' }}
          >
            <span className="flex h-[46px] grow items-center justify-center gap-[10px] rounded-pill bg-button text-[15px] font-medium leading-[18px] text-button-text transition-opacity group-hover:opacity-90">
              <ArrowRight size={16} strokeWidth={2} aria-hidden className="shrink-0" />
              {t('feedingPlan.paper.issueTo', { amount: formatMass(qty), cage: cage.cageName })}
            </span>
          </Link>
          <p className="text-center text-xs leading-4 text-faint">{t('feedingPlan.paper.issueNote')}</p>
        </div>
      )}
    </>
  )
}

/** Every unit's ration (not on Paper 67, which shows one unit): kept for farms with many units. */
function AllRations({ rations, plans }) {
  const t = useT()
  return (
    <Table
      title={t('feedingPlan.todayTitle')}
      actions={
        rations ? (
          <span className="text-[13px] leading-4 text-muted">
            {t('feedingPlan.totalLine', { kg: kg(rations.totalKgPerDay), planned: rations.planned, total: rations.rows.length })}
          </span>
        ) : null
      }
      columns={[
        { key: 'unit', header: t('feedingPlan.col.unit'), render: (r) => r.cageName },
        {
          key: 'species',
          header: t('feedingPlan.col.species'),
          render: (r) => (r.speciesKey ? speciesLabel({ speciesKey: r.speciesKey, speciesName: plans?.find((p) => p.speciesKey === r.speciesKey)?.speciesName }) : '—'),
        },
        { key: 'fish', header: t('feedingPlan.col.fish'), align: 'right', render: (r) => formatNumber(r.count) },
        { key: 'abw', header: t('feedingPlan.col.abw'), align: 'right', render: (r) => (r.abwG != null ? `${kg(r.abwG)} g` : '—') },
        { key: 'pct', header: t('feedingPlan.col.bodyWeightPct'), align: 'right', render: (r) => (r.ration.ok ? `${r.ration.bodyWeightPct}%` : '—') },
        { key: 'kg', header: t('feedingPlan.col.kgPerDay'), align: 'right', render: (r) => (r.ration.ok ? kg(r.ration.kgPerDay) : '—') },
        { key: 'how', header: t('feedingPlan.col.how'), render: (r) => <span className="text-muted">{rationText(t, r.ration)}</span> },
      ]}
      rows={rations?.rows ?? []}
      rowKey={(r) => r.cageId}
      empty={rations === undefined ? t('common.loading') : t('feedingPlan.noUnits')}
    />
  )
}

const emptyBand = (minAbwG) => ({ minAbwG, bodyWeightPct: 3, feedingsPerDay: 2, pelletMm: 2 })

function FeedTables({ plans }) {
  const t = useT()
  const { showToast } = useToast()
  const canEdit = usePermission('org.settings.manage')
  const save = useMutation(api.feedingPlans.save)
  const reset = useMutation(api.feedingPlans.reset)
  const [speciesKey, setSpeciesKey] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)

  const current = useMemo(() => plans?.find((p) => p.speciesKey === speciesKey) ?? plans?.[0], [plans, speciesKey])
  useEffect(() => {
    if (current) setDraft({ name: current.name ?? speciesLabel(current), bands: current.bands ?? [emptyBand(0)] })
  }, [current])

  const problems = useMemo(() => (draft ? bandProblems(draft.bands.map(numeric)) : []), [draft])

  if (plans === undefined) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (!current || !draft) return null

  const setBand = (i, key, value) =>
    setDraft((d) => ({ ...d, bands: d.bands.map((b, k) => (k === i ? { ...b, [key]: value } : b)) }))
  const run = async (fn, done) => {
    setBusy(true)
    try {
      await fn()
      showToast('success', done)
    } catch (err) {
      showToast('error', errorMessage(err, t('feedingPlan.saveFailed')))
    } finally {
      setBusy(false)
    }
  }
  const sourceText = t(`feedingPlan.source.${current.source}`)

  return (
    <Card className="space-y-4">
      <CardHeader title={t('feedingPlan.tablesTitle')} subtitle={t('feedingPlan.tablesIntro')} />
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('feedingPlan.col.species')} htmlFor="fp-species" className="min-w-56">
          <Select id="fp-species" value={current.speciesKey} onChange={(e) => setSpeciesKey(e.target.value)}>
            {plans.map((p) => (
              <option key={p.speciesKey} value={p.speciesKey}>
                {speciesLabel(p)}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-sm text-muted pb-2">{sourceText}</p>
      </div>
      {canEdit && (
        <Field label={t('feedingPlan.planName')} htmlFor="fp-name">
          <Input
            id="fp-name"
            value={draft.name}
            maxLength={RATION_LIMITS.nameLength}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </Field>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 pr-3 font-semibold">{t('feedingPlan.col.fromAbw')}</th>
              <th className="py-2 pr-3 font-semibold">{t('feedingPlan.col.bodyWeightPct')}</th>
              <th className="py-2 pr-3 font-semibold">{t('feedingPlan.col.feedings')}</th>
              <th className="py-2 pr-3 font-semibold">{t('feedingPlan.col.pellet')}</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {draft.bands.map((b, i) => (
              <tr key={i} className="border-t border-foam-deep">
                {['minAbwG', 'bodyWeightPct', 'feedingsPerDay', 'pelletMm'].map((key) => (
                  <td key={key} className="py-2 pr-3">
                    {canEdit ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        aria-label={t(`feedingPlan.col.${COL[key]}`)}
                        className="w-28 tabular-nums"
                        value={b[key]}
                        disabled={key === 'minAbwG' && i === 0}
                        onChange={(e) => setBand(i, key, e.target.value)}
                      />
                    ) : (
                      <span className="tabular-nums">{b[key]}</span>
                    )}
                  </td>
                ))}
                {canEdit && (
                  <td className="py-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('feedingPlan.removeBand')}
                      disabled={draft.bands.length === 1}
                      onClick={() => setDraft((d) => ({ ...d, bands: d.bands.filter((_, k) => k !== i) }))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && problems.length > 0 && (
        <div role="alert" className="text-sm text-signal border border-signal/20 bg-signal/10 rounded-xl p-3 space-y-1">
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={draft.bands.length >= RATION_LIMITS.bandsPerTable}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                bands: [...d.bands, emptyBand((Number(d.bands[d.bands.length - 1]?.minAbwG) || 0) * 2 || 10)],
              }))
            }
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t('feedingPlan.addBand')}
          </Button>
          <Button
            disabled={busy || problems.length > 0}
            onClick={() =>
              run(
                () => save({ speciesKey: current.speciesKey, name: draft.name, bands: draft.bands.map(numeric) }),
                t('feedingPlan.saved'),
              )
            }
          >
            <Save className="h-4 w-4" aria-hidden />
            {t('feedingPlan.save')}
          </Button>
          {current.source === 'saved' && (
            <Button variant="ghost" disabled={busy} onClick={() => run(() => reset({ speciesKey: current.speciesKey }), t('feedingPlan.resetDone'))}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              {current.hasDefault ? t('feedingPlan.resetToDefault') : t('feedingPlan.remove')}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

const COL = { minAbwG: 'fromAbw', bodyWeightPct: 'bodyWeightPct', feedingsPerDay: 'feedings', pelletMm: 'pellet' }

function numeric(b) {
  return {
    minAbwG: Number(b.minAbwG) || 0,
    bodyWeightPct: Number(b.bodyWeightPct) || 0,
    feedingsPerDay: Number(b.feedingsPerDay) || 0,
    pelletMm: Number(b.pelletMm) || 0,
  }
}
