import { formatDate, formatNumber } from '../../lib/format'

const DOT = {
  pink: 'border-pearl-pink',
  cyan: 'border-pearl-cyan',
  warn: 'border-warn',
  good: 'border-good',
  alert: 'border-alert',
  neutral: 'border-line-strong',
}
const LABEL = {
  pink: 'text-pearl-pink',
  cyan: 'text-pearl-cyan',
  warn: 'text-warn',
  good: 'text-good',
  alert: 'text-alert',
  neutral: 'text-muted',
}

/** Paper 26 vertical timeline: a ringed dot, dashed rail, tone-coloured eyebrow, title and muted sub line. */
export default function TraceTimeline({ items, label }) {
  return (
    <ol className="flex flex-col" aria-label={label}>
      {items.map((it, i) => {
        const last = i === items.length - 1
        return (
          <li key={it.key} className="flex gap-[18px]">
            <div className="flex w-[14px] shrink-0 flex-col items-center gap-1 pt-1" aria-hidden>
              <span className={`size-3 shrink-0 rounded-pill border-2 bg-surface ${DOT[it.tone] || DOT.neutral}`} />
              {!last && <span className="w-0 grow border-l-2 border-dashed border-line-strong" />}
            </div>
            <div className={`flex min-w-0 grow basis-0 flex-col gap-[3px] ${last ? '' : 'pb-[22px]'}`}>
              <span className={`text-xs uppercase leading-4 tracking-wide ${LABEL[it.tone] || LABEL.neutral}`}>{it.label}</span>
              <span className="text-[15px] font-medium leading-[18px] text-text">{it.title}</span>
              {it.sub && <span className="text-[13px] leading-4 text-muted">{it.sub}</span>}
              {it.extra}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

const join = (...parts) => parts.filter((p) => p != null && p !== '').join(' · ')

/** Eyebrow, title and sub line for a lotTimeline() step, in the active locale. */
export function describeStep(t, locale, step, r) {
  const d = (iso) => formatDate(iso, { locale })
  const n = (v, decimals = 0) => formatNumber(v, { locale, decimals })
  switch (step.kind) {
    case 'origin': {
      const o = step.origin
      return {
        label: t.or(`tracePage.origin.${o.origin}`, o.origin),
        title: join(o.batch_number, d(o.opened_on)),
        sub: join(
          o.source,
          o.source_cage,
          o.stocked_count != null
            ? o.initial_abw_g != null
              ? t('tracePage.fishAt', { n: n(o.stocked_count), g: n(o.initial_abw_g, 1) })
              : t('tracePage.fishN', { n: n(o.stocked_count) })
            : null,
        ),
      }
    }
    case 'move': {
      const s = step.move
      return {
        label: t.or(`tracePage.move.${s.kind}`, s.kind),
        title: join(d(s.date), s.cageName, t('tracePage.fishN', { n: n(s.qty) })),
        sub: join(s.batchNumber, s.counterpartCage && t('tracePage.with', { name: s.counterpartCage }), s.counterpartBatch, s.source),
      }
    }
    case 'treatment': {
      const x = step.treatment
      return {
        label: t('tracePage.step.treatment'),
        title: join(d(x.date), x.product_name || x.treatment, x.withdrawal_days ? t('tracePage.withdrawalDays', { n: x.withdrawal_days }) : null),
        sub: join(
          x.diagnosis,
          x.cage_name,
          x.dosage,
          x.administered_by,
          x.withdrawal_until ? t('tracePage.withdrawalUntil', { date: d(x.withdrawal_until) }) : null,
        ),
      }
    }
    case 'growout':
      return {
        label: t('tracePage.step.growout', { count: step.days }),
        title: step.feedKg > 0 ? t('tracePage.feedKg', { kg: n(step.feedKg, 1) }) : t('tracePage.noFeed'),
        sub: step.feedTypes.join(' · '),
      }
    case 'harvest':
      return {
        label: t('tracePage.step.harvest'),
        title: join(d(r.lot.harvest_date), `${n(r.lot.weight_kg, 1)} kg`, r.lot.fish_count != null ? t('tracePage.fishN', { n: n(r.lot.fish_count) }) : null),
        sub: join(r.lot.grade && t('tracePage.grade', { grade: r.lot.grade }), r.cage_name, r.lot.destination),
      }
    case 'dispatch': {
      const ds = step.dispatches
      return {
        label: t('tracePage.step.dispatch'),
        title: join(t('tracePage.dispatchCount', { count: ds.length }), ds.map((x) => x.vehicle).filter(Boolean).join(', ')),
        sub: [...new Set(ds.map((x) => x.customer_name).filter(Boolean))].join(', '),
      }
    }
    default:
      return { label: step.kind, title: '' }
  }
}
