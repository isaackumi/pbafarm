import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { Pencil } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  Card,
  Field,
  GhostButton,
  GradientButton,
  IfPermitted,
  Input,
  KpiStrip,
  LoadingState,
  Select,
  Table,
} from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { WQ_PARAMETERS } from '../convex/lib/waterQuality'
import { errorMessage } from '../lib/errorMessage'
import { UNIT_TYPES, formatNumber, unitLabel } from '../lib/format'
import { waterRows, waterSummary } from '../lib/healthWater'
import { waterLogColumns } from '../components/health/WaterLog'
import { usePermission } from '../hooks/usePermission'
import { useLocale, useT } from '../lib/i18n/context'

const paramLabel = (t, key, spec) => t.or(`wq.param.${key}`, spec.label)

function ThresholdEditor() {
  const t = useT()
  const { showToast } = useToast()
  const data = useQuery(api.waterQuality.thresholds, {})
  const setThreshold = useMutation(api.waterQuality.setThreshold)
  const [unitType, setUnitType] = useState('cage')
  const [param, setParam] = useState('dissolvedOxygen')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  if (!data) return <LoadingState />
  const current = data.byUnitType[unitType] || {}

  const save = async (reset = false) => {
    try {
      await setThreshold({
        unitType,
        parameter: param,
        min: min === '' ? undefined : Number(min),
        max: max === '' ? undefined : Number(max),
        reset,
      })
      showToast(reset ? t('healthWater.thresholds.resetDone') : t('healthWater.thresholds.saved'), 'success')
      setMin('')
      setMax('')
    } catch (err) {
      showToast(errorMessage(err, t('healthWater.thresholds.saveFailed')), 'error')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
        <Field label={t('healthWater.thresholds.unitType')} htmlFor="th-type">
          <Select id="th-type" value={unitType} onChange={(e) => setUnitType(e.target.value)}>
            {UNIT_TYPES.map((u) => (
              <option key={u.value} value={u.value}>{unitLabel(u.value)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('healthWater.thresholds.parameter')} htmlFor="th-param">
          <Select id="th-param" value={param} onChange={(e) => setParam(e.target.value)}>
            {Object.entries(WQ_PARAMETERS).map(([k, s]) => (
              <option key={k} value={k}>{paramLabel(t, k, s)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('healthWater.thresholds.min')} htmlFor="th-min">
          <Input id="th-min" type="number" step="any" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder={current[param]?.min ?? ''} />
        </Field>
        <Field label={t('healthWater.thresholds.max')} htmlFor="th-max">
          <Input id="th-max" type="number" step="any" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder={current[param]?.max ?? ''} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <GradientButton variant="solid" size="sm" onClick={() => save(false)}>
          {t('healthWater.thresholds.saveFor', { units: unitLabel(unitType, { plural: true }).toLowerCase() })}
        </GradientButton>
        <GhostButton onClick={() => save(true)}>{t('healthWater.thresholds.useDefault')}</GhostButton>
        <p className="text-xs leading-4 text-muted">{t('healthWater.thresholds.blankHint')}</p>
      </div>
      <dl className="grid grid-cols-1 border-t border-line sm:grid-cols-2">
        {Object.entries(WQ_PARAMETERS).map(([k, s]) => {
          const r = current[k]
          const range = !r
            ? t('healthWater.thresholds.noAlert')
            : [r.min != null ? `≥ ${r.min}` : null, r.max != null ? `≤ ${r.max}` : null]
                .filter(Boolean)
                .join(` ${t('healthWater.thresholds.and')} `) + (s.unit ? ` ${s.unit}` : '')
          return (
            <div key={k} className="flex items-center justify-between gap-3 border-b border-line py-[11px] sm:odd:pr-6 sm:even:pl-6">
              <dt className="text-[14px] leading-[18px] text-text">{paramLabel(t, k, s)}</dt>
              <dd className={`text-[13px] leading-4 tabular-nums ${r ? 'text-text' : 'text-faint'}`}>{range}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

function Overview() {
  const t = useT()
  const { locale } = useLocale()
  const { user } = useAuth()
  const isAdmin = usePermission('org.settings.manage')
  const { locationArgs } = useLocation()
  const latest = useQuery(api.waterQuality.latestByUnit, user ? locationArgs : 'skip')
  const units = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const thresholds = useQuery(api.waterQuality.thresholds, user ? {} : 'skip')
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  // Search's "Open water history for <cage>" links here as ?q=<cage name>.
  const router = useRouter()
  const presetQ = typeof router.query.q === 'string' ? router.query.q : ''
  useEffect(() => {
    if (presetQ) setSearch(presetQ)
  }, [presetQ])
  const rows = useMemo(() => waterRows(units, latest, thresholds?.byUnitType), [units, latest, thresholds])
  const summary = useMemo(() => waterSummary(rows), [rows])
  const loaded = units !== undefined && latest !== undefined
  const q = search.trim().toLowerCase()
  const shown = rows
    .filter((r) => tab === 'all' || r.breachCount > 0)
    .filter((r) => !q || String(r.unit.name).toLowerCase().includes(q))
  const fmt1 = (v) => (v == null ? '—' : formatNumber(v, { decimals: 1 }))

  return (
    <div className="flex flex-col gap-[28px]">
      <KpiStrip
        items={[
          {
            key: 'do',
            label: t('healthWater.kpi.avgDo'),
            value: loaded && summary.avgDo != null ? `${fmt1(summary.avgDo)} mg/L` : '—',
            valueTone: summary.lowDoUnits > 0 ? 'warn' : undefined,
            suffix: summary.lowDoUnits > 0 ? t('healthWater.kpi.belowThreshold', { count: summary.lowDoUnits }) : null,
          },
          { key: 'temp', label: t('healthWater.kpi.waterTemp'), value: loaded && summary.avgTemp != null ? `${fmt1(summary.avgTemp)} °C` : '—' },
          {
            key: 'out',
            label: t('healthWater.kpi.outOfRange'),
            value: loaded ? summary.outOfRange : '—',
            valueTone: summary.outOfRange > 0 ? 'alert' : undefined,
          },
          {
            key: 'logged',
            label: t('healthWater.kpi.unitsLogged'),
            value: loaded ? summary.logged : '—',
            suffix: loaded ? t('healthWater.kpi.ofUnits', { count: rows.length }) : null,
          },
        ]}
      />
      <Table
        title={t('healthWater.log.title')}
        tabsLabel={t('healthWater.log.filter')}
        tabs={[
          { value: 'all', label: t('healthWater.log.all') },
          { value: 'alerts', label: t('healthWater.log.alerts') },
        ]}
        tab={tab}
        onTabChange={setTab}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('healthWater.log.search')}
        rowKey={(r) => r.unit.id || r.unit._id}
        columns={waterLogColumns(t, locale)}
        rows={shown}
        empty={!loaded ? t('ui.loading') : tab === 'alerts' ? t('healthWater.log.emptyAlerts') : t('healthWater.log.empty')}
      />
      {isAdmin && (
        <Card>
          <div className="mb-5 flex flex-col gap-1">
            <h2 className="text-[17px] font-semibold leading-[22px] text-text">{t('healthWater.thresholds.title')}</h2>
            <p className="text-[13px] leading-[18px] text-muted">{t('healthWater.thresholds.subtitle')}</p>
          </div>
          <ThresholdEditor />
        </Card>
      )}
    </div>
  )
}

export default function WaterQualityPage() {
  const t = useT()
  return (
    <ProtectedRoute>
      <Layout
        title={t('healthWater.wqTitle')}
        eyebrow={t('healthWater.wqEyebrow')}
        actions={
          <IfPermitted permission="production.daily.record">
            <GradientButton href="/water-entry" icon={Pencil}>
              {t('healthWater.logWater')}
            </GradientButton>
          </IfPermitted>
        }
      >
        <Overview />
      </Layout>
    </ProtectedRoute>
  )
}
