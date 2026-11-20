import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { Minus, PenLine, Plus, X } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Button, EmptyState, GradientButton, LoadingState, Pill } from '../../components/ui'
import UnitViewSwitch, { FilterSelect } from '../../components/units/UnitViewSwitch'
import { unitBiomassT, unitSignal } from '../../components/units/UnitCard'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import { fitProjection, scaleBar } from '../../lib/mapProjection'
import { formatDate, formatNumber, localToday, unitLabel } from '../../lib/format'
import { usePermissions } from '../../hooks/usePermission'
import { useT } from '../../lib/i18n/context'

const W = 1000
const H = 620

/**
 * Paper 49 cage circles per signal (GM6-0 dark, LHR-0 light): 2px ring and
 * a 10% fill (15% on alert); light uses its own greens/ambers and tints.
 * `ring` is the 6px halo of the selected cage, `dot` the legend dot, `sub`
 * the reading under the name.
 */
const TONE = {
  good: {
    circle:
      'border-2 border-solid border-good bg-[color-mix(in_oklab,var(--good)_10%,transparent)] [[data-theme=light]_&]:border-[#16A34A] [[data-theme=light]_&]:bg-[#F0FBF3]',
    ring: 'shadow-[0_0_0_6px_color-mix(in_oklab,var(--good)_12%,transparent)] [[data-theme=light]_&]:shadow-[0_0_0_6px_#16A34A1A]',
    dot: 'bg-good [[data-theme=light]_&]:bg-[#16A34A]',
    connector: 'bg-good [[data-theme=light]_&]:bg-[#16A34A]',
    sub: 'text-muted',
    pill: 'green',
  },
  warn: {
    circle:
      'border-2 border-solid border-warn bg-[color-mix(in_oklab,var(--warn)_10%,transparent)] [[data-theme=light]_&]:border-[#D97706] [[data-theme=light]_&]:bg-[#FFF7E8]',
    ring: 'shadow-[0_0_0_6px_color-mix(in_oklab,var(--warn)_12%,transparent)] [[data-theme=light]_&]:shadow-[0_0_0_6px_#D977061A]',
    dot: 'bg-warn [[data-theme=light]_&]:bg-[#D97706]',
    connector: 'bg-warn [[data-theme=light]_&]:bg-[#D97706]',
    sub: 'text-warn',
    pill: 'amber',
  },
  alert: {
    circle:
      'border-2 border-solid border-alert bg-[color-mix(in_oklab,var(--alert)_15%,transparent)] [[data-theme=light]_&]:bg-[#FEEEEE]',
    ring: 'shadow-[0_0_0_6px_color-mix(in_oklab,var(--alert)_12%,transparent)] [[data-theme=light]_&]:shadow-[0_0_0_6px_#DC26261A]',
    dot: 'bg-alert',
    connector: 'bg-alert',
    sub: 'text-alert',
    pill: 'red',
  },
  neutral: {
    circle: 'border-[1.5px] border-dashed border-faint [[data-theme=light]_&]:bg-[#FFFFFF99]',
    ring: 'shadow-[0_0_0_6px_var(--line-strong)]',
    dot: 'border-[1.5px] border-solid border-faint',
    connector: 'bg-faint',
    sub: 'text-faint',
    pill: 'neutral',
  },
}

/** Paper 49 light pill borders (LHR-0 "Low DO" #F3B8B8); dark keeps the pill tokens. */
const LIGHT_PILL_BORDER = {
  red: '[[data-theme=light]_&]:border-[#F3B8B8]',
}

const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8]

const osm = (p, zoom = 17) =>
  `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=${zoom}/${p.latitude}/${p.longitude}`

const pct = (v, max) => `${(v / max) * 100}%`

/** "6.2683° N, 0.0466° E" (Paper 49 map corner). */
const degrees = (lat, lng) =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`

/**
 * Farm map (Paper 49) without a map library: units with coordinates are
 * projected to scale (north up, scale bar) and coloured by their most
 * urgent signal (water breach, density, maintenance, DO). Sites, water
 * bodies and groups are labelled; OpenStreetMap links give satellite context.
 */
function SiteMap({ data }) {
  const t = useT()
  const { user } = useAuth()
  const { can } = usePermissions()
  const { locationArgs } = useLocation()
  const board = useQuery(api.units.board, user ? locationArgs : 'skip')
  const latest = useQuery(api.waterQuality.latestByUnit, user ? locationArgs : 'skip')
  const [selected, setSelected] = useState(null)
  const [group, setGroup] = useState('all')
  const [zoom, setZoom] = useState(0)
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
  const fitted = useMemo(() => fitProjection(all, { width: W, height: H, pad: 70 }), [all])
  const centre = useMemo(
    () =>
      all.length
        ? {
            latitude: all.reduce((s, p) => s + p.latitude, 0) / all.length,
            longitude: all.reduce((s, p) => s + p.longitude, 0) / all.length,
          }
        : null,
    [all],
  )

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

  const others = all.filter((p) => p.layer !== 'unit')
  const sel = selected && [...units, ...others].find((x) => `${x.layer}-${x._id}` === selected)

  // Zoom (Paper 49 +/− control) scales the fitted projection about the selected point, or the centre.
  const proj = useMemo(() => {
    if (!fitted) return null
    const k = ZOOMS[zoom]
    if (k === 1) return fitted
    const focus = sel ? fitted.project(sel) : { x: W / 2, y: H / 2 }
    return {
      mPerPx: fitted.mPerPx / k,
      project: (p) => {
        const { x, y } = fitted.project(p)
        return { x: W / 2 + (x - focus.x) * k, y: H / 2 + (y - focus.y) * k }
      },
    }
  }, [fitted, zoom, sel])

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

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-[10px]">
          {/* Paper 49: the switch track is ruled in line-strong with no fill. */}
          <UnitViewSwitch className="border-line-strong! bg-transparent!" />
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
              <li key={l.tone} className="flex items-center gap-2 text-[13px] leading-4 text-muted">
                <span aria-hidden className={`size-2 shrink-0 rounded-pill ${TONE[l.tone].dot}`} />
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
        <div className="relative h-[620px] w-full overflow-hidden rounded-card border border-line bg-[#0D1416] shadow-[var(--shadow-card)] [[data-theme=light]_&]:bg-[#E6F0FB]">
          <div className="absolute right-6 top-[22px] flex flex-col items-center text-xs leading-4 text-faint" aria-hidden>
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
                className="absolute -translate-y-1/2 rounded-sm text-xs uppercase leading-4 tracking-wide text-faint hover:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
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
                className={`absolute flex size-[72px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-px rounded-pill focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan sm:size-[80px] ${tone.circle} ${
                  selected === key ? tone.ring : ''
                }`}
                style={{ left: pct(x, W), top: pct(y, H) }}
              >
                <span className={`max-w-[64px] truncate text-[14px] font-semibold leading-[18px] ${idle ? 'text-muted' : 'text-text'}`}>
                  {u.code || u.name}
                </span>
                <span className={`max-w-[64px] truncate text-[11px] leading-[14px] ${tone.sub}`}>
                  {wqByUnit.get(u._id)?.values?.dissolvedOxygen != null
                    ? t('mapUi.doShort', { value: wqByUnit.get(u._id).values.dissolvedOxygen })
                    : t.or(`unitsUi.status.${u.status}`, u.statusLabel)}
                </span>
              </button>
            )
          })}

          {sel && (
            <Popover
              p={sel}
              proj={proj}
              wq={wqByUnit.get(sel._id)}
              today={today}
              onClose={() => setSelected(null)}
              canLogWater={can('production.daily.record')}
            />
          )}

          {/* Paper 49 zoom control (H7U-0): 36px cells, 14px radius, line-strong rules. */}
          <div className="absolute bottom-[22px] left-6 flex flex-col rounded-[14px] border border-line-strong bg-surface">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
              disabled={zoom === ZOOMS.length - 1}
              aria-label={t('mapUi.zoomIn')}
              className="flex size-9 items-center justify-center border-b border-line-strong text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-40"
            >
              <Plus size={14} strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0, z - 1))}
              disabled={zoom === 0}
              aria-label={t('mapUi.zoomOut')}
              className="flex size-9 items-center justify-center text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-40"
            >
              <Minus size={14} strokeWidth={2} aria-hidden />
            </button>
          </div>

          <div className="absolute bottom-[22px] right-6 flex flex-col items-end gap-2">
            {(() => {
              const s = scaleBar(proj.mPerPx, 120)
              return (
                <div className="flex flex-col items-center gap-1 text-[11px] leading-[14px] text-faint" aria-hidden>
                  <span>{s.label}</span>
                  <span
                    className="h-2 border-x-[1.5px] border-b-[1.5px] border-faint"
                    style={{ width: `${s.px}px` }}
                  />
                </div>
              )
            })()}
            {centre && (
              <span className="font-geist text-xs leading-4 text-faint tabular-nums">{degrees(centre.latitude, centre.longitude)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Popover({ p, proj, wq, today, onClose, canLogWater }) {
  const t = useT()
  const { x, y } = proj.project(p)
  const tone = p.layer === 'unit' ? TONE[p.signal.tone] || TONE.neutral : null
  // Paper 49: the card sits 28px off the cage edge, joined by a 22×2 connector in the signal colour.
  const flip = x > W - 330
  const left = flip ? `calc(${pct(x, W)} - 308px)` : `calc(${pct(x, W)} + 68px)`
  const top = `clamp(16px, calc(${pct(y, H)} - 106px), calc(100% - 300px))`
  const biomass = p.layer === 'unit' ? unitBiomassT(p) : null
  const doValue = wq?.values?.dissolvedOxygen
  const overdue = p.layer === 'unit' && p.nextMaintenanceDate && p.nextMaintenanceDate < today
  const rows =
    p.layer === 'unit'
      ? [
          {
            k: t('mapUi.do'),
            v: doValue != null ? `${doValue} mg/L` : '—',
            cls: p.signal.tone === 'warn' || p.signal.tone === 'alert' ? `font-medium ${tone.sub}` : 'text-text',
          },
          { k: t('mapUi.biomass'), v: biomass != null ? `${formatNumber(Math.round(biomass * 1000))} kg` : '—' },
          { k: t('mapUi.abw'), v: p.abwG ? `${Math.round(p.abwG)} g` : '—' },
          { k: t('mapUi.fish'), v: formatNumber(p.fish || 0) },
          ...(p.nextMaintenanceDate
            ? [
                {
                  k: t('mapUi.maintenance'),
                  v: overdue ? t('mapUi.checkOverdue') : formatDate(p.nextMaintenanceDate),
                  cls: overdue ? 'text-warn' : 'text-text',
                },
              ]
            : []),
        ]
      : p.layer === 'group'
        ? [
            { k: t('mapUi.units'), v: String(p.unitCount) },
            { k: t('mapUi.stocked'), v: String(p.stocked) },
            ...(p.unplaced ? [{ k: t('mapUi.unplaced'), v: String(p.unplaced) }] : []),
          ]
        : []
  const label = p.layer === 'unit' ? unitLabel(p.unitType) : ''
  const title = label && !p.name.toLowerCase().startsWith(label.toLowerCase()) ? `${label} ${p.name}` : p.name
  return (
    <>
      {tone && (
        <span
          aria-hidden
          className={`absolute h-[2px] w-[22px] ${tone.connector}`}
          style={{ left: flip ? `calc(${pct(x, W)} - 68px)` : `calc(${pct(x, W)} + 46px)`, top: `calc(${pct(y, H)} - 1px)` }}
        />
      )}
      <div
        role="dialog"
        aria-label={title}
        className="absolute z-10 flex w-[240px] flex-col gap-[14px] rounded-card border border-line-strong bg-surface-2 px-5 py-[18px] shadow-[0_20px_40px_#00000066] [[data-theme=light]_&]:bg-white [[data-theme=light]_&]:shadow-[0_8px_24px_#1018281F,0_1px_2px_#1018281A]"
        style={{ left, top }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-[17px] font-semibold leading-[22px] text-text">{title}</span>
            {p.layer !== 'unit' && (
              <span className="text-xs leading-4 text-muted">
                {p.layer === 'group' && t('mapUi.group')}
                {p.layer === 'site' && t('mapUi.site')}
                {p.layer === 'water' && t('mapUi.waterBody')}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {p.layer === 'unit' && (
              <Pill tone={tone.pill} size="sm" className={`py-[3px]! ${LIGHT_PILL_BORDER[tone.pill] || ''}`}>
                {p.signal.text}
              </Pill>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('mapUi.close')}
              className="rounded-pill p-1 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              <X className="h-[14px] w-[14px]" aria-hidden />
            </button>
          </div>
        </div>
        {rows.length > 0 && (
          <dl className="flex flex-col gap-2 text-[13px] leading-4">
            {rows.map((r) => (
              <div key={r.k} className="flex justify-between gap-2">
                <dt className="text-muted">{r.k}</dt>
                <dd className={`tabular-nums ${r.cls || 'text-text'}`}>{r.v}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="font-geist text-[11px] leading-[14px] text-faint tabular-nums">
          {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
        </p>
        <div className="flex gap-2">
          {p.layer === 'unit' && (
            <Link
              href={`/cages/${p._id}`}
              className="whitespace-nowrap rounded-pill bg-button px-4 py-[9px] text-[13px] font-medium leading-4 text-button-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              {t('mapUi.openCage')}
            </Link>
          )}
          {p.layer === 'group' && (
            <Link
              href={`/units?group=${p._id}`}
              className="whitespace-nowrap rounded-pill bg-button px-4 py-[9px] text-[13px] font-medium leading-4 text-button-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              {t('mapUi.openGroup')}
            </Link>
          )}
          {p.layer === 'unit' && canLogWater ? (
            <Link
              href={`/water-entry?unit=${p._id}`}
              className="whitespace-nowrap rounded-pill border border-line-strong px-4 py-[9px] text-[13px] leading-4 text-text hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              {t('mapUi.logWater')}
            </Link>
          ) : (
            <a
              href={osm(p)}
              target="_blank"
              rel="noreferrer"
              className="whitespace-nowrap rounded-pill border border-line-strong px-4 py-[9px] text-[13px] leading-4 text-text hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              {t('mapUi.osm')}
            </a>
          )}
        </div>
      </div>
    </>
  )
}

/** Paper 49 eyebrow: "Cages · Akosombo site · 12 units on Volta Lake" (site and lake when there is one of each). */
function mapEyebrow(data, t) {
  const count = data.units.length
  const parts = [t('mapUi.crumb')]
  if (data.sites.length === 1) parts.push(data.sites[0].name)
  parts.push(
    data.waterBodies.length === 1
      ? t('mapUi.unitsOn', { count, water: data.waterBodies[0].name })
      : t('mapUi.unitCount', { count }),
  )
  return parts.join(' · ')
}

function SiteMapPage() {
  const t = useT()
  const { user } = useAuth()
  const { can } = usePermissions()
  const { locationArgs } = useLocation()
  const data = useQuery(api.units.mapPoints, user ? locationArgs : 'skip')
  const manage = can('production.units.manage')
  return (
    <Layout
      title={t('mapUi.title')}
      eyebrow={data ? mapEyebrow(data, t) : undefined}
      actions={
        manage ? (
          <>
            <GradientButton href="/create-cage" variant="lime" icon={Plus}>
              {t('mapUi.addCage')}
            </GradientButton>
            <GradientButton
              href="/cages/settings"
              ring="sky"
              icon={PenLine}
              // Paper 49 light (LHR-0) ends the sky ring at #7DB6F2; dark keeps --gradient-sky.
              style={{}}
              className="bg-[image:var(--gradient-sky)] [[data-theme=light]_&]:bg-[image:linear-gradient(in_oklab_120deg,#1562D6_0%,#7DB6F2_100%)]"
            >
              {t('mapUi.editLayout')}
            </GradientButton>
          </>
        ) : null
      }
    >
      {data === undefined ? <LoadingState label={t('mapUi.loading')} /> : <SiteMap data={data} />}
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
