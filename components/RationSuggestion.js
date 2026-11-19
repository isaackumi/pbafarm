import Link from 'next/link'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from '../hooks/usePermission'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { useLocale, useT } from '../lib/i18n/context'
import { rationReasons } from '../convex/lib/ration'

export const kg = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 })

/** One line describing a ration (or why there is none). */
export function rationText(t, ration) {
  if (!ration) return ''
  if (!ration.ok) return t(`feedingPlan.reason.${ration.reason}`)
  return t('feedingPlan.suggestion', {
    kg: kg(ration.kgPerDay),
    feedings: ration.feedingsPerDay,
    perFeeding: kg(ration.kgPerFeeding),
    pellet: ration.pelletMm,
  })
}

/** The worked reason for a ration (AI-002): ABW × fish × temperature → % BW → kg/day. */
export function rationWhy(row, locale) {
  if (!row?.ration?.ok || row.abwG == null) return ''
  return rationReasons(
    row.ration,
    { count: row.count, abwG: row.abwG, abwMeasuredOn: row.abwMeasuredOn, tempSource: row.tempSource },
    String(locale || 'en').startsWith('fr') ? 'fr' : 'en',
  )
}

/**
 * Suggested ration for one unit from the feeding plan (PROD-015), with its
 * reasons (AI-002). Read-only: entry forms show it next to the feed input;
 * it never fills the input, and a failed lookup shows nothing rather than
 * blocking the form. `detailed` adds how the fish count was estimated.
 */
export default function RationSuggestion({ cageId, className = '', detailed = false }) {
  const t = useT()
  const { locale } = useLocale()
  const { canUseApp } = useAuth()
  const canView = usePermission('production.view')
  const data = useOptionalQuery(api.feedingPlans.rationForCage, canUseApp && canView && cageId ? { cageId } : 'skip')
  if (!data) return null
  const why = rationWhy(data, locale)
  const f = data.countFlows
  return (
    <div className={`text-sm text-muted ${className}`} role="note">
      <p>
        <span className="font-medium text-chart-ink">{t('feedingPlan.suggestedRation')}: </span>
        {rationText(t, data.ration)}{' '}
        <Link href="/feeding-plans" className="underline hover:text-chart-ink">
          {t('feedingPlan.seePlan')}
        </Link>
      </p>
      {why ? (
        <p>
          <span className="font-medium text-chart-ink">{t('feedingPlan.why')}: </span>
          {why}
        </p>
      ) : null}
      {detailed && f ? (
        <p>
          {t('feedingPlan.countFrom', {
            stocked: kg(f.stocked),
            transferredIn: kg(f.transferredIn),
            transferredOut: kg(f.transferredOut),
            harvested: kg(f.harvested),
            mortality: kg(f.mortality),
            unaccounted: kg(f.unaccounted),
            count: kg(data.count),
          })}
        </p>
      ) : null}
      {why ? <p className="text-xs">{t('feedingPlan.neverApplied')}</p> : null}
    </div>
  )
}
