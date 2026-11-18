import { useState } from 'react'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, FormPage, PageHeader, Skeleton, TabBar } from '../components/ui'
import ReportBuilder from '../components/reports/ReportBuilder'
import SchedulesPanel from '../components/reports/SchedulesPanel'
import DeliveryLog from '../components/reports/DeliveryLog'
import { datasetLabel } from '../components/reports/labels'
import { api } from '../convex/_generated/api'
import { useT } from '../lib/i18n/context'
import { usePermission } from '../hooks/usePermission'

function SavedReports({ reports, selected, onSelect }) {
  const t = useT()
  const canManage = usePermission('reports.manage')
  return (
    <Card>
      <CardHeader
        title={t('reportBuilder.saved.title')}
        action={
          canManage && (
            <Button size="sm" variant="secondary" onClick={() => onSelect(null)}>
              {t('reportBuilder.saved.new')}
            </Button>
          )
        }
      />
      {reports.length ? (
        <ul className="-mx-2 space-y-1">
          {reports.map((r) => (
            <li key={r._id}>
              <button
                type="button"
                onClick={() => onSelect(r._id)}
                aria-current={selected === r._id ? 'true' : undefined}
                className={`w-full rounded-lg px-2 py-2 text-left text-sm ${
                  selected === r._id ? 'bg-foam text-chart-ink' : 'hover:bg-foam/60'
                }`}
              >
                <span className="block font-medium">{r.name}</span>
                <span className="block text-xs text-muted">
                  {datasetLabel(t, r.definition.dataset)} ·{' '}
                  {r.visibility === 'company' ? t('reportBuilder.visibility.company') : t('reportBuilder.visibility.private')}
                  {r.visibility === 'company' && ` · ${r.createdByName}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t('reportBuilder.saved.empty')}</p>
      )}
    </Card>
  )
}

function ReportsTab() {
  const router = useRouter()
  const reports = useQuery(api.reportBuilder.list, {})
  const selected = typeof router.query.report === 'string' ? router.query.report : null
  const select = (id) =>
    router.replace({ pathname: '/reports', query: id ? { report: id } : {} }, undefined, { shallow: true })
  if (reports === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  const report = reports.find((r) => r._id === selected) ?? null
  return (
    <div className="space-y-6">
      <SavedReports reports={reports} selected={report?._id ?? null} onSelect={select} />
      <ReportBuilder key={report?._id ?? 'new'} report={report} onSaved={select} onDeleted={() => select(null)} />
    </div>
  )
}

function ReportsPage() {
  const t = useT()
  const canManage = usePermission('reports.manage')
  const [tab, setTab] = useState('reports')
  const tabs = [
    { id: 'reports', label: t('reportBuilder.tabs.reports') },
    { id: 'schedules', label: t('reportBuilder.tabs.schedules') },
    ...(canManage ? [{ id: 'log', label: t('reportBuilder.tabs.log') }] : []),
  ]
  return (
    <FormPage width="full">
      <PageHeader
        showTitle={false}
        breadcrumbs={[{ label: t('reportBuilder.crumbs.dashboard'), href: '/dashboard' }, { label: t('reportBuilder.title') }]}
        description={t('reportBuilder.description')}
        related={[
          { label: t('reportBuilder.related.production'), href: '/report' },
          { label: t('reportBuilder.related.export'), href: '/export' },
        ]}
      />
      <div className="space-y-6">
        <TabBar tabs={tabs} active={tab} onChange={setTab} label={t('reportBuilder.title')} />
        {tab === 'reports' && <ReportsTab />}
        {tab === 'schedules' && <SchedulesPanel />}
        {tab === 'log' && canManage && <DeliveryLog />}
      </div>
    </FormPage>
  )
}

export default function Reports() {
  const t = useT()
  return (
    <ProtectedRoute permission="reports.view">
      <Layout title={t('reportBuilder.title')}>
        <ReportsPage />
      </Layout>
    </ProtectedRoute>
  )
}
