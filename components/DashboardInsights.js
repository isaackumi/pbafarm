import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { getConvexAuthToken } from '../lib/convexBridge'
import { localToday } from '../lib/format'
import { Card, CardHeader } from './ui'

const SEVERITY = {
  critical: { icon: CircleAlert, label: 'Critical', className: 'text-signal' },
  warning: { icon: TriangleAlert, label: 'Warning', className: 'text-amber-600 dark:text-amber-400' },
  info: { icon: Info, label: 'Note', className: 'text-lake' },
}

/**
 * Up to three grounded insights (assistant.forDashboard): computed from the
 * rollups by fixed rules, so every number is the farm's own. When the
 * company has the assistant on, the server may reword them
 * (/api/llm/insights); a reworded line is only shown if it keeps the facts.
 */
export default function DashboardInsights({ locationId, aiEnabled }) {
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
    <Card>
      <CardHeader
        title="Insights"
        subtitle="From your recorded data, by fixed rules"
        action={
          <Link href="/analytics" className="text-sm text-lake hover:underline">
            Open analytics
          </Link>
        }
      />
      <ul className="space-y-4">
        {insights.map((i) => {
          const s = SEVERITY[i.severity] || SEVERITY.info
          const Icon = s.icon
          return (
            <li key={i.id} className="flex gap-3">
              <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${s.className}`} aria-hidden />
              <div className="min-w-0">
                <p className="font-medium text-chart-ink">
                  <span className="sr-only">{s.label}: </span>
                  {phrased[i.id] || i.title}
                </p>
                <p className="text-sm text-muted mt-0.5">{i.detail}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
