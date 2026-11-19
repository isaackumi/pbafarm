import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import TraceTimeline, { describeStep } from './trace/TraceTimeline'
import { lotTimeline } from '../lib/traceView'
import { formatDate, formatNumber } from '../lib/format'
import { useLocale, useT } from '../lib/i18n/context'

const CARD = 'rounded-card border border-line bg-surface p-[22px] shadow-[var(--shadow-card)] sm:p-[28px]'

/**
 * Where a batch's fish came from (hatchery or supplier, stockings, transfers,
 * gradings), what feed lots and treatments they had, and which harvest lots
 * and customers they went to (TRACE-001..004), as the Paper 26 timeline.
 */
export default function BatchTrace({ batchId }) {
  const t = useT()
  const { locale } = useLocale()
  const trace = useQuery(api.traceability.batchTrace, batchId ? { batchId } : 'skip')
  if (trace === undefined) {
    return (
      <section className={CARD}>
        <p className="text-[13px] leading-[18px] text-muted">{t('tracePage.loadingTrace')}</p>
      </section>
    )
  }
  if (trace === null) return null

  const kg = (v) => `${formatNumber(v, { locale, decimals: 1 })} kg`
  const steps = lotTimeline({ trace }).map((s, i) => ({ key: `${s.kind}-${i}`, tone: s.tone, ...describeStep(t, locale, s) }))
  const feedKg = trace.feed.reduce((s, f) => s + f.kg_fed, 0)
  if (trace.feed.length) {
    steps.push({
      key: 'feed',
      tone: 'cyan',
      label: t('tracePage.feedLots'),
      title: t('tracePage.feedKg', { kg: formatNumber(feedKg, { locale, decimals: 1 }) }),
      sub: trace.feed
        .map((f) => [f.feed_type, f.lots.map((l) => l.lot_number || t('tracePage.noLotNumber')).join(', ')].filter(Boolean).join(': '))
        .join(' · '),
    })
  }
  for (const l of trace.lots) {
    steps.push({
      key: l.id,
      tone: 'good',
      label: t('tracePage.step.lot'),
      title: (
        <span>
          <Link href={`/trace/${l.id}`} className="rounded-sm text-text underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
            {l.lot_code}
          </Link>
          {` · ${formatDate(l.harvest_date, { locale })} · ${kg(l.weight_kg)}`}
        </span>
      ),
      sub: l.dispatches.length
        ? l.dispatches.map((d) => `${d.customer_name || '—'} (${kg(d.weight_kg)}, ${formatDate(d.dispatch_date, { locale })})`).join(', ')
        : t('tracePage.notDispatched'),
    })
  }

  return (
    <section className={CARD} aria-labelledby="batch-trace-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3 pb-4">
        <h2 id="batch-trace-title" className="text-[15px] font-semibold leading-[18px] text-text">
          {t('tracePage.farmToCustomer')}
        </h2>
        <p className="text-[13px] leading-4 text-muted">
          {trace.batches.length > 1 ? t('tracePage.parents', { count: trace.batches.length - 1 }) : t('tracePage.batchTraceHint')}
        </p>
      </div>
      {steps.length === 0 ? (
        <p className="text-[13px] leading-[18px] text-muted">{t('tracePage.noHistory')}</p>
      ) : (
        <TraceTimeline items={steps} label={t('tracePage.farmToCustomer')} />
      )}
      {trace.lots.length === 0 && (
        <p className="mt-4 border-t border-line pt-4 text-[13px] leading-[18px] text-muted">
          {t('tracePage.noLotsYet')}{' '}
          <Link href="/trace" className="text-pearl-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
            {t('tracePage.createLot')}
          </Link>
        </p>
      )}
    </section>
  )
}
