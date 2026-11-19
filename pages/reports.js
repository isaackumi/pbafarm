import { useRouter } from 'next/router'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { BarChart3, Boxes, Download, FileText, Globe2, Layers, LineChart, Plus, Wallet } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { GradientButton, Skeleton } from '../components/ui'
import NavTabs from '../components/ui/NavTabs'
import ReportBuilder from '../components/reports/ReportBuilder'
import SchedulesPanel, { describeSchedule } from '../components/reports/SchedulesPanel'
import DeliveryLog from '../components/reports/DeliveryLog'
import { datasetLabel } from '../components/reports/labels'
import { api } from '../convex/_generated/api'
import { useT } from '../lib/i18n/context'
import { usePermission, usePermissions } from '../hooks/usePermission'
import { routePermission } from '../lib/routePermissions'

/** Built-in report pages shown in the library next to saved reports. */
const STANDARD = [
  { href: '/report', icon: FileText, title: 'ops.reports.std.production', sub: 'ops.reports.std.productionSub' },
  { href: '/pnl', icon: Wallet, title: 'ops.reports.std.pnl', sub: 'ops.reports.std.pnlSub' },
  { href: '/analytics', icon: LineChart, title: 'ops.reports.std.analytics', sub: 'ops.reports.std.analyticsSub' },
  { href: '/inventory/overview', icon: Boxes, title: 'ops.reports.std.inventory', sub: 'ops.reports.std.inventorySub' },
  { href: '/reports/regions', icon: Globe2, title: 'ops.reports.std.regions', sub: 'ops.reports.std.regionsSub' },
  { href: '/group-reports', icon: Layers, title: 'ops.reports.std.group', sub: 'ops.reports.std.groupSub' },
]

/** Paper 11 library card: icon tile, title, muted sub, footer with cadence and Open →. */
function ReportCard({ icon: Icon, title, sub, footer, href, onOpen, current }) {
  const t = useT()
  const openCls =
    'rounded-sm text-[13px] leading-4 text-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
  return (
    <li
      className={`flex flex-col gap-[14px] rounded-card border bg-surface px-5 py-6 shadow-[var(--shadow-card)] sm:px-[26px] ${
        current ? 'border-line-strong' : 'border-line'
      }`}
    >
      <span className="flex size-[36px] shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-pearl-cyan" aria-hidden>
        <Icon size={16} strokeWidth={2} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="truncate text-[15px] font-semibold leading-[18px] text-text">{title}</h3>
        <p className="truncate text-[13px] leading-4 text-muted">{sub}</p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="truncate text-xs leading-4 text-faint">{footer}</span>
        {href ? (
          <Link href={href} className={openCls} aria-label={`${t('ops.reports.open')} ${title}`}>
            {t('ops.reports.openArrow')}
          </Link>
        ) : (
          <button type="button" onClick={onOpen} className={openCls} aria-label={`${t('ops.reports.open')} ${title}`} aria-current={current ? 'true' : undefined}>
            {t('ops.reports.openArrow')}
          </button>
        )}
      </div>
    </li>
  )
}

function Library({ selected, onSelect }) {
  const t = useT()
  const { can } = usePermissions()
  const reports = useQuery(api.reportBuilder.list, {})
  const schedules = useQuery(api.reportSchedules.list, {})
  if (reports === undefined) {
    return (
      <div className="grid gap-[20px] md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  const scheduleFor = (id) => (schedules || []).find((s) => s.reportId === id && s.enabled)
  const report = selected && selected !== 'new' ? reports.find((r) => r._id === selected) ?? null : null
  const standard = STANDARD.filter((s) => can(routePermission(s.href)))
  return (
    <div className="flex flex-col gap-[28px]">
      <ul className="grid gap-[20px] md:grid-cols-2 xl:grid-cols-3">
        {standard.map((s) => (
          <ReportCard key={s.href} icon={s.icon} title={t(s.title)} sub={t(s.sub)} footer={t('ops.reports.onDemand')} href={s.href} />
        ))}
        {reports.map((r) => {
          const schedule = scheduleFor(r._id)
          return (
            <ReportCard
              key={r._id}
              icon={BarChart3}
              title={r.name}
              sub={`${datasetLabel(t, r.definition.dataset)} · ${
                r.visibility === 'company' ? t('reportBuilder.visibility.company') : t('reportBuilder.visibility.private')
              }${r.visibility === 'company' ? ` · ${r.createdByName}` : ''}`}
              footer={schedule ? describeSchedule(t, schedule) : t('ops.reports.onDemand')}
              onOpen={() => onSelect(r._id)}
              current={report?._id === r._id}
            />
          )
        })}
      </ul>
      {reports.length === 0 && <p className="text-[13px] leading-5 text-muted">{t('reportBuilder.saved.empty')}</p>}
      {(report || selected === 'new') && (
        <section aria-label={report ? report.name : t('reportBuilder.saved.new')}>
          <ReportBuilder key={report?._id ?? 'new'} report={report} onSaved={onSelect} onDeleted={() => onSelect(null)} />
        </section>
      )}
    </div>
  )
}

function ReportsPage() {
  const t = useT()
  const router = useRouter()
  const canManage = usePermission('reports.manage')
  const canExport = usePermission('reports.export')
  const tab = ['schedules', 'log'].includes(router.query.tab) ? router.query.tab : 'library'
  const selected = typeof router.query.report === 'string' ? router.query.report : null
  const go = (query) => router.replace({ pathname: '/reports', query }, undefined, { shallow: true })
  const select = (id) => go(id ? { report: id } : {})
  const tabs = [
    { href: '/reports', label: t('ops.reports.library'), permission: 'reports.view' },
    { href: '/reports?tab=schedules', label: t('ops.reports.scheduled'), permission: 'reports.view' },
    ...(canManage ? [{ href: '/reports?tab=log', label: t('ops.reports.exports'), permission: 'reports.manage' }] : []),
  ]
  return (
    <Layout
      title={t('reportBuilder.title')}
      eyebrow={t('ops.reports.eyebrow')}
      actions={
        <>
          {canExport && (
            <GradientButton href="/export" icon={Download}>
              {t('ops.reports.export')}
            </GradientButton>
          )}
          {canManage && (
            <GradientButton reverse icon={Plus} onClick={() => select('new')}>
              {t('ops.reports.newReport')}
            </GradientButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-[28px]">
        <NavTabs tabs={tabs} active={tab === 'library' ? '/reports' : `/reports?tab=${tab}`} label={t('reportBuilder.title')} />
        {tab === 'library' && <Library selected={selected} onSelect={select} />}
        {tab === 'schedules' && <SchedulesPanel />}
        {tab === 'log' && canManage && <DeliveryLog />}
      </div>
    </Layout>
  )
}

export default function Reports() {
  return (
    <ProtectedRoute permission="reports.view">
      <ReportsPage />
    </ProtectedRoute>
  )
}
