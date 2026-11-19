import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import Layout from '../../components/Layout'
import ProtectedRoute from '../../components/ProtectedRoute'
import { FileText } from 'lucide-react'
import { Button, EmptyState, GradientButton, KpiStrip, LoadingState } from '../../components/ui'
import { EventRow } from '../../components/BatchHistory'
import BatchTrace from '../../components/BatchTrace'
import HatcheryOrigin from '../../components/hatchery/HatcheryOrigin'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../convex/_generated/api'
import { formatDate, localToday } from '../../lib/format'

const card = 'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'
const head = 'flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5'
const h2 = 'text-[17px] font-semibold leading-[22px] text-text'
import { CustomFieldsCard } from '../../components/CustomFields'

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
      <h3 className="text-sm font-medium text-text mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((b) => (
            <li key={b.id}>
              <Link
                href={`/batches/${b.id}`}
                className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-line-strong"
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
        <Link href={`/cages/${o.cage_id}`} className="font-medium text-cyan hover:underline">
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

  if (batch === undefined || !id) {
    return (
      <Layout title="Batch">
        <LoadingState label="Loading batch…" />
      </Layout>
    )
  }
  if (batch === null) {
    return (
      <Layout title="Batch">
        <EmptyState
          title="Batch not found"
          description="It may belong to another company, or the link is wrong."
          action={<Button href="/cages">Back to cages</Button>}
        />
      </Layout>
    )
  }

  const t = batch.totals
  const openCages = batch.occupancies.filter((o) => !o.closed_on).length
  return (
    <Layout
      title={`Batch ${batch.batch_number}`}
      eyebrow={[
        ORIGIN[batch.origin] || batch.origin,
        batch.species?.replace(/_/g, ' '),
        batch.closed_on ? `${formatDate(batch.opened_on)} – ${formatDate(batch.closed_on)}` : `since ${formatDate(batch.opened_on)}`,
        batch.status === 'closed' ? 'closed' : 'active',
      ]
        .filter(Boolean)
        .join(' · ')}
      actions={
        batch.stocking_id ? (
          <GradientButton href={`/stocking/${batch.stocking_id}/details`} icon={FileText}>
            Stocking record
          </GradientButton>
        ) : null
      }
    >
      <div className="flex flex-col gap-7">
        <KpiStrip
          items={[
            { key: 'fish', label: 'Fish now', value: fmt(t.count, 0), suffix: `${openCages} cage${openCages === 1 ? '' : 's'}` },
            { key: 'harvested', label: 'Harvested', value: fmt(t.harvested, 0), suffix: t.harvested_kg ? `${fmt(t.harvested_kg)} kg` : 'fish' },
            {
              key: 'survival',
              label: 'Survival',
              value: pct(t.survival_pct),
              valueTone: t.survival_pct != null && t.survival_pct < 80 ? 'warn' : undefined,
            },
            { key: 'mortality', label: 'Mortality', value: pct(t.mortality_pct), suffix: `${fmt(t.mortality, 0)} deaths` },
          ]}
        />

        <section aria-labelledby="events-title" className={card}>
          <div className={head}>
            <h2 id="events-title" className={h2}>Stock history</h2>
            <span className="text-[13px] text-muted">{batch.batch_number}</span>
          </div>
          {batch.events.length === 0 ? (
            <EmptyState title="No stock events yet" />
          ) : (
            <ul className="px-6 py-6">
              {batch.events.map((e) => (
                <EventRow key={e.id} e={e} showCage />
              ))}
            </ul>
          )}
        </section>

        <CustomFieldsCard
          entity="batches"
          recordId={batch.id}
          values={batch.custom}
          locationId={batch.home_location_id}
          core={{ origin: batch.origin, species: batch.species, status: batch.status }}
          editPermission="production.units.manage"
        />

        <section aria-labelledby="lineage-title" className={`${card} p-6`}>
          <h2 id="lineage-title" className={h2}>Lineage</h2>
          <p className="mb-5 mt-1 text-xs text-muted">Where these fish came from and where they went.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <BatchLinks title="Came from" items={batch.ancestors} empty="Stocked directly; no parent batch." />
            <BatchLinks title="Went on to" items={batch.descendants} empty="No child batches." />
          </div>
        </section>

        <HatcheryOrigin batchId={batch.id} />
        <BatchTrace batchId={batch.id} />

        <section className={`${card} overflow-hidden`} aria-labelledby="occupancies-title">
          <div className={head}>
            <div className="flex flex-col gap-1">
              <h2 id="occupancies-title" className={h2}>Cages</h2>
              <p className="text-xs text-muted">Each cage this batch has lived in, with its figures there.</p>
            </div>
          </div>
          {batch.occupancies.length === 0 ? (
            <EmptyState title="No stock events yet" />
          ) : (
            <ul className="divide-y divide-line">
              {batch.occupancies.map((o) => (
                <Occupancy key={o.cage_id} o={o} />
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
