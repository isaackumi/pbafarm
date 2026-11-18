import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { Card, CardHeader } from './ui'

const fmt = (v, dp = 1) =>
  v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp })

const STEP = {
  stocked: 'Stocked',
  topped_up: 'Topped up',
  transfer_in: 'Moved in',
  transfer_out: 'Moved out',
  graded: 'Graded into',
  merged: 'Merged into',
  harvested: 'Harvested',
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-chart-ink mb-2">{title}</h3>
      {children}
    </div>
  )
}

const Empty = ({ children }) => <p className="text-sm text-muted">{children}</p>

/**
 * Where a batch's fish came from (hatchery or supplier, stockings, transfers,
 * gradings), what feed lots and treatments they had, and which harvest lots
 * and customers they went to (TRACE-001..004).
 */
export default function BatchTrace({ batchId }) {
  const trace = useQuery(api.traceability.batchTrace, batchId ? { batchId } : 'skip')
  if (trace === undefined) {
    return (
      <Card>
        <p className="text-sm text-muted">Loading trace…</p>
      </Card>
    )
  }
  if (trace === null) return null

  return (
    <Card>
      <CardHeader
        title="Traceability"
        subtitle={
          trace.batches.length > 1
            ? `Includes ${trace.batches.length - 1} parent batch(es): fish carry their history with them.`
            : 'Origin, feed, treatments and where the fish went.'
        }
      />
      <div className="space-y-6">
        <Section title="Origin">
          {trace.origins.length === 0 ? (
            <Empty>No origin on record.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {trace.origins.map((o) => (
                <li key={o.batch_id}>
                  <span className="font-medium">{o.batch_number}</span> · opened {o.opened_on}
                  {o.source ? ` · from ${o.source}` : ''}
                  {o.source_cage ? ` (${o.source_cage})` : ''}
                  {o.stocked_count ? ` · ${fmt(o.stocked_count, 0)} fish` : ''}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Movements">
          {trace.journey.length === 0 ? (
            <Empty>No movements on record.</Empty>
          ) : (
            <ol className="space-y-1 text-sm">
              {trace.journey.map((s, i) => (
                <li key={i} className="flex flex-wrap gap-x-2">
                  <span className="text-muted tabular-nums">{s.date}</span>
                  <span>
                    {STEP[s.kind] || s.kind} {s.cageName}
                    {s.counterpartCage ? ` (with ${s.counterpartCage})` : ''} · {s.batchNumber} ·{' '}
                    {fmt(s.qty, 0)} fish
                    {s.source ? ` · ${s.source}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="Feed lots">
          {trace.feed.length === 0 ? (
            <Empty>No feed with a feed type on record.</Empty>
          ) : (
            <ul className="space-y-3 text-sm">
              {trace.feed.map((f) => (
                <li key={f.feed_type}>
                  <p>
                    <span className="font-medium">{f.feed_type}</span> · {fmt(f.kg_fed)} kg · {f.first_fed} to{' '}
                    {f.last_fed}
                  </p>
                  <p className="text-muted">
                    {f.lots.length
                      ? f.lots
                          .map((l) => [l.lot_number || 'no lot number', l.received_on, l.supplier, l.po_number].filter(Boolean).join(' · '))
                          .join('; ')
                      : 'No purchases of this feed on record.'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Treatments">
          {trace.treatments.length === 0 ? (
            <Empty>No treatments.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {trace.treatments.map((x) => (
                <li key={x.id}>
                  <span className="text-muted tabular-nums">{x.date}</span> {x.product_name || x.treatment}
                  {x.diagnosis ? ` for ${x.diagnosis}` : ''} · {x.cage_name}
                  {x.withdrawal_until ? ` · withdrawal until ${x.withdrawal_until}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Harvest lots and customers">
          {trace.lots.length === 0 ? (
            <Empty>
              No harvest lots yet. <Link href="/trace" className="text-lake hover:underline">Create one</Link> after a
              harvest.
            </Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {trace.lots.map((l) => (
                <li key={l.id}>
                  <Link href={`/trace/${l.id}`} className="font-medium text-lake hover:underline font-data">
                    {l.lot_code}
                  </Link>{' '}
                  · {l.harvest_date} · {fmt(l.weight_kg)} kg
                  {l.dispatches.length > 0 && (
                    <span className="text-muted">
                      {' '}
                      → {l.dispatches.map((d) => `${d.customer_name} (${fmt(d.weight_kg)} kg, ${d.dispatch_date})`).join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Card>
  )
}
