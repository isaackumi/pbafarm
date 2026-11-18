import { useState } from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import SiteKpiTable, { monthToDate } from '../components/SiteKpiTable'
import { Card, CardHeader, EmptyState, Field, FormPage, Input, PageHeader } from '../components/ui'
import { api } from '../convex/_generated/api'
import { localToday } from '../lib/format'
import { useT } from '../lib/i18n/context'

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

  return (
    <FormPage width="full">
      <PageHeader
        title={t('ent.group.title')}
        breadcrumbs={[{ label: t('nav.item.dashboard'), href: '/dashboard' }, { label: t('ent.group.title') }]}
        description={t('ent.group.description')}
        related={[{ label: t('ent.structure.title'), href: '/organization-structure' }]}
      />
      <div className="space-y-6">
        <Card>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <Field label={t('ent.common.from')} htmlFor="gr-from">
              <Input id="gr-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            </Field>
            <Field label={t('ent.common.to')} htmlFor="gr-to">
              <Input id="gr-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </Field>
          </div>
        </Card>
        <Card padding={false}>
          {!data ? (
            <p className="p-5 text-sm text-muted">{t('common.loading')}</p>
          ) : rows.length <= 1 ? (
            <>
              <SiteKpiTable rows={rows} showSites />
              <EmptyState title={t('ent.group.noSubsidiaries')} description={t('ent.group.noSubsidiariesHint')} />
            </>
          ) : (
            <SiteKpiTable rows={rows} showSites onSelect={(r) => setSelected(r)} />
          )}
          {currencies.size > 1 && <p className="px-5 py-3 text-sm text-muted">{t('ent.group.currencies')}</p>}
          {rows.some((r) => r.truncated) && <p className="px-5 py-3 text-sm text-muted">{t('ent.common.truncated')}</p>}
        </Card>
        {selected && (
          <Card padding={false}>
            <div className="px-5 pt-4">
              <CardHeader title={t('ent.group.sitesOf', { name: selected.name })} />
            </div>
            {!detail ? (
              <p className="p-5 text-sm text-muted">{t('common.loading')}</p>
            ) : (
              <SiteKpiTable rows={detail.sites.map((s) => ({ ...s, key: s.siteId }))} currency={detail.currency} />
            )}
          </Card>
        )}
      </div>
    </FormPage>
  )
}

export default function GroupReportsPage() {
  return (
    <ProtectedRoute permission="group.reports.view">
      <Layout title="Group reports">
        <GroupReports />
      </Layout>
    </ProtectedRoute>
  )
}
