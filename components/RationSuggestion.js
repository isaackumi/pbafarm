import Link from 'next/link'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from '../hooks/usePermission'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { useT } from '../lib/i18n/context'

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

/**
 * Suggested ration for one unit from the feeding plan (PROD-015). Read-only:
 * entry forms show it next to the feed input; it never fills the input, and
 * a failed lookup shows nothing rather than blocking the form.
 */
export default function RationSuggestion({ cageId, className = '' }) {
  const t = useT()
  const { canUseApp } = useAuth()
  const canView = usePermission('production.view')
  const data = useOptionalQuery(api.feedingPlans.rationForCage, canUseApp && canView && cageId ? { cageId } : 'skip')
  if (!data) return null
  return (
    <p className={`text-sm text-muted ${className}`} role="note">
      <span className="font-medium text-chart-ink">{t('feedingPlan.suggestedRation')}: </span>
      {rationText(t, data.ration)}{' '}
      <Link href="/feeding-plans" className="underline hover:text-chart-ink">
        {t('feedingPlan.seePlan')}
      </Link>
    </p>
  )
}
