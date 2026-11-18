import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../lib/i18n/context'
import { Button, Card, CardHeader, EmptyState } from './ui'
import { kg } from './RationSuggestion'

/** Dashboard widget (CUSTOM-005 × PROD-015): today's suggested feed across stocked units. */
export default function FeedingPlanWidget({ locationId }) {
  const t = useT()
  const { canUseApp } = useAuth()
  const data = useQuery(api.feedingPlans.rations, canUseApp ? (locationId ? { locationId } : {}) : 'skip')
  return (
    <Card>
      <CardHeader
        title={t('feedingPlan.widgetTitle')}
        subtitle={t('feedingPlan.widgetSubtitle')}
        action={
          <Button href="/feeding-plans" variant="ghost" size="sm">
            {t('feedingPlan.open')}
          </Button>
        }
      />
      {data === undefined ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : data.rows.length === 0 ? (
        <EmptyState title={t('feedingPlan.noUnits')} />
      ) : (
        <div className="space-y-3">
          <p className="font-display text-3xl font-medium tabular-nums text-chart-ink">
            {kg(data.totalKgPerDay)} <span className="text-base text-muted">{t('feedingPlan.kgPerDay')}</span>
          </p>
          <p className="text-sm text-muted">
            {t('feedingPlan.coverage', { planned: data.planned, total: data.rows.length })}
          </p>
          <ul className="text-sm divide-y divide-foam-deep">
            {data.rows
              .filter((r) => r.ration.ok)
              .slice(0, 5)
              .map((r) => (
                <li key={r.cageId} className="py-1.5 flex justify-between gap-2">
                  <span className="truncate">{r.cageName}</span>
                  <span className="tabular-nums">{kg(r.ration.kgPerDay)} kg</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
