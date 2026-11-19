import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { formatDate } from '../../lib/format'
import { useLocale, useT } from '../../lib/i18n/context'
import { PaperCard, fmt, label } from './common'

function Codes({ ids, codes }) {
  if (!ids.length) return '—'
  return ids.map((id, i) => (
    <span key={id}>
      {i > 0 && ', '}
      <Link href={`/hatchery/broodstock/${id}`} className="text-pearl-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
        {codes[i]}
      </Link>
    </span>
  ))
}

/**
 * The spawning and broodstock behind a batch, found through its parents
 * (HAT-004): shown on any batch, grow-out included, whose fish were hatched
 * here. Renders nothing for batches from outside the hatchery.
 */
export default function HatcheryOrigin({ batchId }) {
  const t = useT()
  const { locale } = useLocale()
  const origin = useQuery(api.hatchery.batchOrigin, batchId ? { batchId } : 'skip')
  if (!origin) return null
  const s = origin.spawning
  const pct = (v) => (v != null ? `${fmt(v, 1)} %` : '—')
  const items = [
    ['spawned', formatDate(s.spawn_date, { locale })],
    ['females', <Codes key="f" ids={s.female_ids} codes={s.female_codes} />, true],
    ['males', <Codes key="m" ids={s.male_ids} codes={s.male_codes} />, true],
    ['method', s.hormone ? t('hatcheryPage.origin.induced', { hormone: s.hormone }) : label(t, 'method', s.method)],
    ['eggs', fmt(s.eggs_collected)],
    ['fertilization', pct(s.fertilization_pct)],
    ['hatchRate', pct(s.hatch_pct)],
    ['fryPerKg', fmt(s.fry_per_kg_female)],
  ]
  return (
    <PaperCard
      title={t('hatcheryPage.origin.title')}
      meta={
        origin.generations === 0
          ? t('hatcheryPage.origin.here')
          : t('hatcheryPage.origin.back', { batch: origin.hatched_batch_number, count: origin.generations })
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-4 sm:grid-cols-4">
        {items.map(([k, v, mono]) => (
          <div key={k} className="flex flex-col gap-1">
            <dt className="text-xs leading-4 text-muted">{t(`hatcheryPage.origin.${k}`)}</dt>
            <dd className={`text-[14px] leading-[18px] text-text tabular-nums ${mono ? 'font-mono text-[13px]' : ''}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </PaperCard>
  )
}
