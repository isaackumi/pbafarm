import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { WQ_PARAMETERS } from '../convex/lib/waterQuality'
import { errorMessage } from '../lib/errorMessage'
import { UNIT_TYPES, unitLabel } from '../lib/format'

const SHOWN = ['dissolvedOxygen', 'temperatureC', 'ph', 'ammonia', 'nitrite', 'secchiCm']
const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }))

function ThresholdEditor() {
  const { showToast } = useToast()
  const data = useQuery(api.waterQuality.thresholds, {})
  const setThreshold = useMutation(api.waterQuality.setThreshold)
  const [unitType, setUnitType] = useState('cage')
  const [param, setParam] = useState('dissolvedOxygen')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  if (!data) return <p className="text-sm text-muted">Loading…</p>
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
      showToast(reset ? 'Back to the default' : 'Threshold saved', 'success')
      setMin('')
      setMax('')
    } catch (err) {
      showToast(errorMessage(err, 'Could not save the threshold'), 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
        <Field label="Unit type" htmlFor="th-type">
          <Select id="th-type" value={unitType} onChange={(e) => setUnitType(e.target.value)}>
            {UNIT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Parameter" htmlFor="th-param">
          <Select id="th-param" value={param} onChange={(e) => setParam(e.target.value)}>
            {Object.entries(WQ_PARAMETERS).map(([k, s]) => (
              <option key={k} value={k}>{s.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Min" htmlFor="th-min">
          <Input id="th-min" type="number" step="any" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder={current[param]?.min ?? ''} />
        </Field>
        <Field label="Max" htmlFor="th-max">
          <Input id="th-max" type="number" step="any" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder={current[param]?.max ?? ''} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => save(false)}>Save for {unitLabel(unitType, { plural: true }).toLowerCase()}</Button>
        <Button size="sm" variant="secondary" onClick={() => save(true)}>Use default</Button>
      </div>
      <p className="text-xs text-muted">Saving with both boxes blank turns the alert for that parameter off.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-foam-deep">
              <th className="py-2 pr-3 font-medium">Parameter</th>
              <th className="py-2 pr-3 font-medium">{unitLabel(unitType, { plural: true })}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foam-deep">
            {Object.entries(WQ_PARAMETERS).map(([k, s]) => {
              const r = current[k]
              return (
                <tr key={k}>
                  <td className="py-1.5 pr-3">{s.label}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-muted">
                    {!r ? 'No alert' : `${r.min != null ? `≥ ${r.min}` : ''}${r.min != null && r.max != null ? ' and ' : ''}${r.max != null ? `≤ ${r.max}` : ''} ${s.unit}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Overview() {
  const { user, hasRole } = useAuth()
  const isAdmin = Boolean(hasRole?.('admin'))
  const { locationArgs } = useLocation()
  const latest = useQuery(api.waterQuality.latestByUnit, user ? locationArgs : 'skip')
  const units = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const rows = useMemo(() => {
    if (!units) return []
    const byUnit = new Map((latest || []).map((r) => [r.unitId, r]))
    return units
      .map((u) => ({ unit: u, reading: byUnit.get(u.id) || null }))
      .sort((a, b) => (b.reading?.breachCount ?? 0) - (a.reading?.breachCount ?? 0) || a.unit.name.localeCompare(b.unit.name, undefined, { numeric: true }))
  }, [units, latest])

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Water quality"
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Water quality' }]}
        description="Latest reading per unit. Out-of-range values follow the thresholds for each unit type."
        actions={<Button size="sm" href="/water-entry">Quick entry</Button>}
        related={[{ label: 'Unit board', href: '/units' }, { label: 'Automations', href: '/automations' }]}
      />
      <Card padding={false}>
        {units === undefined ? (
          <p className="p-5 text-sm text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No units yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-foam-deep">
                  <th className="px-4 py-2 font-medium">Unit</th>
                  <th className="px-4 py-2 font-medium">Last reading</th>
                  {SHOWN.map((k) => (
                    <th key={k} className="px-3 py-2 font-medium text-right">{WQ_PARAMETERS[k].short}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-foam-deep">
                {rows.map(({ unit, reading }) => (
                  <tr key={unit.id}>
                    <td className="px-4 py-2">
                      <Link href={`/units/${unit.id}/water`} className="text-lake hover:underline font-medium">{unit.name}</Link>
                      <span className="block text-xs text-muted">{unitLabel(unit)}</span>
                    </td>
                    <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                      {reading ? reading.date : <span className="text-muted">None</span>}
                      {reading?.breachCount ? (
                        <span className="ml-2 text-signal text-xs">{reading.breachCount} out of range</span>
                      ) : null}
                    </td>
                    {SHOWN.map((k) => (
                      <td key={k} className="px-3 py-2 text-right tabular-nums">{fmt(reading?.values?.[k])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {isAdmin && (
        <Card>
          <CardHeader title="Thresholds" subtitle="Defaults suit warm-water finfish; adjust per unit type. Breaches can alert through the Water quality automation." />
          <ThresholdEditor />
        </Card>
      )}
    </div>
  )
}

export default function WaterQualityPage() {
  return (
    <ProtectedRoute>
      <Layout title="Water quality">
        <Overview />
      </Layout>
    </ProtectedRoute>
  )
}
