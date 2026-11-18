import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Button, Card, EmptyState, PageHeader } from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import { fitProjection, scaleBar } from '../../lib/mapProjection'
import { unitLabel } from '../../lib/format'

const W = 800
const H = 520

/** Marker fill per unit status; uses CSS variables so dark mode follows. */
const STATUS_FILL = {
  active: 'var(--color-kelp, #15803d)',
  harvesting: 'var(--color-lake, #0e7490)',
  maintenance: '#d97706',
}

const osm = (p, zoom = 17) =>
  `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=${zoom}/${p.latitude}/${p.longitude}`

/**
 * Site map without a map library: sites, water bodies, groups and units
 * with coordinates, projected to scale on an SVG (north up, scale bar).
 * Each marker links to its page; OpenStreetMap links give the satellite
 * context when needed.
 */
function SiteMap() {
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const data = useQuery(api.units.mapPoints, user ? locationArgs : 'skip')
  const [selected, setSelected] = useState(null)

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
  const proj = useMemo(() => fitProjection(all, { width: W, height: H, pad: 40 }), [all])

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Site map"
        breadcrumbs={[{ label: 'Units', href: '/units' }, { label: 'Site map' }]}
        description="Sites, water bodies, groups and units placed by their coordinates. Add latitude and longitude on a unit, group or site to place it."
        related={[{ label: 'Unit board', href: '/units' }, { label: 'Groups', href: '/units/groups' }]}
      />
      {data === undefined ? (
        <p className="text-sm text-muted">Loading map…</p>
      ) : !proj ? (
        <EmptyState
          title="Nothing to place yet"
          description="Give your units, groups or sites a latitude and longitude to see them on the map."
          action={<Button href="/units/groups">Groups and water bodies</Button>}
        />
      ) : (
        <>
          <Card padding={false} className="overflow-hidden">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full h-auto block bg-foam"
              role="img"
              aria-label={`Map of ${all.length} placed items`}
            >
              {/* North arrow */}
              <g transform={`translate(${W - 32}, 34)`} aria-hidden>
                <path d="M0 -14 L6 6 L0 2 L-6 6 Z" fill="currentColor" className="text-muted" />
                <text y="20" textAnchor="middle" fontSize="11" className="fill-current text-muted">N</text>
              </g>
              {/* Scale bar */}
              {(() => {
                const s = scaleBar(proj.mPerPx, 120)
                return (
                  <g transform={`translate(24, ${H - 24})`} aria-hidden>
                    <line x1="0" x2={s.px} y1="0" y2="0" stroke="currentColor" strokeWidth="2" className="text-muted" />
                    <line x1="0" x2="0" y1="-4" y2="4" stroke="currentColor" strokeWidth="2" className="text-muted" />
                    <line x1={s.px} x2={s.px} y1="-4" y2="4" stroke="currentColor" strokeWidth="2" className="text-muted" />
                    <text x={s.px / 2} y="-8" textAnchor="middle" fontSize="12" className="fill-current text-muted">{s.label}</text>
                  </g>
                )
              })()}
              {all.map((p) => {
                const { x, y } = proj.project(p)
                const key = `${p.layer}-${p._id}`
                const active = selected === key
                const common = {
                  onClick: () => setSelected(active ? null : key),
                  onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && setSelected(active ? null : key),
                  tabIndex: 0,
                  role: 'button',
                  'aria-label': `${p.name}${p.layer === 'unit' ? `, ${p.statusLabel}` : ''}`,
                  style: { cursor: 'pointer' },
                }
                if (p.layer === 'site') {
                  return (
                    <g key={key} {...common}>
                      <rect x={x - 7} y={y - 7} width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" className="text-chart-ink" />
                      <text x={x + 11} y={y + 4} fontSize="13" fontWeight="600" className="fill-current text-chart-ink">{p.name}</text>
                    </g>
                  )
                }
                if (p.layer === 'water') {
                  return (
                    <g key={key} {...common}>
                      <circle cx={x} cy={y} r="9" fill="none" stroke="#0e7490" strokeWidth="2" strokeDasharray="3 2" />
                      <text x={x + 12} y={y + 4} fontSize="12" fill="#0e7490">{p.name}</text>
                    </g>
                  )
                }
                if (p.layer === 'group') {
                  return (
                    <g key={key} {...common}>
                      <circle cx={x} cy={y} r={active ? 14 : 12} className="fill-current text-surface" stroke="currentColor" strokeWidth="2" />
                      <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="600" className="fill-current text-chart-ink">{p.unitCount}</text>
                      <text x={x + 17} y={y + 4} fontSize="12" className="fill-current text-chart-ink">{p.name}</text>
                    </g>
                  )
                }
                return (
                  <g key={key} {...common}>
                    <circle
                      cx={x}
                      cy={y}
                      r={active ? 8 : 6}
                      fill={STATUS_FILL[p.status] || '#a1a1aa'}
                      stroke="white"
                      strokeWidth="1.5"
                    />
                    <text x={x + 9} y={y + 4} fontSize="11" className="fill-current text-muted">{p.name}</text>
                  </g>
                )
              })}
            </svg>
          </Card>

          <div className="flex flex-wrap gap-4 text-sm text-muted" aria-label="Legend">
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-kelp" />Stocked</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-lake" />Harvesting</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-amber-600" />Maintenance</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-zinc-400" />Empty or fallow</span>
            <span>Numbered circles are groups</span>
          </div>

          {selected && (() => {
            const p = all.find((x) => `${x.layer}-${x._id}` === selected)
            if (!p) return null
            return (
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-chart-ink">
                    {p.name}{' '}
                    <span className="text-sm font-normal text-muted">
                      {p.layer === 'unit' ? `${unitLabel(p.unitType)} · ${p.statusLabel} · ${p.fish.toLocaleString()} fish` : ''}
                      {p.layer === 'group' ? `${p.unitCount} units, ${p.stocked} stocked${p.unplaced ? `, ${p.unplaced} without a position` : ''}` : ''}
                      {p.layer === 'site' ? 'Site' : ''}
                      {p.layer === 'water' ? 'Water body' : ''}
                    </span>
                  </p>
                  <span className="flex gap-3 text-sm">
                    {p.layer === 'unit' && <Link className="text-lake hover:underline" href={`/cages/${p._id}`}>Open unit</Link>}
                    {p.layer === 'group' && <Link className="text-lake hover:underline" href={`/units?group=${p._id}`}>Open group</Link>}
                    <a className="text-lake hover:underline" href={osm(p)} target="_blank" rel="noreferrer">OpenStreetMap</a>
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted tabular-nums">{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</p>
              </Card>
            )
          })()}
        </>
      )}
    </div>
  )
}

export default function SiteMapPage() {
  return (
    <ProtectedRoute>
      <Layout title="Site map">
        <SiteMap />
      </Layout>
    </ProtectedRoute>
  )
}
