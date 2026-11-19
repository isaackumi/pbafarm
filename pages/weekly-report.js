import { useState } from 'react'
import { useAction } from 'convex/react'
import { RefreshCw } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, EmptyState, PageHeader } from '../components/ui'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { errorMessage } from '../lib/errorMessage'
import { useLocale, useT } from '../lib/i18n/context'

/**
 * Weekly farm report (AI-003): per site and company-wide, written every
 * Monday for the week before. Numbers come from the records; the assistant
 * only phrases them. Costs appear only for members who may see finance.
 */
export default function WeeklyReportPage() {
  const t = useT()
  return (
    <ProtectedRoute permission="reports.view">
      <Layout title={t('weeklyReport.title')}>
        <WeeklyReports />
      </Layout>
    </ProtectedRoute>
  )
}

function WeeklyReports() {
  const t = useT()
  const { locale } = useLocale()
  const lang = String(locale || 'en').startsWith('fr') ? 'fr' : 'en'
  const { canUseApp } = useAuth()
  const { locationArgs, activeLocation } = useLocation()
  const locationId = locationArgs?.locationId
  const reports = useOptionalQuery(api.aiReports.list, canUseApp ? { lang } : 'skip', [])
  const generate = useAction(api.aiReports.generateNow)
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  const run = async (args) => {
    setBusy(true)
    try {
      const r = await generate({ ...args, lang })
      showToast('success', r.source === 'llm' ? t('weeklyReport.doneAi') : t('weeklyReport.doneTemplate'))
    } catch (err) {
      showToast('error', errorMessage(err, t('weeklyReport.failed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        showTitle={false}
        breadcrumbs={[{ label: t('nav.item.dashboard'), href: '/dashboard' }, { label: t('weeklyReport.title') }]}
        description={t('weeklyReport.intro')}
      />
      <div className="flex flex-wrap gap-2">
        {locationId ? (
          <Button size="sm" disabled={busy} onClick={() => run({ locationId })}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            {t('weeklyReport.generateSite', { site: activeLocation?.name ?? '' })}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run({})}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t('weeklyReport.generateCompany')}
        </Button>
      </div>
      {reports.length === 0 ? (
        <EmptyState title={t('weeklyReport.emptyTitle')} description={t('weeklyReport.emptyBody')} />
      ) : (
        reports.map((r) => (
          <Card key={r._id}>
            <CardHeader
              title={t('weeklyReport.weekOf', { date: r.weekEnd, scope: r.siteName ?? t('weeklyReport.wholeCompany') })}
              subtitle={r.source === 'llm' ? t('weeklyReport.sourceAi') : t('weeklyReport.sourceTemplate')}
            />
            <div className="whitespace-pre-line text-sm text-chart-ink">{r.text}</div>
            {r.financeText ? (
              <div className="mt-4 whitespace-pre-line border-t border-line pt-3 text-sm text-chart-ink">{r.financeText}</div>
            ) : null}
          </Card>
        ))
      )}
    </div>
  )
}
