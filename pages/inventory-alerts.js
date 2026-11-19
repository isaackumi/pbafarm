import { useState } from 'react'
import { useQuery } from 'convex/react'
import { Bell } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { LoadingState, Pill, Tabs } from '../components/ui'
import NavTabs from '../components/ui/NavTabs'
import InventoryActions from '../components/inventory/InventoryActions'
import { api } from '../convex/_generated/api'
import { useMoney } from '../lib/money'
import { useLocation } from '../contexts/LocationContext'
import { inventoryTabs } from '../lib/sectionTabs'
import { formatMass } from '../lib/feedOverview'
import { useT } from '../lib/i18n/context'

export default function InventoryAlertsPage() {
  return (
    <ProtectedRoute>
      <InventoryAlerts />
    </ProtectedRoute>
  )
}

function alertSeverity(current, minimum) {
  if (current <= minimum * 0.5) return 'critical'
  if (current <= minimum * 0.8) return 'high'
  return 'medium'
}

const SEVERITY_TONE = { critical: 'red', high: 'amber', medium: 'neutral' }
const SEVERITY_DOT = { critical: 'bg-alert', high: 'bg-warn', medium: 'bg-pearl-cyan' }
const FILTERS = ['all', 'critical', 'high', 'medium']

function InventoryAlerts() {
  const t = useT()
  const money = useMoney()
  const { locationArgs } = useLocation()
  const alertsResult = useQuery(api.inventory.listAlerts, locationArgs)
  const [filter, setFilter] = useState('all')
  const loading = alertsResult === undefined
  const alerts = (alertsResult || []).map((item) => ({
    ...item,
    severity: alertSeverity(item.current_stock || 0, item.minimum_stock || 0),
  }))
  const counts = { all: alerts.length }
  for (const a of alerts) counts[a.severity] = (counts[a.severity] || 0) + 1
  const shown = filter === 'all' ? alerts : alerts.filter((a) => a.severity === filter)

  return (
    <Layout title={t('ops.inventory.title')} eyebrow={t('ops.alerts.eyebrow')} actions={<InventoryActions />}>
      <div className="flex flex-col gap-[28px]">
        <NavTabs tabs={inventoryTabs(t)} label={t('ops.tabs.inventory')} />
        <Tabs
          variant="underline"
          className="border-b border-line"
          label={t('ops.alerts.filter')}
          tabs={FILTERS.map((f) => ({ value: f, label: `${t(`ops.alerts.sev.${f}`)} ${counts[f] || 0}` }))}
          value={filter}
          onChange={setFilter}
        />
        <section
          aria-label={t('ops.alerts.title')}
          className="flex max-w-[760px] flex-col gap-1 rounded-card border border-line bg-surface px-[26px] py-6"
        >
          {loading ? (
            <LoadingState label={t('ops.common.loading')} />
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Bell className="h-8 w-8 text-faint" aria-hidden="true" />
              <p className="text-sm text-muted">{t('ops.alerts.empty')}</p>
            </div>
          ) : (
            shown.map((item) => {
              const current = Number(item.current_stock || 0)
              const minimum = Number(item.minimum_stock || 0)
              const pct = minimum > 0 ? Math.round((current / minimum) * 100) : 0
              return (
                <article key={item.id} className="flex items-start gap-[14px] border-t border-line py-4 first:border-t-0">
                  <div className="pt-[6px]">
                    <span className={`block size-2 rounded-pill ${SEVERITY_DOT[item.severity]}`} aria-hidden="true" />
                  </div>
                  <div className="flex grow basis-0 flex-col gap-[6px]">
                    <div className="flex items-center gap-[10px]">
                      <Pill tone={SEVERITY_TONE[item.severity]}>{t(`ops.alerts.sev.${item.severity}`)}</Pill>
                      {item.supplier?.name && <span className="text-xs text-faint">{item.supplier.name}</span>}
                    </div>
                    <h3 className="text-[14px] font-semibold leading-[18px] text-text">
                      {t('ops.alerts.rowTitle', { name: item.name, qty: formatMass(current) })}
                    </h3>
                    <p className="text-sm text-muted">
                      {t('ops.alerts.rowSub', {
                        pct,
                        min: formatMass(minimum),
                        value: money(current * Number(item.price_per_kg || 0)),
                      })}
                    </p>
                  </div>
                </article>
              )
            })
          )}
        </section>
      </div>
    </Layout>
  )
}
