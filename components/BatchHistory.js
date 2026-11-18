import React, { useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { EmptyState, Field, Input } from './ui'

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }))
const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n))
const today = () => new Date().toISOString().slice(0, 10)

/** One ledger event as a compact row: date, what happened, batch, fish ±. */
export function EventRow({ e, showCage = false }) {
  const detail = [
    showCage ? e.cage_name : null,
    e.counterpart_cage ? `${e.qty < 0 ? 'to' : 'from'} ${e.counterpart_cage}` : null,
    e.reason,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className={`px-4 py-3 flex items-start justify-between gap-3 ${e.reversed ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <p className="text-sm text-chart-ink">
          <span className={e.reversed ? 'line-through' : ''}>{e.label}</span>
          {e.batch_number && (
            <>
              {' · '}
              <Link href={`/batches/${e.batch_id}`} className="text-lake hover:underline">
                {e.batch_number}
              </Link>
            </>
          )}
        </p>
        <p className="text-xs text-muted mt-0.5 font-data">
          {e.date}
          {detail ? ` · ${detail}` : ''}
          {e.reversed ? ' · reversed' : ''}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={`font-data tabular-nums text-sm ${e.qty < 0 ? 'text-signal' : 'text-kelp'}`}>{signed(e.qty)}</p>
        {e.kg ? <p className="text-xs text-muted tabular-nums">{signed(e.kg)} kg</p> : null}
      </div>
    </li>
  )
}

/**
 * Cage page: the batches that have lived in this cage, the stock ledger's
 * events, and the fish count on any past date.
 */
export default function BatchHistory({ cageId }) {
  const [asOf, setAsOf] = useState(today())
  const data = useQuery(api.batches.forCage, cageId ? { cageId, asOf } : 'skip')

  return (
    <section className="page-card overflow-hidden" aria-labelledby="batch-history-title">
      <div className="px-4 sm:px-6 pt-5 pb-4 border-b border-foam-deep flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="batch-history-title" className="font-display text-lg font-medium">
            Batch history
          </h2>
          <p className="text-sm text-muted mt-1">Every change to this cage&apos;s fish, from the stock ledger.</p>
        </div>
        <Field label="Count on" htmlFor="batch-history-asof" className="w-44">
          <Input
            id="batch-history-asof"
            type="date"
            value={asOf}
            max={today()}
            onChange={(e) => setAsOf(e.target.value || today())}
          />
        </Field>
      </div>

      {data === undefined ? (
        <p className="p-6 text-sm text-muted">Loading history…</p>
      ) : !data || !data.has_ledger ? (
        <EmptyState
          title="No ledger history yet"
          description="Stock events appear here once fish are stocked, or after the backfill has run for older cycles."
        />
      ) : (
        <>
          <dl className="px-4 sm:px-6 py-4 grid grid-cols-2 sm:grid-cols-3 gap-4 border-b border-foam-deep">
            <div>
              <dt className="text-sm text-muted">Fish on {data.as_of?.date ?? asOf}</dt>
              <dd className="mt-1 text-xl font-medium tabular-nums">{fmt(data.as_of?.count)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Biomass then</dt>
              <dd className="mt-1 text-xl font-medium tabular-nums">
                {data.as_of?.biomass_kg ? `${fmt(data.as_of.biomass_kg)} kg` : '—'}
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-sm text-muted">Ledger today</dt>
              <dd className={`mt-1 text-sm ${data.in_step ? 'text-kelp' : 'text-signal'}`}>
                {data.in_step
                  ? `${fmt(data.ledger_count)} fish, matches the cage`
                  : `${fmt(data.ledger_count)} fish; the cage shows ${fmt(data.cage_count)}`}
              </dd>
            </div>
          </dl>

          {data.occupancies.length > 0 && (
            <div className="px-4 sm:px-6 py-4 border-b border-foam-deep">
              <h3 className="text-sm font-medium text-chart-ink mb-2">Batches in this cage</h3>
              <ul className="flex flex-wrap gap-2">
                {data.occupancies.map((o) => (
                  <li key={o.batch_id}>
                    <Link
                      href={`/batches/${o.batch_id}`}
                      className="inline-flex items-baseline gap-2 rounded-lg border border-foam-deep px-3 py-2 text-sm hover:border-lake"
                    >
                      <span className="font-medium text-chart-ink">{o.batch_number}</span>
                      <span className="text-muted tabular-nums">
                        {o.closed_on ? `${o.opened_on} – ${o.closed_on}` : `since ${o.opened_on}, ${fmt(o.count)} fish`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="divide-y divide-foam-deep">
            {data.events.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
