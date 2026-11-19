import { useQuery } from 'convex/react'
import { SlidersHorizontal } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { GradientButton, KpiStrip, Pill, Table } from '../../components/ui'
import NavTabs from '../../components/ui/NavTabs'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../convex/_generated/api'
import { inventoryTabs } from '../../lib/sectionTabs'
import { formatMass } from '../../lib/feedOverview'
import { addDays, formatDate, formatNumber, localToday } from '../../lib/format'
import { useT } from '../../lib/i18n/context'
import { usePermission } from '../../hooks/usePermission'

export default function InventoryLotsPage() {
  return (
    <ProtectedRoute>
      <InventoryLots />
    </ProtectedRoute>
  )
}

/** 'expired' | 'soon' (within 30 days) | 'ok' | null when the lot has no expiry. */
function expiryState(expiry, today) {
  if (!expiry) return null
  if (expiry < today) return 'expired'
  if (expiry <= addDays(today, 30)) return 'soon'
  return 'ok'
}

const EXPIRY_TONE = { expired: 'red', soon: 'amber', ok: 'green' }

function InventoryLots() {
  const t = useT()
  const { user } = useAuth()
  const canAdjust = usePermission('inventory.adjust')
  const lots = useQuery(api.inventory.listLots, user ? {} : 'skip')
  const today = localToday()
  // First-expiry-first-out within each feed; lots with no expiry last.
  const rows = [...(lots || [])].sort(
    (a, b) =>
      String(a.feed_type_name).localeCompare(String(b.feed_type_name)) ||
      String(a.expiry_date || '9999').localeCompare(String(b.expiry_date || '9999')),
  )
  const states = rows.map((lot) => expiryState(lot.expiry_date, today))
  const soon = states.filter((s) => s === 'soon').length
  const expired = states.filter((s) => s === 'expired').length
  const totalKg = rows.reduce((sum, lot) => sum + Number(lot.quantity_kg || 0), 0)

  return (
    <Layout
      title={t('ops.inventory.title')}
      eyebrow={t('ops.lots.eyebrow')}
      actions={
        canAdjust ? (
          <GradientButton href="/inventory/adjust" icon={SlidersHorizontal}>
            {t('ops.lots.adjust')}
          </GradientButton>
        ) : null
      }
    >
      <div className="flex flex-col gap-[28px]">
        <NavTabs tabs={inventoryTabs(t)} label={t('ops.tabs.inventory')} />
        <KpiStrip
          items={[
            { label: t('ops.lots.onHand'), value: lots === undefined ? '—' : formatNumber(rows.length), suffix: lots === undefined ? undefined : formatMass(totalKg) },
            { label: t('ops.lots.expiring30'), value: lots === undefined ? '—' : formatNumber(soon), valueTone: soon ? 'warn' : undefined },
            { label: t('ops.lots.expired'), value: lots === undefined ? '—' : formatNumber(expired), valueTone: expired ? 'alert' : undefined },
          ]}
        />
        <Table
          title={t('ops.lots.title')}
          columns={[
            { key: 'feed', header: t('ops.col.feedType'), render: (lot) => lot.feed_type_name, sub: (lot) => lot.location },
            { key: 'batch', header: t('ops.lots.batch'), width: 160, render: (lot) => <span className="font-data text-muted">{lot.batch_number || '—'}</span> },
            {
              key: 'expiry',
              header: t('ops.lots.expires'),
              width: 200,
              render: (lot) => {
                const state = expiryState(lot.expiry_date, today)
                if (!state) return <span className="text-muted">—</span>
                return (
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{formatDate(lot.expiry_date)}</span>
                    {state !== 'ok' && <Pill tone={EXPIRY_TONE[state]}>{t(`ops.lots.state.${state}`)}</Pill>}
                  </span>
                )
              },
            },
            { key: 'qty', header: t('ops.col.qtyKg'), width: 130, align: 'right', render: (lot) => formatNumber(lot.quantity_kg, { decimals: 1 }) },
          ]}
          rows={rows}
          empty={lots === undefined ? t('ops.common.loading') : t('ops.lots.empty')}
        />
      </div>
    </Layout>
  )
}
