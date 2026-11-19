import React, { useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { EmptyState, Field, Input } from './ui'
import { formatDate, localToday } from '../lib/format'

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }))
const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n))
const today = () => localToday()

const EVENT_TONE = {
  stock_in: 'var(--cyan)',
  transfer_in: 'var(--cyan)',
  transfer_out: 'var(--cyan)',
  harvest: 'var(--good)',
  mortality: 'var(--alert)',
  grading_split: 'var(--pink)',
  merge: 'var(--pink)',
  count_adjustment: 'var(--warn)',
  reversal: 'var(--faint)',
}

/** One ledger event on the Paper 26 timeline: coloured ring, kind, date and fish ±, then detail. */
export function EventRow({ e, showCage = false }) {
  const tone = e.reversed ? 'var(--faint)' : EVENT_TONE[e.type] || 'var(--muted)'
  const detail = [
    showCage ? e.cage_name : null,
    e.counterpart_cage ? `${e.qty < 0 ? 'to' : 'from'} ${e.counterpart_cage}` : null,
    e.kg ? `${signed(e.kg)} kg` : null,
    e.reason,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className={`group relative pb-6 pl-[34px] last:pb-0 ${e.reversed ? 'opacity-60' : ''}`}>
      <span
        aria-hidden
        className="absolute left-0 top-[3px] size-3 rounded-pill border-2 bg-surface"
        style={{ borderColor: tone }}
      />
      <span aria-hidden className="absolute bottom-0 left-[5px] top-[19px] border-l border-dashed border-line-strong group-last:hidden" />
      <p className="text-xs uppercase leading-4 tracking-[0.06em]" style={{ color: tone }}>
        <span className={e.reversed ? 'line-through' : ''}>{e.label}</span>
      </p>
      <p className="mt-1 text-[16px] font-medium leading-[22px] text-text tabular-nums">
        {formatDate(e.date)} ·{' '}
        <span className={e.qty < 0 ? 'text-alert' : 'text-good'}>{signed(e.qty)}</span> fish
      </p>
      <p className="mt-0.5 text-[13px] leading-[18px] text-muted">
        {e.batch_number && (
          <>
            <Link href={`/batches/${e.batch_id}`} className="text-cyan hover:underline">
              {e.batch_number}
            </Link>
            {detail || e.reversed ? ' · ' : ''}
          </>
        )}
        {detail}
        {e.reversed ? `${detail ? ' · ' : ''}reversed` : ''}
      </p>
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
    <section className="rounded-card border border-line bg-surface shadow-[var(--shadow-card)] overflow-hidden" aria-labelledby="batch-history-title">
      <div className="px-4 sm:px-6 pt-5 pb-4 border-b border-line flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="batch-history-title" className="text-lg font-medium">
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
          <dl className="px-4 sm:px-6 py-4 grid grid-cols-2 sm:grid-cols-3 gap-4 border-b border-line">
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
              <dd className={`mt-1 text-sm ${data.in_step ? 'text-good' : 'text-alert'}`}>
                {data.in_step
                  ? `${fmt(data.ledger_count)} fish, matches the cage`
                  : `${fmt(data.ledger_count)} fish; the cage shows ${fmt(data.cage_count)}`}
              </dd>
            </div>
          </dl>

          {data.occupancies.length > 0 && (
            <div className="px-4 sm:px-6 py-4 border-b border-line">
              <h3 className="text-sm font-medium text-text mb-2">Batches in this cage</h3>
              <ul className="flex flex-wrap gap-2">
                {data.occupancies.map((o) => (
                  <li key={o.batch_id}>
                    <Link
                      href={`/batches/${o.batch_id}`}
                      className="inline-flex items-baseline gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:border-line-strong"
                    >
                      <span className="font-medium text-text">{o.batch_number}</span>
                      <span className="text-muted tabular-nums">
                        {o.closed_on ? `${o.opened_on} – ${o.closed_on}` : `since ${o.opened_on}, ${fmt(o.count)} fish`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="px-6 py-6">
            {data.events.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
