import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { getConvexAuthToken } from '../lib/convexBridge'
import { localToday } from '../lib/format'
import { StatusDot } from './ui'
import { useT } from '../lib/i18n/context'

const SEVERITY = {
  critical: { tone: 'alert', key: 'critical', label: 'Critical' },
  warning: { tone: 'warn', key: 'warning', label: 'Warning' },
  info: { tone: 'good', key: 'note', label: 'Note' },
}

/**
 * Up to three grounded insights (assistant.forDashboard): computed from the
 * rollups by fixed rules, so every number is the farm's own. When the
 * company has the assistant on, the server may reword them
 * (/api/llm/insights); a reworded line is only shown if it keeps the facts.
 */
export default function DashboardInsights({ locationId, aiEnabled, title, className = '' }) {
  const t = useT()
  const asOf = localToday()
  const insights = useQuery(api.assistant.forDashboard, {
    asOf,
    ...(locationId ? { locationId } : {}),
  })
  const [phrased, setPhrased] = useState({})
  const key = insights ? insights.map((i) => i.id + i.title).join('|') : ''

  useEffect(() => {
    if (!aiEnabled || !insights?.length) return
    let cancelled = false
    const token = getConvexAuthToken()
    fetch('/api/llm/insights', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ asOf, ...(locationId ? { locationId } : {}) }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.insights) return
        setPhrased(Object.fromEntries(body.insights.filter((i) => i.phrased).map((i) => [i.id, i.phrased])))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Re-phrase only when the insights themselves change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiEnabled, key])

  if (!insights?.length) return null

  return (
    <section
      aria-labelledby="dashboard-insights-title"
      className={`flex flex-col gap-1 rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)] ${className}`}
    >
      <div className="flex items-center justify-between gap-3 pb-[10px]">
        <div>
          <h2 id="dashboard-insights-title" className="text-[15px] font-semibold leading-[18px] text-text">
            {title || t('home.insightsTitle')}
          </h2>
          <p className="mt-1 text-xs leading-4 text-muted">{t('home.insightsSubtitle')}</p>
        </div>
        <Link
          href="/analytics"
          className="rounded-sm text-xs leading-4 text-muted underline-offset-2 hover:text-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          {t('home.openAnalytics')}
        </Link>
      </div>
      <ul>
        {insights.map((i) => {
          const s = SEVERITY[i.severity] || SEVERITY.info
          return (
            <li key={i.id} className="flex items-center gap-[14px] border-t border-line py-[11px]">
              <StatusDot tone={s.tone} size={7} />
              <div className="flex min-w-0 grow basis-0 flex-col gap-[2px]">
                <p className="text-[14px] leading-[18px] text-text">
                  <span className="sr-only">{t.or(`home.severity.${s.key}`, s.label)}: </span>
                  {phrased[i.id] || i.title}
                </p>
                <p className="text-xs leading-4 text-muted">{i.detail}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
