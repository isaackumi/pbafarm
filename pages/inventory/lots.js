import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { KpiStrip, Pill, Table } from '../../components/ui'
import NavTabs from '../../components/ui/NavTabs'
import InventoryActions from '../../components/inventory/InventoryActions'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import { inventoryTabs } from '../../lib/sectionTabs'
import { formatMass } from '../../lib/feedOverview'
import { addDays, formatDate, formatNumber, localToday } from '../../lib/format'
import { useT } from '../../lib/i18n/context'

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

/** Paper 51 "issue next" lot: sky text on dark, body text on light. */
const NEXT_TEXT = 'text-sky-ink [html[data-theme=light]_&]:text-text'

function InventoryLots() {
  const t = useT()
  const { user } = useAuth()
  const { activeLocation } = useLocation()
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
  // FEFO: the first unexpired lot of each feed is the one to issue next (Paper 51 lot list).
  const nextLots = new Set()
  const seenFeeds = new Set()
  rows.forEach((lot, i) => {
    if (states[i] === 'expired' || seenFeeds.has(lot.feed_type_id)) return
    seenFeeds.add(lot.feed_type_id)
    nextLots.add(lot.id)
  })

  return (
    <Layout
      title={t('ops.inventory.title')}
      eyebrow={activeLocation?.name ? t('ops.feed.eyebrowAt', { site: activeLocation.name }) : t('ops.lots.eyebrow')}
      actions={<InventoryActions />}
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
            {
              key: 'batch',
              header: t('ops.lots.batch'),
              width: 240,
              render: (lot) =>
                nextLots.has(lot.id) ? (
                  <span className={NEXT_TEXT}>
                    {lot.batch_number || '—'} <span className="text-xs">· {t('ops.lots.issueNext')}</span>
                  </span>
                ) : (
                  <span className={lot.batch_number ? 'text-text' : 'text-muted'}>{lot.batch_number || '—'}</span>
                ),
            },
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
