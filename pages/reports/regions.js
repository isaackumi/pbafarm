import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import SiteKpiTable, { monthToDate } from '../../components/SiteKpiTable'
import { Card, EmptyState, Field, FormPage, Input, PageHeader, Select } from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { localToday } from '../../lib/format'
import { useT } from '../../lib/i18n/context'

/** Per-site KPIs with a region / business unit filter (FARM-004). */
function RegionalReport() {
  const t = useT()
  const [range, setRange] = useState(() => monthToDate(localToday()))
  const [unitId, setUnitId] = useState('')
  const valid = range.from && range.to && range.from <= range.to
  const data = useQuery(
    api.businessUnits.siteReport,
    valid ? { ...range, businessUnitId: unitId || undefined } : 'skip',
  )
  const unitName = useMemo(() => new Map((data?.units || []).map((u) => [u._id, u.name])), [data])
  const rows = (data?.sites || []).map((s) => ({
    ...s,
    key: s.siteId,
    hint: s.businessUnitId ? unitName.get(s.businessUnitId) : null,
  }))
  const hasUnassigned = !unitId && data && Object.values(data.unassigned).some((n) => n > 0)

  return (
    <FormPage width="full">
      <PageHeader
        title={t('ent.regions.title')}
        breadcrumbs={[{ label: t('nav.item.dashboard'), href: '/dashboard' }, { label: t('ent.regions.title') }]}
        description={t('ent.regions.description')}
        related={[
          { label: t('ent.structure.title'), href: '/organization-structure' },
          { label: t('nav.item.report'), href: '/report' },
        ]}
      />
      <div className="space-y-6">
        <Card>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label={t('ent.common.from')} htmlFor="rr-from">
              <Input id="rr-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            </Field>
            <Field label={t('ent.common.to')} htmlFor="rr-to">
              <Input id="rr-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </Field>
            <Field label={t('ent.regions.unit')} htmlFor="rr-unit">
              <Select id="rr-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="">{t('ent.regions.allUnits')}</option>
                {(data?.units || []).map((u) => (
                  <option key={u._id} value={u._id}>{u.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
        <Card padding={false}>
          {!data ? (
            <p className="p-5 text-sm text-muted">{t('common.loading')}</p>
          ) : rows.length === 0 ? (
            <EmptyState title={t('ent.regions.empty')} />
          ) : (
            <SiteKpiTable
              rows={hasUnassigned ? [...rows, { ...data.unassigned, key: 'none', name: t('ent.regions.noSite') }] : rows}
              currency={data.currency}
              footer={{ ...data.totals, key: 'total', name: t('ent.common.total') }}
            />
          )}
          {data?.truncated && <p className="px-5 py-3 text-sm text-muted">{t('ent.common.truncated')}</p>}
        </Card>
      </div>
    </FormPage>
  )
}

export default function RegionalReportPage() {
  return (
    <ProtectedRoute permission="reports.view">
      <Layout title="Regional report">
        <RegionalReport />
      </Layout>
    </ProtectedRoute>
  )
}
