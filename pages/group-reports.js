import { useState } from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import SiteKpiTable, { monthToDate } from '../components/SiteKpiTable'
import { Download, Plus } from 'lucide-react'
import { Field, GradientButton, Input } from '../components/ui'
import NavTabs from '../components/ui/NavTabs'
import { api } from '../convex/_generated/api'
import { localToday } from '../lib/format'
import { reportTabs } from '../lib/sectionTabs'
import { useT } from '../lib/i18n/context'
import { usePermission } from '../hooks/usePermission'

function GroupReports() {
  const t = useT()
  const [range, setRange] = useState(() => monthToDate(localToday()))
  const [selected, setSelected] = useState(null)
  const valid = range.from && range.to && range.from <= range.to
  const data = useQuery(api.groupReports.overview, valid ? range : 'skip')
  const detail = useQuery(
    api.groupReports.subsidiarySites,
    valid && selected ? { ...range, childCompanyId: selected.companyId } : 'skip',
  )
  const rows = (data?.rows || []).map((r) => ({
    ...r,
    key: r.companyId,
    hint: r.isSelf ? t('ent.group.yourOrg') : r.code,
    selectable: !r.isSelf,
  }))
  const currencies = new Set(rows.map((r) => r.currency))
  const canExport = usePermission('reports.export')
  const canLink = usePermission('org.structure.manage')
  // Paper 68 "Group total" row: only when every company reports in one currency.
  const total =
    rows.length > 1 && currencies.size === 1
      ? {
          key: 'total',
          name: t('ent.group.total'),
          hint: t('ent.group.totalSub', { count: rows.length }),
          currency: rows[0].currency,
          ...Object.fromEntries(
            ['sites', 'activeUnits', 'fish', 'harvestKg', 'salesAmount', 'expensesAmount', 'overdueMaintenance'].map((k) => [
              k,
              rows.reduce((sum, r) => sum + (r[k] || 0), 0),
            ]),
          ),
        }
      : null

  return (
    <Layout
      title={t('ent.group.pageTitle')}
      eyebrow={t('ent.group.eyebrow')}
      actions={
        <>
          {canExport && (
            <GradientButton variant="lime" href="/export" icon={Download}>
              {t('ops.reports.export')}
            </GradientButton>
          )}
          {canLink && (
            <GradientButton ring="sky" href="/organization-structure" icon={Plus}>
              {t('ent.group.linkCompany')}
            </GradientButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-[28px]">
        <NavTabs tabs={reportTabs(t)} label={t('ops.tabs.reports')} />
        <p className="max-w-[720px] text-[13px] leading-5 text-muted">{t('ent.group.description')}</p>
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field label={t('ent.common.from')} htmlFor="gr-from">
            <Input id="gr-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </Field>
          <Field label={t('ent.common.to')} htmlFor="gr-to">
            <Input id="gr-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </Field>
        </div>
        <section
          aria-labelledby="gr-companies"
          className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-card)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
            <div className="flex flex-wrap items-center gap-x-[20px] gap-y-1">
              <h2 id="gr-companies" className="text-[17px] font-semibold leading-[22px] text-text">
                {t('ent.group.comparison')}
              </h2>
              <p className="text-[13px] leading-4 text-muted">{t('ent.group.comparisonHint')}</p>
            </div>
          </div>
          {!data ? (
            <p className="px-6 py-[14px] text-[13px] leading-5 text-muted">{t('common.loading')}</p>
          ) : rows.length <= 1 ? (
            <>
              <SiteKpiTable rows={rows} showSites />
              <div className="border-t border-line px-6 py-[14px]">
                <p className="text-[14px] leading-[18px] text-text">{t('ent.group.noSubsidiaries')}</p>
                <p className="mt-[2px] text-xs leading-4 text-muted">{t('ent.group.noSubsidiariesHint')}</p>
              </div>
            </>
          ) : (
            <SiteKpiTable rows={rows} showSites onSelect={(r) => setSelected(r)} footer={total} />
          )}
          {currencies.size > 1 && <p className="border-t border-line px-6 py-3 text-[13px] leading-5 text-muted">{t('ent.group.currencies')}</p>}
          {rows.some((r) => r.truncated) && <p className="border-t border-line px-6 py-3 text-[13px] leading-5 text-muted">{t('ent.common.truncated')}</p>}
        </section>
        {selected && (
          <section
          aria-labelledby="gr-sites"
          className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-card)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
            <h2 id="gr-sites" className="text-[17px] font-semibold leading-[22px] text-text">
              {t('ent.group.sitesOf', { name: selected.name })}
            </h2>
          </div>
            {!detail ? (
              <p className="px-6 py-[14px] text-[13px] leading-5 text-muted">{t('common.loading')}</p>
            ) : (
              <SiteKpiTable rows={detail.sites.map((s) => ({ ...s, key: s.siteId }))} currency={detail.currency} />
            )}
          </section>
        )}
      </div>
    </Layout>
  )
}

export default function GroupReportsPage() {
  return (
    <ProtectedRoute permission="group.reports.view">
      <GroupReports />
    </ProtectedRoute>
  )
}
