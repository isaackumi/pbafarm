import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import Layout from '../../components/Layout'
import ProtectedRoute from '../../components/ProtectedRoute'
import { PageHeader, Button, Card, CardHeader, StatCard, EmptyState } from '../../components/ui'
import { EventRow } from '../../components/BatchHistory'
import BatchTrace from '../../components/BatchTrace'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../convex/_generated/api'
import { localToday } from '../../lib/format'

const fmt = (v, dp = 1) =>
  v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp })
const pct = (v) => (v == null ? '—' : `${fmt(v)}%`)

const ORIGIN = {
  stocking: 'Stocked',
  transfer_split: 'Split off by a transfer',
  grading_split: 'Graded from a parent batch',
  merge: 'Formed by a merge',
  hatchery: 'From the hatchery',
  legacy: 'Imported',
}

function BatchLinks({ title, items, empty }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-chart-ink mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((b) => (
            <li key={b.id}>
              <Link
                href={`/batches/${b.id}`}
                className="inline-flex items-center gap-2 rounded-lg border border-foam-deep px-3 py-1.5 text-sm hover:border-lake"
              >
                <span className="font-medium">{b.batch_number}</span>
                {b.depth > 1 && <span className="text-xs text-muted">{b.depth} steps</span>}
                {b.status === 'closed' && <span className="text-xs text-muted">closed</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One cage the batch has lived in, with that occupancy's KPIs. */
function Occupancy({ o }) {
  return (
    <li className="px-4 sm:px-6 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/cages/${o.cage_id}`} className="font-medium text-lake hover:underline">
          {o.cage_name}
        </Link>
        <p className="text-sm text-muted tabular-nums">
          {o.opened_on}
          {o.closed_on ? ` – ${o.closed_on}` : ', open'} · day {o.days_of_culture ?? '—'}
        </p>
      </div>
      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
        <div>
          <dt className="text-muted">Fish</dt>
          <dd className="font-data tabular-nums">{fmt(o.count, 0)}</dd>
        </div>
        <div>
          <dt className="text-muted">Average weight</dt>
          <dd className="font-data tabular-nums">{o.current_abw_g == null ? '—' : `${fmt(o.current_abw_g)} g`}</dd>
        </div>
        <div>
          <dt className="text-muted">eFCR</dt>
          <dd className="font-data tabular-nums">{o.efcr == null ? '—' : o.efcr.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-muted">Survival</dt>
          <dd className="font-data tabular-nums">{pct(o.survival_pct)}</dd>
        </div>
        <div>
          <dt className="text-muted">Harvested</dt>
          <dd className="font-data tabular-nums">
            {o.harvested_count ? `${fmt(o.harvested_count, 0)} · ${fmt(o.harvested_kg)} kg` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Moved in / out</dt>
          <dd className="font-data tabular-nums">
            {fmt(o.in_count, 0)} / {fmt(o.out_count, 0)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Deaths</dt>
          <dd className="font-data tabular-nums">{fmt(o.mortality, 0)}</dd>
        </div>
        <div>
          <dt className="text-muted">Unaccounted</dt>
          <dd className="font-data tabular-nums">{o.unaccounted ? fmt(o.unaccounted, 0) : '—'}</dd>
        </div>
      </dl>
    </li>
  )
}

function BatchDetails() {
  const router = useRouter()
  const { user } = useAuth()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  const batch = useQuery(
    api.batches.get,
    user && id ? { id, asOf: localToday() } : 'skip',
  )

  const crumbs = (label) => [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Cages', href: '/cages' },
    { label },
  ]

  if (batch === undefined || !id) {
    return (
      <Layout title="Batch">
        <div className="flex justify-center items-center h-64 text-muted">Loading batch…</div>
      </Layout>
    )
  }
  if (batch === null) {
    return (
      <Layout title="Batch">
        <PageHeader showTitle={false} breadcrumbs={crumbs('Not found')} />
        <EmptyState
          title="Batch not found"
          description="It may belong to another company, or the link is wrong."
          action={<Button href="/cages">Back to cages</Button>}
        />
      </Layout>
    )
  }

  const t = batch.totals
  return (
    <Layout title={`Batch ${batch.batch_number}`}>
      <div className="max-w-5xl space-y-6">
        <PageHeader
          title={`Batch ${batch.batch_number}`}
          breadcrumbs={crumbs(batch.batch_number)}
          description={[
            ORIGIN[batch.origin] || batch.origin,
            batch.species?.replace(/_/g, ' '),
            batch.closed_on ? `${batch.opened_on} – ${batch.closed_on}` : `since ${batch.opened_on}`,
            batch.status === 'closed' ? 'closed' : 'active',
          ]
            .filter(Boolean)
            .join(' · ')}
          actions={
            batch.stocking_id ? (
              <Button href={`/stocking/${batch.stocking_id}/details`} variant="secondary" size="sm">
                Stocking record
              </Button>
            ) : null
          }
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Fish now" value={fmt(t.count, 0)} hint={`${batch.occupancies.filter((o) => !o.closed_on).length} cage(s)`} />
          <StatCard label="Harvested" value={fmt(t.harvested, 0)} unit="fish" hint={t.harvested_kg ? `${fmt(t.harvested_kg)} kg` : undefined} />
          <StatCard label="Survival" value={pct(t.survival_pct)} hint="Harvests and transfers are not losses" tone={t.survival_pct != null && t.survival_pct < 80 ? 'warn' : 'default'} />
          <StatCard label="Mortality" value={pct(t.mortality_pct)} hint={`${fmt(t.mortality, 0)} deaths`} />
        </div>

        <Card>
          <CardHeader title="Lineage" subtitle="Where these fish came from and where they went." />
          <div className="grid gap-5 sm:grid-cols-2">
            <BatchLinks title="Came from" items={batch.ancestors} empty="Stocked directly; no parent batch." />
            <BatchLinks title="Went on to" items={batch.descendants} empty="No child batches." />
          </div>
        </Card>

        <BatchTrace batchId={batch.id} />

        <section className="page-card overflow-hidden" aria-labelledby="occupancies-title">
          <div className="px-4 sm:px-6 pt-5 pb-3 border-b border-foam-deep">
            <h2 id="occupancies-title" className="font-display text-lg font-medium">
              Cages
            </h2>
            <p className="text-sm text-muted mt-1">Each cage this batch has lived in, with its figures there.</p>
          </div>
          {batch.occupancies.length === 0 ? (
            <EmptyState title="No stock events yet" />
          ) : (
            <ul className="divide-y divide-foam-deep">
              {batch.occupancies.map((o) => (
                <Occupancy key={o.cage_id} o={o} />
              ))}
            </ul>
          )}
        </section>

        <section className="page-card overflow-hidden" aria-labelledby="events-title">
          <div className="px-4 sm:px-6 pt-5 pb-3 border-b border-foam-deep">
            <h2 id="events-title" className="font-display text-lg font-medium">
              Stock events
            </h2>
          </div>
          {batch.events.length === 0 ? (
            <EmptyState title="No stock events yet" />
          ) : (
            <ul className="divide-y divide-foam-deep">
              {batch.events.map((e) => (
                <EventRow key={e.id} e={e} showCage />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Layout>
  )
}

export default function BatchPage() {
  return (
    <ProtectedRoute>
      <BatchDetails />
    </ProtectedRoute>
  )
}
