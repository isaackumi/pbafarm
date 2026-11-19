import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { X } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Button, EmptyState, LoadingState, Pill } from '../../components/ui'
import UnitViewSwitch, { FilterSelect } from '../../components/units/UnitViewSwitch'
import { UnitsHeaderActions } from '../../components/units/UnitsHeader'
import { unitBiomassT, unitSignal } from '../../components/units/UnitCard'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import { fitProjection, scaleBar } from '../../lib/mapProjection'
import { localToday, unitLabel } from '../../lib/format'
import { usePermissions } from '../../hooks/usePermission'
import { useT } from '../../lib/i18n/context'

const W = 1000
const H = 620

const TONE = {
  good: { border: 'var(--good)', fill: 'color-mix(in oklab, var(--good) 10%, transparent)', pill: 'green' },
  warn: { border: 'var(--warn)', fill: 'color-mix(in oklab, var(--warn) 10%, transparent)', pill: 'amber' },
  alert: { border: 'var(--alert)', fill: 'color-mix(in oklab, var(--alert) 12%, transparent)', pill: 'red' },
  neutral: { border: 'var(--faint)', fill: 'transparent', pill: 'neutral' },
}

const osm = (p, zoom = 17) =>
  `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=${zoom}/${p.latitude}/${p.longitude}`

const pct = (v, max) => `${(v / max) * 100}%`

/**
 * Farm map (Paper 49) without a map library: units with coordinates are
 * projected to scale (north up, scale bar) and coloured by their most
 * urgent signal (water breach, density, maintenance, DO). Sites, water
 * bodies and groups are labelled; OpenStreetMap links give satellite context.
 */
function SiteMap() {
  const t = useT()
  const { user } = useAuth()
  const { can } = usePermissions()
  const { locationArgs } = useLocation()
  const data = useQuery(api.units.mapPoints, user ? locationArgs : 'skip')
  const board = useQuery(api.units.board, user ? locationArgs : 'skip')
  const latest = useQuery(api.waterQuality.latestByUnit, user ? locationArgs : 'skip')
  const [selected, setSelected] = useState(null)
  const [group, setGroup] = useState('all')
  const today = localToday()

  const boardById = useMemo(
    () => new Map((board?.sections || []).flatMap((s) => s.units.map((u) => [u._id, { ...u, groupId: s.groupId }]))),
    [board],
  )
  const wqByUnit = useMemo(() => new Map((latest || []).map((r) => [r.unitId, r])), [latest])

  const all = useMemo(
    () =>
      data
        ? [
            ...data.sites.map((p) => ({ ...p, layer: 'site' })),
            ...data.waterBodies.map((p) => ({ ...p, layer: 'water' })),
            ...data.groups.map((p) => ({ ...p, layer: 'group' })),
            ...data.units.map((p) => ({ ...p, layer: 'unit' })),
          ]
        : [],
    [data],
  )
  const proj = useMemo(() => fitProjection(all, { width: W, height: H, pad: 70 }), [all])

  const units = useMemo(
    () =>
      all
        .filter((p) => p.layer === 'unit')
        .map((p) => {
          const b = boardById.get(p._id)
          const merged = { ...p, ...(b || {}) }
          return { ...merged, signal: unitSignal(merged, wqByUnit.get(p._id), today, t) }
        })
        .filter((u) => group === 'all' || u.groupId === group),
    [all, boardById, wqByUnit, today, t, group],
  )

  const counts = useMemo(() => {
    const c = { good: 0, warn: 0, alert: 0, neutral: 0 }
    for (const u of units) c[u.signal.tone] = (c[u.signal.tone] || 0) + 1
    return c
  }, [units])

  const legend = [
    { tone: 'good', label: t('mapUi.legend.inRange') },
    { tone: 'warn', label: t('mapUi.legend.watch') },
    { tone: 'alert', label: t('mapUi.legend.alert') },
    { tone: 'neutral', label: t('mapUi.legend.idle') },
  ]

  const others = all.filter((p) => p.layer !== 'unit')
  const sel = selected && [...units, ...others].find((x) => `${x.layer}-${x._id}` === selected)

  if (data === undefined) return <LoadingState label={t('mapUi.loading')} />

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-[10px]">
          <UnitViewSwitch />
          {board?.sections?.length > 1 && (
            <FilterSelect label={t('unitsUi.filterGroup')} value={group} onChange={setGroup}>
              <option value="all">{t('unitsUi.allGroups')}</option>
              {board.sections
                .filter((s) => s.groupId)
                .map((s) => (
                  <option key={s.groupId} value={s.groupId}>
                    {s.name}
                  </option>
                ))}
            </FilterSelect>
          )}
        </div>
        {proj && (
          <ul className="flex flex-wrap items-center gap-[18px]" aria-label={t('mapUi.legendLabel')}>
            {legend.map((l) => (
              <li key={l.tone} className="flex items-center gap-2 text-sm text-muted">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-pill"
                  style={
                    l.tone === 'neutral'
                      ? { border: '1.5px solid var(--faint)' }
                      : { background: TONE[l.tone].border }
                  }
                />
                {l.label} · {counts[l.tone] || 0}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!proj ? (
        <EmptyState
          title={t('mapUi.emptyTitle')}
          description={t('mapUi.emptyBody')}
          action={<Button href="/units/groups">{t('groupsUi.title')}</Button>}
        />
      ) : (
        <div className="relative h-[620px] w-full overflow-hidden rounded-card border border-line bg-bg">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
            {(() => {
              const s = scaleBar(proj.mPerPx, 120)
              return (
                <g transform={`translate(24, ${H - 24})`} stroke="var(--faint)" strokeWidth="1.5">
                  <line x1="0" x2={s.px} y1="0" y2="0" />
                  <line x1="0" x2="0" y1="-4" y2="4" />
                  <line x1={s.px} x2={s.px} y1="-4" y2="4" />
                  <text x={s.px / 2} y="-8" textAnchor="middle" fontSize="11" fill="var(--faint)" stroke="none">
                    {s.label}
                  </text>
                </g>
              )
            })()}
          </svg>
          <div className="absolute right-6 top-[22px] flex flex-col items-center text-xs text-faint" aria-hidden>
            <span>▲</span>
            <span>N</span>
          </div>

          {others.map((p) => {
            const { x, y } = proj.project(p)
            const key = `${p.layer}-${p._id}`
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(selected === key ? null : key)}
                className="absolute -translate-y-1/2 rounded-sm text-xs uppercase tracking-wide text-faint hover:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                style={{ left: pct(x, W), top: pct(y, H) }}
              >
                {p.layer === 'group' ? `${p.name} · ${p.unitCount}` : p.name}
              </button>
            )
          })}

          {units.map((u) => {
            const { x, y } = proj.project(u)
            const key = `unit-${u._id}`
            const tone = TONE[u.signal.tone] || TONE.neutral
            const idle = u.signal.tone === 'neutral'
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(selected === key ? null : key)}
                aria-label={`${u.name}, ${u.signal.text}`}
                aria-pressed={selected === key}
                className="absolute flex size-[72px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-px rounded-pill focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan sm:size-[80px]"
                style={{
                  left: pct(x, W),
                  top: pct(y, H),
                  border: `${idle ? '1.5px dashed' : '2px solid'} ${tone.border}`,
                  background: tone.fill,
                  boxShadow: selected === key ? '0 0 0 4px var(--line-strong)' : undefined,
                }}
              >
                <span className="max-w-[64px] truncate text-[14px] font-semibold text-text">{u.code || u.name}</span>
                <span
                  className="max-w-[64px] truncate text-[11px]"
                  style={{ color: u.signal.tone === 'warn' || u.signal.tone === 'alert' ? tone.border : 'var(--muted)' }}
                >
                  {wqByUnit.get(u._id)?.values?.dissolvedOxygen != null
                    ? t('mapUi.doShort', { value: wqByUnit.get(u._id).values.dissolvedOxygen })
                    : t.or(`unitsUi.status.${u.status}`, u.statusLabel)}
                </span>
              </button>
            )
          })}

          {sel && <Popover p={sel} proj={proj} wq={wqByUnit.get(sel._id)} onClose={() => setSelected(null)} canLogWater={can('production.daily.record')} />}
        </div>
      )}
    </div>
  )
}

function Popover({ p, proj, wq, onClose, canLogWater }) {
  const t = useT()
  const { x, y } = proj.project(p)
  const left = x > W - 300 ? `calc(${pct(x, W)} - 290px)` : `calc(${pct(x, W)} + 50px)`
  const top = `clamp(16px, calc(${pct(y, H)} - 60px), calc(100% - 260px))`
  const biomass = p.layer === 'unit' ? unitBiomassT(p) : null
  const rows =
    p.layer === 'unit'
      ? [
          [t('mapUi.do'), wq?.values?.dissolvedOxygen != null ? `${wq.values.dissolvedOxygen} mg/L` : '—'],
          [t('mapUi.biomass'), biomass != null ? `${biomass.toFixed(biomass < 10 ? 2 : 1)} t` : '—'],
          [t('mapUi.abw'), p.abwG ? `${Math.round(p.abwG)} g` : '—'],
          [t('mapUi.fish'), (p.fish || 0).toLocaleString()],
        ]
      : p.layer === 'group'
        ? [
            [t('mapUi.units'), String(p.unitCount)],
            [t('mapUi.stocked'), String(p.stocked)],
            ...(p.unplaced ? [[t('mapUi.unplaced'), String(p.unplaced)]] : []),
          ]
        : []
  return (
    <div
      role="dialog"
      aria-label={p.name}
      className="absolute z-10 flex w-[240px] flex-col gap-3 rounded-[16px] border border-line-strong bg-surface-2 p-[18px] shadow-[var(--shadow-card)]"
      style={{ left, top }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-[17px] font-semibold leading-[22px] text-text">{p.name}</span>
          <span className="text-xs text-muted">
            {p.layer === 'unit' && unitLabel(p.unitType)}
            {p.layer === 'group' && t('mapUi.group')}
            {p.layer === 'site' && t('mapUi.site')}
            {p.layer === 'water' && t('mapUi.waterBody')}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('mapUi.close')}
          className="rounded-pill p-1 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {p.layer === 'unit' && (
        <Pill tone={TONE[p.signal.tone]?.pill || 'neutral'} className="self-start">
          {p.signal.text}
        </Pill>
      )}
      {rows.length > 0 && (
        <dl className="flex flex-col gap-[6px] text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-muted">{k}</dt>
              <dd className="tabular-nums text-text">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="font-mono text-[11px] text-faint tabular-nums">
        {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
      </p>
      <div className="flex gap-2">
        {p.layer === 'unit' && (
          <Link
            href={`/cages/${p._id}`}
            className="flex-1 rounded-pill bg-button px-3 py-2 text-center text-[13px] font-medium text-button-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
          >
            {t('mapUi.openCage')}
          </Link>
        )}
        {p.layer === 'group' && (
          <Link
            href={`/units?group=${p._id}`}
            className="flex-1 rounded-pill bg-button px-3 py-2 text-center text-[13px] font-medium text-button-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
          >
            {t('mapUi.openGroup')}
          </Link>
        )}
        {p.layer === 'unit' && canLogWater ? (
          <Link
            href={`/water-entry?unit=${p._id}`}
            className="flex-1 rounded-pill border border-line-strong px-3 py-2 text-center text-[13px] text-text hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
          >
            {t('mapUi.logWater')}
          </Link>
        ) : (
          <a
            href={osm(p)}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-pill border border-line-strong px-3 py-2 text-center text-[13px] text-text hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
          >
            {t('mapUi.osm')}
          </a>
        )}
      </div>
    </div>
  )
}

function SiteMapPage() {
  const t = useT()
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const data = useQuery(api.units.mapPoints, user ? locationArgs : 'skip')
  return (
    <Layout
      title={t('mapUi.title')}
      eyebrow={data ? t('mapUi.eyebrow', { count: data.units.length }) : undefined}
      actions={<UnitsHeaderActions />}
    >
      <SiteMap />
    </Layout>
  )
}

export default function SiteMapRoute() {
  return (
    <ProtectedRoute>
      <SiteMapPage />
    </ProtectedRoute>
  )
}
