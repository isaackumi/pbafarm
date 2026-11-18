import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Card, CardHeader } from '../ui'
import { fmt } from './common'

/**
 * The spawning and broodstock behind a batch, found through its parents
 * (HAT-004): shown on any batch, grow-out included, whose fish were hatched
 * here. Renders nothing for batches from outside the hatchery.
 */
export default function HatcheryOrigin({ batchId }) {
  const origin = useQuery(api.hatchery.batchOrigin, batchId ? { batchId } : 'skip')
  if (!origin) return null
  const s = origin.spawning
  return (
    <Card>
      <CardHeader
        title="Hatchery origin"
        subtitle={
          origin.generations === 0
            ? 'Hatched on this farm.'
            : `Hatched on this farm as ${origin.hatched_batch_number}, ${origin.generations} generation(s) back.`
        }
      />
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <dt className="text-muted">Spawned</dt>
          <dd className="text-chart-ink">{s.spawn_date}</dd>
        </div>
        <div>
          <dt className="text-muted">Females</dt>
          <dd className="text-chart-ink font-data">
            {s.female_ids.map((id, i) => (
              <span key={id}>
                {i > 0 && ', '}
                <Link href={`/hatchery/broodstock/${id}`} className="text-lake hover:underline">
                  {s.female_codes[i]}
                </Link>
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Males</dt>
          <dd className="text-chart-ink font-data">
            {s.male_ids.length
              ? s.male_ids.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ', '}
                    <Link href={`/hatchery/broodstock/${id}`} className="text-lake hover:underline">
                      {s.male_codes[i]}
                    </Link>
                  </span>
                ))
              : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Method</dt>
          <dd className="text-chart-ink">{s.hormone ? `Induced, ${s.hormone}` : s.method}</dd>
        </div>
        <div>
          <dt className="text-muted">Eggs</dt>
          <dd className="text-chart-ink tabular-nums">{fmt(s.eggs_collected)}</dd>
        </div>
        <div>
          <dt className="text-muted">Fertilization</dt>
          <dd className="text-chart-ink tabular-nums">{s.fertilization_pct != null ? `${fmt(s.fertilization_pct, 1)} %` : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Hatch rate</dt>
          <dd className="text-chart-ink tabular-nums">{s.hatch_pct != null ? `${fmt(s.hatch_pct, 1)} %` : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Fry per kg female</dt>
          <dd className="text-chart-ink tabular-nums">{fmt(s.fry_per_kg_female)}</dd>
        </div>
      </dl>
    </Card>
  )
}
