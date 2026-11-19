import { useState } from 'react'
import { useMutation } from 'convex/react'
import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { alertText } from '../convex/lib/earlyWarning'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from '../hooks/usePermission'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { errorMessage } from '../lib/errorMessage'
import { useLocale, useT } from '../lib/i18n/context'
import { useToast } from './Toast'
import { Button, Card, CardHeader } from './ui'

const SEVERITY = {
  critical: { icon: CircleAlert, className: 'text-signal' },
  warning: { icon: TriangleAlert, className: 'text-warn' },
  info: { icon: Info, className: 'text-lake' },
}

/**
 * Early-warning alerts (AI-001): open and acknowledged alerts the engine
 * raised from the farm's own records, in the caller's sites. Shown on the
 * dashboard (all units, or one site) and on a unit page (`unitId`).
 */
export default function FarmAlerts({ locationId, unitId, compact = false }) {
  const t = useT()
  const { locale } = useLocale()
  const lang = String(locale || 'en').startsWith('fr') ? 'fr' : 'en'
  const { canUseApp } = useAuth()
  const canView = usePermission('production.view')
  const canAct = usePermission('production.daily.record')
  const alerts = useOptionalQuery(
    api.farmAlerts.list,
    canUseApp && canView ? { ...(locationId ? { locationId } : {}), ...(unitId ? { unitId } : {}) } : 'skip',
  )
  const acknowledge = useMutation(api.farmAlerts.acknowledge)
  const resolve = useMutation(api.farmAlerts.resolve)
  const { showToast } = useToast()
  const [busy, setBusy] = useState(null)

  if (!alerts?.length) return null

  const act = async (fn, alertId, done) => {
    setBusy(alertId)
    try {
      await fn({ alertId })
      showToast('success', done)
    } catch (err) {
      showToast('error', errorMessage(err, t('farmAlerts.failed')))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader title={t('farmAlerts.title')} subtitle={compact ? undefined : t('farmAlerts.subtitle')} />
      <ul className="space-y-4">
        {alerts.slice(0, compact ? 5 : 8).map((a) => {
          const s = SEVERITY[a.severity] || SEVERITY.info
          const Icon = s.icon
          const text = alertText(a, lang)
          return (
            <li key={a._id} className="flex gap-3">
              <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${s.className}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-chart-ink">
                  <span className="sr-only">{t(`farmAlerts.severity.${a.severity}`)}: </span>
                  {text.title}
                </p>
                <p className="text-sm text-muted">{text.detail}</p>
                {text.actions.length ? (
                  <ul className="mt-1 list-disc pl-5 text-sm text-muted">
                    {text.actions.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-1 text-xs text-muted">
                  {t(`farmAlerts.status.${a.status}`)} · {t('farmAlerts.since', { date: a.date })}
                </p>
                {canAct ? (
                  <div className="mt-2 flex gap-2">
                    {a.status === 'open' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === a._id}
                        onClick={() => act(acknowledge, a._id, t('farmAlerts.acknowledged'))}
                      >
                        {t('farmAlerts.acknowledge')}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === a._id}
                      onClick={() => act(resolve, a._id, t('farmAlerts.resolved'))}
                    >
                      {t('farmAlerts.resolve')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
