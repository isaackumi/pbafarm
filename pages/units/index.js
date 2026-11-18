import { useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Button, EmptyState, PageHeader, StatCard } from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import { localToday, unitLabel } from '../../lib/format'
import { usePermission } from '../../hooks/usePermission'

const STATUS_TONE = {
  active: 'bg-kelp/10 text-kelp border-kelp/30',
  harvesting: 'bg-lake/10 text-lake border-lake/30',
  maintenance: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
  fallow: 'bg-foam text-muted border-foam-deep',
  harvested: 'bg-foam text-muted border-foam-deep',
  empty: 'bg-surface text-muted border-foam-deep',
}

const DENSITY_TEXT = { over: 'text-signal', warn: 'text-amber-700 dark:text-amber-300' }

function UnitTile({ u, wq, today }) {
  const overdue = u.nextMaintenanceDate && u.nextMaintenanceDate < today
  return (
    <Link
      href={`/cages/${u._id}`}
      className="block rounded-lg border border-foam-deep bg-surface p-3 hover:border-lake focus:outline-none focus-visible:ring-2 focus-visible:ring-lake min-h-[6.5rem]"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-chart-ink truncate">{u.name}</span>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_TONE[u.status] || STATUS_TONE.empty}`}>
          {u.statusLabel}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">{unitLabel(u.unitType)}</p>
      <p className="mt-2 text-sm tabular-nums text-chart-ink">
        {u.fish > 0 ? `${u.fish.toLocaleString()} fish` : 'No fish'}
        {u.abwG ? <span className="text-muted"> · {Math.round(u.abwG)} g</span> : null}
      </p>
      {u.density != null && u.fish > 0 && (
        <p className={`text-xs tabular-nums ${DENSITY_TEXT[u.densityLevel] || 'text-muted'}`}>
          {u.density} {u.densityUnit}
          {u.densityPct != null ? ` · ${Math.round(u.densityPct)}% of limit` : ''}
        </p>
      )}
      {wq && (
        <p className={`text-xs tabular-nums ${wq.breachCount ? 'text-signal' : 'text-muted'}`}>
          {wq.values.dissolvedOxygen != null ? `DO ${wq.values.dissolvedOxygen} mg/L` : 'Water logged'} · {wq.date}
          {wq.breachCount ? ' · out of range' : ''}
        </p>
      )}
      {overdue && <p className="text-xs text-signal">Maintenance overdue</p>}
    </Link>
  )
}

function Board() {
  const { user, hasRole } = useAuth()
  const isAdmin = usePermission('org.sites.manage')
  const router = useRouter()
  const { locationArgs } = useLocation()
  const data = useQuery(api.units.board, user ? locationArgs : 'skip')
  const latest = useQuery(api.waterQuality.latestByUnit, user ? locationArgs : 'skip')
  const wqByUnit = useMemo(() => new Map((latest || []).map((r) => [r.unitId, r])), [latest])
  const today = localToday()
  const focus = typeof router.query.group === 'string' ? router.query.group : null

  const sections = useMemo(() => {
    if (!data) return []
    return focus ? data.sections.filter((s) => s.groupId === focus) : data.sections
  }, [data, focus])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Unit board"
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Units' }]}
        description="Every cage, pond and tank by group, with live status, fish and stocking density."
        actions={
          <>
            {isAdmin && (
              <Button size="sm" variant="secondary" href="/units/groups">
                Groups
              </Button>
            )}
            <Button size="sm" href="/create-cage">
              Add unit
            </Button>
          </>
        }
        related={[
          { label: 'Site map', href: '/units/map' },
          { label: 'Water entry', href: '/water-entry' },
          { label: 'Inspection entry', href: '/inspection-entry' },
          { label: 'All units (table)', href: '/cages' },
          { label: 'Water quality', href: '/water-quality' },
          { label: 'Maintenance', href: '/maintenance' },
        ]}
      />

      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Units" value={data.totals.units} />
          <StatCard label="Stocked" value={data.totals.stocked} />
          <StatCard label="Fish" value={data.totals.fish.toLocaleString()} />
          <StatCard
            label="Density alerts"
            value={data.totals.overDensity + data.totals.nearDensity}
            hint={`${data.totals.overDensity} over, ${data.totals.nearDensity} near the limit`}
            tone={data.totals.overDensity ? 'warn' : 'default'}
          />
        </div>
      )}

      {focus && (
        <Link href="/units" className="text-sm text-lake hover:underline">
          Show all groups
        </Link>
      )}

      {data === undefined ? (
        <p className="text-sm text-muted">Loading units…</p>
      ) : sections.length === 0 ? (
        <EmptyState
          title="No units yet"
          description="Add your cages, ponds or tanks to see them here."
          action={<Button href="/create-cage">Add unit</Button>}
        />
      ) : (
        sections.map((s) => (
          <section key={s.groupId || 'none'} aria-labelledby={`grp-${s.groupId || 'none'}`}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h2 id={`grp-${s.groupId || 'none'}`} className="font-display text-lg font-medium">
                {s.name}
              </h2>
              <span className="text-sm text-muted tabular-nums">
                {s.units.length} {s.units.length === 1 ? 'unit' : 'units'}
              </span>
            </div>
            {s.units.length === 0 ? (
              <p className="text-sm text-muted">No units in this group yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {s.units.map((u) => (
                  <UnitTile key={u._id} u={u} wq={wqByUnit.get(u._id)} today={today} />
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  )
}

export default function UnitsPage() {
  return (
    <ProtectedRoute>
      <Layout title="Units">
        <Board />
      </Layout>
    </ProtectedRoute>
  )
}
