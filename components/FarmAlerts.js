import { useState } from 'react'
import Link from 'next/link'
import { useMutation } from 'convex/react'
import { api } from '../convex/_generated/api'
import { alertText } from '../convex/lib/earlyWarning'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from '../hooks/usePermission'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { errorMessage } from '../lib/errorMessage'
import { useLocale, useT } from '../lib/i18n/context'
import { useToast } from './Toast'

/** Severity → bar and label colour (Paper 42). The label text always names the severity. */
export const SEVERITY_TONE = {
  critical: { bar: 'bg-alert', text: 'text-alert' },
  warning: { bar: 'bg-warn', text: 'text-warn' },
  info: { bar: 'bg-pearl-cyan', text: 'text-pearl-cyan' },
}

const ACTION_BUTTON =
  'rounded-pill border border-line-strong px-[14px] py-2 text-sm leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50 disabled:cursor-not-allowed'

export function useAlertLang() {
  const { locale } = useLocale()
  return String(locale || 'en').startsWith('fr') ? 'fr' : 'en'
}

/** Acknowledge / resolve with a toast; `busy` is the alert being updated. */
export function useAlertActions() {
  const t = useT()
  const acknowledge = useMutation(api.farmAlerts.acknowledge)
  const resolve = useMutation(api.farmAlerts.resolve)
  const { showToast } = useToast()
  const [busy, setBusy] = useState(null)
  const run = async (fn, alertId, done) => {
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
  return {
    busy,
    acknowledge: (id) => run(acknowledge, id, t('farmAlerts.acknowledged')),
    resolve: (id) => run(resolve, id, t('farmAlerts.resolved')),
  }
}

/** One alert: severity bar and label, title, evidence, suggested actions and buttons. */
export function AlertRow({ alert: a, lang, canAct, actions, compact = false }) {
  const t = useT()
  const tone = SEVERITY_TONE[a.severity] || SEVERITY_TONE.info
  const text = alertText(a, lang)
  return (
    <li className={`flex gap-4 border-b border-line last:border-b-0 ${compact ? 'py-4' : 'px-5 py-[18px]'}`}>
      <div className={`w-1 shrink-0 rounded-[4px] ${tone.bar}`} aria-hidden />
      <div className="flex min-w-0 grow basis-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-[10px] gap-y-1">
          <span className={`text-[11px] font-semibold uppercase leading-[14px] tracking-[0.08em] ${tone.text}`}>
            {t(`farmAlerts.severity.${a.severity}`)}
          </span>
          <span className="text-base font-semibold leading-[18px] text-text">{text.title}</span>
          <span className="text-xs leading-4 text-faint">
            {t(`farmAlerts.status.${a.status}`)} · {t('farmAlerts.since', { date: a.date })}
          </span>
        </div>
        <p className="text-sm leading-[19px] text-muted">{text.detail}</p>
        {text.actions.length ? (
          <ul className="flex flex-wrap gap-2" aria-label={t('farmAlerts.suggestedActions')}>
            {text.actions.map((x) => (
              <li key={x} className="rounded-[6px] bg-surface-2 px-[10px] py-[6px] text-xs leading-4 text-pearl-cyan">
                {x}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {canAct && a.status !== 'resolved' ? (
        <div className="flex shrink-0 flex-col items-end gap-2">
          {a.status === 'open' ? (
            <button
              type="button"
              className={ACTION_BUTTON}
              disabled={actions.busy === a._id}
              onClick={() => actions.acknowledge(a._id)}
            >
              {t('farmAlerts.acknowledge')}
            </button>
          ) : null}
          <button
            type="button"
            className={ACTION_BUTTON}
            disabled={actions.busy === a._id}
            onClick={() => actions.resolve(a._id)}
          >
            {t('farmAlerts.resolve')}
          </button>
        </div>
      ) : null}
    </li>
  )
}

/**
 * Early-warning alerts (AI-001): open and acknowledged alerts the engine
 * raised from the farm's own records, in the caller's sites. Shown on the
 * dashboard (all units, or one site) and on a unit page (`unitId`). The full
 * list, with filters, is /alerts.
 */
export default function FarmAlerts({ locationId, unitId, compact = false }) {
  const t = useT()
  const lang = useAlertLang()
  const { canUseApp } = useAuth()
  const canView = usePermission('production.view')
  const canAct = usePermission('production.daily.record')
  const alerts = useOptionalQuery(
    api.farmAlerts.list,
    canUseApp && canView ? { ...(locationId ? { locationId } : {}), ...(unitId ? { unitId } : {}) } : 'skip',
  )
  const actions = useAlertActions()

  if (!alerts?.length) return null
  const shown = alerts.slice(0, compact ? 5 : 8)

  return (
    <section className="rounded-card border border-line bg-surface shadow-[var(--shadow-card)]" aria-labelledby="farm-alerts-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="farm-alerts-title" className="text-base font-semibold leading-[18px] text-text">
            {t('farmAlerts.title')}
          </h2>
          {compact ? null : <p className="mt-1 text-xs leading-4 text-muted">{t('farmAlerts.subtitle')}</p>}
        </div>
        <Link
          href="/alerts"
          className="text-xs leading-4 text-muted underline-offset-2 hover:text-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan rounded-sm"
        >
          {t('farmAlerts.seeAll', { count: alerts.length })}
        </Link>
      </div>
      <ul>
        {shown.map((a) => (
          <AlertRow key={a._id} alert={a} lang={lang} canAct={canAct} actions={actions} />
        ))}
      </ul>
    </section>
  )
}
