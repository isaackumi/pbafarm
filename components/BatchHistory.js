import React, { useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { EmptyState, Field, Input, KpiStrip } from './ui'
import TraceTimeline from './trace/TraceTimeline'
import { formatDate, formatNumber, localToday } from '../lib/format'
import { useLocale, useT } from '../lib/i18n/context'

const today = () => localToday()

function useFmt() {
  const { locale } = useLocale()
  const fmt = (n) => (n == null ? '—' : formatNumber(n, { locale, decimals: Number.isInteger(n) ? 0 : 1 }))
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n))
  return { locale, fmt, signed }
}

function eventDetail(t, e, showCage) {
  return [
    showCage ? e.cage_name : null,
    e.counterpart_cage ? t(e.qty < 0 ? 'tracePage.history.to' : 'tracePage.history.from', { cage: e.counterpart_cage }) : null,
    e.reason,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** One ledger event as a compact row: date, what happened, batch, fish ±. */
export function EventRow({ e, showCage = false }) {
  const t = useT()
  const { locale, fmt, signed } = useFmt()
  const detail = eventDetail(t, e, showCage)
  return (
    <li className={`flex items-start justify-between gap-3 px-4 py-3 ${e.reversed ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <p className="text-[14px] leading-[18px] text-text">
          <span className={e.reversed ? 'line-through' : ''}>{e.label}</span>
          {e.batch_number && (
            <>
              {' · '}
              <Link href={`/batches/${e.batch_id}`} className="text-pearl-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                {e.batch_number}
              </Link>
            </>
          )}
        </p>
        <p className="mt-[2px] text-xs leading-4 text-muted tabular-nums">
          {formatDate(e.date, { locale })}
          {detail ? ` · ${detail}` : ''}
          {e.reversed ? ` · ${t('tracePage.history.reversed')}` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-[14px] leading-[18px] tabular-nums ${e.qty < 0 ? 'text-alert' : 'text-good'}`}>{signed(e.qty)}</p>
        {e.kg ? <p className="text-xs leading-4 text-muted tabular-nums">{signed(e.kg)} kg</p> : null}
      </div>
    </li>
  )
}

const eventTone = (e) => (e.reversed ? 'neutral' : e.type === 'mortality' ? 'alert' : e.type === 'harvest' ? 'good' : e.qty < 0 ? 'warn' : 'cyan')

/**
 * Cage page: the batches that have lived in this cage, the stock ledger's
 * events (Paper 26 timeline), and the fish count on any past date.
 */
export default function BatchHistory({ cageId }) {
  const t = useT()
  const { locale, fmt, signed } = useFmt()
  const [asOf, setAsOf] = useState(today())
  const data = useQuery(api.batches.forCage, cageId ? { cageId, asOf } : 'skip')

  return (
    <section className="flex flex-col gap-5 rounded-card border border-line bg-surface p-[22px] shadow-[var(--shadow-card)] sm:p-[28px]" aria-labelledby="batch-history-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-[6px]">
          <h2 id="batch-history-title" className="text-[15px] font-semibold leading-[18px] text-text">
            {t('tracePage.history.title')}
          </h2>
          <p className="text-[13px] leading-4 text-muted">{t('tracePage.history.hint')}</p>
        </div>
        <Field label={t('tracePage.history.countOn')} htmlFor="batch-history-asof" className="w-44">
          <Input id="batch-history-asof" type="date" value={asOf} max={today()} onChange={(e) => setAsOf(e.target.value || today())} />
        </Field>
      </div>

      {data === undefined ? (
        <p className="text-[13px] leading-[18px] text-muted">{t('tracePage.history.loading')}</p>
      ) : !data || !data.has_ledger ? (
        <EmptyState title={t('tracePage.history.emptyTitle')} description={t('tracePage.history.emptyHint')} />
      ) : (
        <>
          <KpiStrip
            items={[
              { key: 'count', label: t('tracePage.history.fishOn', { date: formatDate(data.as_of?.date ?? asOf, { locale }) }), value: fmt(data.as_of?.count) },
              { key: 'biomass', label: t('tracePage.history.biomass'), value: data.as_of?.biomass_kg ? `${fmt(data.as_of.biomass_kg)} kg` : '—' },
              {
                key: 'ledger',
                label: t('tracePage.history.ledgerToday'),
                value: fmt(data.ledger_count),
                suffix: data.in_step ? t('tracePage.history.matches') : t('tracePage.history.cageShows', { n: fmt(data.cage_count) }),
                suffixTone: data.in_step ? 'good' : 'alert',
              },
            ]}
          />

          {data.occupancies.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs uppercase leading-4 tracking-wide text-faint">{t('tracePage.history.batches')}</h3>
              <ul className="flex flex-wrap gap-2">
                {data.occupancies.map((o) => (
                  <li key={o.batch_id}>
                    <Link
                      href={`/batches/${o.batch_id}`}
                      className="inline-flex items-baseline gap-2 rounded-pill border border-line px-3 py-[6px] text-[13px] leading-4 hover:border-line-strong hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                    >
                      <span className="font-medium text-text">{o.batch_number}</span>
                      <span className="text-muted tabular-nums">
                        {o.closed_on
                          ? `${formatDate(o.opened_on, { locale })} – ${formatDate(o.closed_on, { locale })}`
                          : t('tracePage.history.since', { date: formatDate(o.opened_on, { locale }), n: fmt(o.count) })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <TraceTimeline
            label={t('tracePage.history.title')}
            items={data.events.map((e) => {
              const detail = eventDetail(t, e, false)
              return {
                key: e.id,
                tone: eventTone(e),
                label: e.reversed ? `${e.label} · ${t('tracePage.history.reversed')}` : e.label,
                title: (
                  <span className={e.reversed ? 'line-through' : ''}>
                    {formatDate(e.date, { locale })} · {t('tracePage.fishN', { n: signed(e.qty) })}
                    {e.kg ? ` · ${signed(e.kg)} kg` : ''}
                  </span>
                ),
                sub: (
                  <>
                    {e.batch_number && (
                      <Link href={`/batches/${e.batch_id}`} className="text-pearl-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                        {e.batch_number}
                      </Link>
                    )}
                    {e.batch_number && detail ? ' · ' : ''}
                    {detail}
                  </>
                ),
              }
            })}
          />
        </>
      )}
    </section>
  )
}
