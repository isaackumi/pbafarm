import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import SiteKpiTable, { monthToDate } from '../../components/SiteKpiTable'
import { Field, Input, KpiStrip, Select } from '../../components/ui'
import NavTabs from '../../components/ui/NavTabs'
import { api } from '../../convex/_generated/api'
import { formatMoney, formatNumber, localToday } from '../../lib/format'
import { reportTabs } from '../../lib/sectionTabs'
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

  const totals = data?.totals

  return (
    <Layout title={t('ent.regions.title')} eyebrow={t('ops.reportsTab.eyebrow')}>
      <div className="flex flex-col gap-[28px]">
        <NavTabs tabs={reportTabs(t)} label={t('ops.tabs.reports')} />
        <p className="max-w-[720px] text-sm leading-5 text-muted">{t('ent.regions.description')}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:max-w-[720px]">
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
                <option key={u._id} value={u._id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <KpiStrip
          items={[
            { label: t('ent.kpi.activeUnits'), value: totals ? formatNumber(totals.activeUnits) : '—' },
            { label: t('ent.kpi.fish'), value: totals ? formatNumber(totals.fish) : '—' },
            { label: t('ent.kpi.harvestKg'), value: totals ? formatNumber(totals.harvestKg) : '—' },
            {
              label: t('ent.kpi.sales'),
              value: totals ? formatMoney(totals.salesAmount, { currency: data.currency || undefined, decimals: 0 }) : '—',
            },
          ]}
        />
        <section
          aria-labelledby="rr-sites"
          className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-card)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
            <h2 id="rr-sites" className="text-[17px] font-semibold leading-[22px] text-text">
              {t('ops.reportsTab.bySite')}
            </h2>
          </div>
          {!data ? (
            <p className="px-6 py-[14px] text-sm text-muted">{t('common.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="px-6 py-[14px] text-sm text-muted">{t('ent.regions.empty')}</p>
          ) : (
            <SiteKpiTable
              rows={hasUnassigned ? [...rows, { ...data.unassigned, key: 'none', name: t('ent.regions.noSite') }] : rows}
              currency={data.currency}
              footer={{ ...data.totals, key: 'total', name: t('ent.common.total') }}
            />
          )}
          {data?.truncated && <p className="border-t border-line px-6 py-3 text-sm text-muted">{t('ent.common.truncated')}</p>}
        </section>
      </div>
    </Layout>
  )
}

export default function RegionalReportPage() {
  return (
    <ProtectedRoute permission="reports.view">
      <RegionalReport />
    </ProtectedRoute>
  )
}
