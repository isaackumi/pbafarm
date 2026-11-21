import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { KpiStrip, Pill, Segmented, StatusDot, Table } from '../ui'
import { ArrowRightIcon, MoreIcon, TrendUpIcon } from '../../lib/navIcons'
import { useT, useLocale } from '../../lib/i18n/context'
import { addDays, getActiveCurrency, unitLabel } from '../../lib/format'
import { speciesLabel } from '../../lib/fishSpecies'

/**
 * Home (Paper 01 / L · 01): the standing-biomass card, "Needs attention", the
 * KPI strip and "Farm activity", on convex/home.ts. Values are rendered in the
 * artboard's formats ("412.6 t", "+4.2% from last month", "1.42 −0.06",
 * "1,840 kg · 31 of 38 logged").
 */

const BiomassTrendChart = dynamic(
  () => import('../charts/DashboardCharts').then((m) => m.BiomassTrendChart),
  { ssr: false, loading: () => <div className="h-[130px] w-full rounded-lg bg-foam animate-pulse" /> },
)

const CARD = 'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'

/** "412.6 t" / "620 kg": tonnes from 1,000 kg. */
export function massParts(kg, locale) {
  const n = Number(kg) || 0
  if (n >= 1000) {
    return { value: (n / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), unit: 't' }
  }
  return { value: Math.round(n).toLocaleString(locale), unit: 'kg' }
}

/** Table biomass: "1.26 t" (two decimals) or "620 kg". */
export function tableMass(kg, locale) {
  if (kg == null) return '—'
  const n = Number(kg)
  return n >= 1000
    ? `${(n / 1000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`
    : `${Math.round(n).toLocaleString(locale)} kg`
}

/** "+0.4" / "−0.06": a signed change with a real minus sign; null when there is none. */
export function signed(delta, decimals) {
  if (delta == null || !Number.isFinite(delta)) return null
  const abs = Math.abs(delta).toFixed(decimals)
  if (Number(abs) === 0) return `±${abs}`
  return `${delta < 0 ? '−' : '+'}${abs}`
}

/** "GH₵ 9.8M" (compact money in the organization's currency). */
export function compactMoney(amount, locale, currency = getActiveCurrency()) {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString(locale)}`
  }
}

/** Seven dates evenly spaced from `from` to `to` (Paper 01 chart labels). */
export function axisDates(from, to, count = 7) {
  const start = Date.parse(`${from}T12:00:00Z`)
  const end = Date.parse(`${to}T12:00:00Z`)
  const days = Math.max(0, Math.round((end - start) / 86_400_000))
  return Array.from({ length: count }, (_, i) => addDays(from, Math.round((days * i) / (count - 1))))
}

const shortDate = (iso, locale) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })

// ---------------------------------------------------------------------------
// Standing biomass
// ---------------------------------------------------------------------------

export function BiomassCard({ data, range, onRange, className = '' }) {
  const t = useT()
  const { locale } = useLocale()
  const mass = massParts(data?.biomassKg ?? 0, locale)
  const change = data?.changePct
  const series = useMemo(() => data?.series ?? [], [data])
  const from = series[0]?.date
  const to = series[series.length - 1]?.date
  const labels = from && to ? axisDates(from, to) : []
  const points = useMemo(
    () => series.map((p) => ({ ts: Date.parse(`${p.date}T12:00:00Z`), kg: p.kg, label: shortDate(p.date, locale) })),
    [series, locale],
  )
  return (
    <section
      aria-labelledby="home-biomass-title"
      className={`flex min-h-[340px] flex-col gap-1 px-5 pb-[22px] pt-[26px] sm:px-7 ${CARD} ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-biomass-title" className="text-[13px] font-normal leading-4 text-muted">
          {t('home.biomass.title')}
        </h2>
        <Segmented
          label={t('home.biomass.range')}
          value={range}
          onChange={onRange}
          options={[
            { value: '30d', label: '30d' },
            { value: '90d', label: '90d' },
            { value: 'cycle', label: t('home.biomass.cycle') },
          ]}
        />
      </div>
      <p className="text-[40px] font-semibold leading-[48px] tracking-[-0.035em] text-text tabular-nums sm:text-[48px] sm:leading-[56px]">
        {mass.value}
        <span className="text-[24px] font-medium tracking-[-0.035em] text-muted"> {mass.unit}</span>
      </p>
      {(change != null || data?.estValue != null) && (
        <p className="flex flex-wrap items-center gap-[6px] text-[13px] leading-4">
          {change != null && (
            <>
              <TrendUpIcon
                size={14}
                strokeWidth={2}
                aria-hidden
                className={`shrink-0 ${change < 0 ? '-scale-y-100 text-alert' : 'text-good'}`}
              />
              <span className={change < 0 ? 'text-alert' : 'text-good'}>
                {t('home.biomass.change', { pct: signed(change, 1) })}
              </span>
            </>
          )}
          {data?.estValue != null && (
            <span className="text-faint">
              {change != null ? '· ' : ''}
              {t('home.biomass.estValue', { value: compactMoney(data.estValue, locale) })}
            </span>
          )}
        </p>
      )}
      <div className="flex grow basis-0 flex-col gap-2 pt-[14px]">
        {points.length > 1 ? (
          <div className="h-[130px] shrink-0">
            <BiomassTrendChart points={points} name={t('home.biomass.series')} />
          </div>
        ) : (
          <p className="flex h-[130px] shrink-0 items-center text-[13px] leading-4 text-muted">
            {t('home.biomass.empty')}
          </p>
        )}
        <div className="flex justify-between text-[12px] leading-4 text-faint" aria-hidden>
          {labels.map((d, i) => (
            <span key={`${d}-${i}`}>{shortDate(d, locale)}</span>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

const ACTION_HREF = {
  water: (id) => `/water-entry?unit=${id}`,
  density: (id) => `/fish-transfers?sourceCageId=${id}`,
  entry: (id) => `/daily-entry?cage=${id}`,
}

const num = (x, d = 1) => (x == null || x === '' ? '—' : Number(x).toLocaleString(undefined, { maximumFractionDigits: d }))

/** The muted line under a cage: the problem in the artboard's words. */
function attentionDetail(t, row) {
  const e = row.evidence || {}
  switch (row.reason) {
    case 'low_oxygen':
      return t('home.attention.reason.low_oxygen', { value: num(e.do_mg_l), min: num(e.min_mg_l) })
    case 'temperature_out_of_range':
      return t('home.attention.reason.temperature_out_of_range', { value: num(e.temp_c), min: num(e.min_c), max: num(e.max_c) })
    case 'missing_entries':
      return t('home.attention.reason.missing_entries', { count: Number(e.days_missing) || 0 })
    case 'mortality_spike':
      return t('home.attention.reason.mortality_spike', { count: Number(e.deaths) || 0, rate: num(e.rate_pct, 2) })
    case 'feed_drop':
      return t('home.attention.reason.feed_drop', { pct: num(e.drop_pct, 0) })
    case 'fcr_deterioration':
      return t('home.attention.reason.fcr_deterioration', { from: num(e.fcr_from, 2), to: num(e.fcr_to, 2), weeks: num(e.weeks, 0) })
    case 'growth_stall':
      return t('home.attention.reason.growth_stall', { sgr: num(e.sgr_pct, 2) })
    case 'density':
      return t(e.level === 'over' ? 'home.attention.reason.densityOver' : 'home.attention.reason.density', {
        value: num(e.density, 1),
        unit: e.unit || '',
        max: num(e.max, 1),
      })
    default:
      return ''
  }
}

function unitTitle(row) {
  const label = unitLabel(row.unitType)
  const name = row.unitName.toLowerCase().startsWith(label.toLowerCase()) ? row.unitName : `${label} ${row.unitName}`
  return row.species ? `${name} · ${speciesLabel(row.species)}` : name
}

export function AttentionCard({ data, className = '' }) {
  const t = useT()
  const rows = data?.rows ?? []
  return (
    <section aria-labelledby="home-attention-title" className={`flex flex-col gap-[14px] px-6 pb-5 pt-[26px] ${CARD} ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-attention-title" className="text-[15px] font-semibold leading-[18px] text-text">
          {t('home.attention.title')}{' '}
          <span className="font-normal text-muted">· {t('home.attention.count', { count: data?.total ?? 0 })}</span>
        </h2>
        <Link
          href="/units"
          className="inline-flex h-8 shrink-0 items-center gap-[6px] whitespace-nowrap rounded-pill border border-line-strong px-[14px] text-[13px] leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          {t('home.attention.viewBoard')}
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] leading-4 text-muted">{t('home.attention.none')}</p>
      ) : (
        rows.map((row) => (
          <div key={row.unitId} className="flex items-center gap-[14px] rounded-[14px] border border-line px-4 py-[14px]">
            <StatusDot tone={row.tone} size={8} />
            <div className="flex min-w-0 grow basis-0 flex-col gap-[3px]">
              <p className="truncate text-[14px] font-medium leading-[18px] text-text">{unitTitle(row)}</p>
              <p className="truncate text-[12px] leading-4 text-muted">{attentionDetail(t, row)}</p>
            </div>
            <Link
              href={ACTION_HREF[row.kind](row.unitId)}
              className="flex h-8 w-[132px] shrink-0 items-center justify-center gap-[6px] rounded-pill border border-line-strong text-[13px] leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              {t(`home.attention.action.${row.kind}`)}
              <ArrowRightIcon size={13} strokeWidth={2} aria-hidden className="shrink-0" />
            </Link>
          </div>
        ))
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

/** Lower FCR and lower mortality are better: a fall is green, a rise red. */
const deltaTone = (d) => (d == null || Math.abs(d) < 1e-9 ? 'muted' : d < 0 ? 'good' : 'alert')

export function homeKpiItems(t, data, locale) {
  const fcrDelta = signed(data?.fcrDelta, 2)
  const mortDelta = signed(data?.mortalityDelta, 1)
  return [
    {
      key: 'active',
      label: t('home.kpi.activeCages'),
      value: (data?.activeCages ?? 0).toLocaleString(locale),
      suffix: `/ ${(data?.totalCages ?? 0).toLocaleString(locale)}`,
      suffixTone: 'unit',
    },
    {
      key: 'fcr',
      label: t('home.kpi.fcr'),
      value: data?.fcr != null ? data.fcr.toFixed(2) : '—',
      suffix: fcrDelta ?? undefined,
      suffixTone: deltaTone(data?.fcrDelta),
    },
    {
      key: 'mortality',
      label: t('home.kpi.mortality'),
      value: data?.mortalityPct != null ? `${data.mortalityPct.toFixed(1)}%` : '—',
      suffix: mortDelta ?? undefined,
      suffixTone: deltaTone(data?.mortalityDelta),
    },
    {
      key: 'feed',
      label: t('home.kpi.feedToday'),
      value: Math.round(data?.feedTodayKg ?? 0).toLocaleString(locale),
      suffix: t('home.kpi.feedTodaySuffix', {
        logged: data?.loggedToday ?? 0,
        total: data?.activeCages ?? 0,
      }),
      suffixTone: 'unit',
    },
  ]
}

export function HomeKpis({ data }) {
  const t = useT()
  const { locale } = useLocale()
  return <KpiStrip items={homeKpiItems(t, data, locale)} className="py-1" />
}

// ---------------------------------------------------------------------------
// Farm activity
// ---------------------------------------------------------------------------

const TYPE_PILL = { transfer: 'pink', harvest: 'green', stocking: 'cyan', feed: 'neutral' }
const STATUS_TONE = {
  pending_approval: 'warn',
  in_progress: 'warn',
  approved: 'good',
  completed: 'good',
  rejected: 'alert',
  reversed: 'neutral',
}
const RECORD_PAGE = {
  stocking: '/stocking-management',
  transfer: '/fish-transfers',
  harvest: '/harvest',
  feed: '/feed-issue',
}

/** Row "⋯" menu: open the record's page; pending rows also go to approvals. */
function RowMenu({ row, canApprove }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const item = 'rounded-[10px] px-3 py-2 text-left text-sm text-text hover:bg-surface-2 focus:bg-surface-2 focus:outline-none'
  return (
    <div ref={ref} className="relative flex justify-end">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('home.activity.menu')}
        onClick={() => setOpen((o) => !o)}
        className="rounded text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      >
        <MoreIcon size={16} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-10 mt-2 flex w-56 flex-col rounded-input border border-line-strong bg-surface p-1 shadow-lg">
          <Link role="menuitem" href={RECORD_PAGE[row.type]} className={item} onClick={() => setOpen(false)}>
            {t(`home.activity.openRecord.${row.type}`)}
          </Link>
          {row.status === 'pending_approval' && canApprove && (
            <Link role="menuitem" href="/approvals" className={item} onClick={() => setOpen(false)}>
              {t('home.activity.review')}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

const ACTIVITY_TABS = ['all', 'stocking', 'transfer', 'harvest', 'feed']

export function ActivityCard({ locationId, canApprove }) {
  const t = useT()
  const { locale } = useLocale()
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const deferred = useDeferredValue(search.trim())
  const rows = useQuery(api.home.activity, {
    ...(locationId ? { locationId } : {}),
    ...(tab !== 'all' ? { type: tab } : {}),
    ...(deferred ? { search: deferred } : {}),
  })
  const columns = [
    {
      key: 'date',
      header: t('home.activity.date'),
      // Widths include the Table's 12px cell padding (24px at the edges), set so
      // each column's text sits where Paper 01 draws it (110/130/150/130/130/180/40).
      width: 122,
      render: (r) => <span className="text-muted tabular-nums">{shortDate(r.date, locale)}</span>,
    },
    {
      key: 'type',
      header: t('home.activity.type'),
      width: 130,
      render: (r) => <Pill tone={TYPE_PILL[r.type]}>{t(`home.activity.types.${r.type}`)}</Pill>,
    },
    { key: 'unit', header: t('home.activity.unit'), render: (r) => r.unit },
    {
      key: 'batch',
      header: t('home.activity.batch'),
      width: 174,
      render: (r) => <span className="block max-w-[150px] truncate text-muted" title={r.batch || undefined}>{r.batch || '—'}</span>,
    },
    {
      key: 'fish',
      header: t('home.activity.fish'),
      width: 130,
      align: 'right',
      render: (r) => (r.fish != null ? Number(r.fish).toLocaleString(locale) : '—'),
    },
    {
      key: 'biomass',
      header: t('home.activity.biomass'),
      width: 130,
      align: 'right',
      render: (r) => tableMass(r.biomassKg, locale),
    },
    {
      key: 'status',
      // Paper 01: status text 28px into its 180px column (12px cell padding + 4px + the 12px the menu cell gives back)
      header: <span className="pl-1">{t('home.activity.status')}</span>,
      width: 180,
      render: (r) => (
        <span className="inline-flex items-center gap-2 pl-1">
          <StatusDot tone={STATUS_TONE[r.status] || 'neutral'} />
          <span className="text-[13px] leading-4 text-muted">{t(`home.activity.statuses.${r.status}`)}</span>
        </span>
      ),
    },
    {
      key: 'menu',
      header: <span className="sr-only">{t('home.activity.menu')}</span>,
      width: 52,
      render: (r) => <RowMenu row={r} canApprove={canApprove} />,
    },
  ]
  return (
    <Table
      title={t('home.activity.title')}
      tabsLabel={t('home.activity.filter')}
      tabs={ACTIVITY_TABS.map((value) => ({ value, label: t(`home.activity.tabs.${value}`) }))}
      tab={tab}
      onTabChange={setTab}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder={t('home.activity.search')}
      columns={columns}
      rows={rows ?? []}
      rowKey={(r) => `${r.type}-${r.id}`}
      empty={rows === undefined ? t('home.activity.loading') : search ? t('home.activity.noMatch') : t('home.activity.emptyAll')}
    />
  )
}
