import { useQuery } from 'convex/react'
import { ArrowUpFromLine } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { GradientButton, KpiStrip, Pill, Table } from '../components/ui'
import NavTabs from '../components/ui/NavTabs'
import { feedTabs } from '../lib/sectionTabs'
import { formatMass } from '../lib/feedOverview'
import { formatNumber } from '../lib/format'
import { useT } from '../lib/i18n/context'
import { usePermission } from '../hooks/usePermission'
import { api } from '../convex/_generated/api'
import { useMoney } from '../lib/money'
import { useLocation } from '../contexts/LocationContext'

export default function StockLevelsPage() {
  return (
    <ProtectedRoute>
      <StockLevels />
    </ProtectedRoute>
  )
}

function StockLevels() {
  const t = useT()
  const money = useMoney()
  const canIssue = usePermission('inventory.issue')
  // Stock at the header site (FARM-003); the tally check stays company-wide.
  const { locationArgs } = useLocation()
  const stockResult = useQuery(api.inventory.listStockLevels, locationArgs)
  const tally = useQuery(api.inventory.stockTally, {})
  const loading = stockResult === undefined || tally === undefined
  const stockLevels = stockResult || []

  const getStockStatus = (current, minimum) => {
    if (current <= minimum * 0.5) return 'critical'
    if (current <= minimum * 1.2) return 'low'
    return 'good'
  }

  const STATUS = {
    critical: { tone: 'red', key: 'ops.stock.critical' },
    low: { tone: 'amber', key: 'ops.stock.low' },
    good: { tone: 'green', key: 'ops.stock.ok' },
  }

  const tallyById = Object.fromEntries(
    (tally || []).map((r) => [r.feed_type_id, r]),
  )
  const totalKg = stockLevels.reduce((sum, r) => sum + Number(r.current_stock || 0), 0)
  const totalValue = stockLevels.reduce((sum, r) => sum + Number(r.stock_value || 0), 0)
  const belowMin = stockLevels.filter((r) => getStockStatus(r.current_stock, r.minimum_stock) !== 'good').length
  const mismatches = (tally || []).filter((r) => !r.ok).length

  return (
    <Layout
      title={t('ops.tab.stockLevels')}
      eyebrow={t('ops.stock.eyebrow')}
      actions={
        canIssue ? (
          <GradientButton href="/feed-issue" icon={ArrowUpFromLine}>
            {t('ops.feed.issueFeed')}
          </GradientButton>
        ) : null
      }
    >
      <div className="flex flex-col gap-[28px]">
        <NavTabs tabs={feedTabs(t)} label={t('ops.tabs.feed')} />
        <KpiStrip
          items={[
            { label: t('ops.feed.inStore'), value: loading ? '—' : formatMass(totalKg) },
            { label: t('ops.stock.value'), value: loading ? '—' : money(totalValue, { decimals: 0 }) },
            {
              label: t('ops.stock.belowMin'),
              value: loading ? '—' : formatNumber(belowMin),
              valueTone: belowMin ? 'warn' : undefined,
            },
            {
              label: t('ops.stock.tally'),
              value: loading ? '—' : mismatches ? t('ops.stock.mismatches', { count: mismatches }) : t('ops.stock.tallyOk'),
              valueTone: mismatches ? 'alert' : 'good',
            },
          ]}
        />
        <Table
          title={t('ops.stock.onHand')}
          columns={[
            { key: 'name', header: t('ops.col.feedType'), render: (item) => item.feed_type_name, sub: (item) => item.supplier_name || null },
            { key: 'kg', header: t('ops.col.kg'), width: 110, align: 'right', render: (item) => formatNumber(item.current_stock, { decimals: 1 }) },
            {
              key: 'bags',
              header: t('ops.col.bags'),
              width: 110,
              align: 'right',
              render: (item) => formatNumber(item.current_stock_bags || 0, { decimals: 1 }),
              sub: (item) => t('ops.stock.bagSize', { kg: Number(item.bag_size_kg || 25) }),
            },
            { key: 'min', header: t('ops.col.minKg'), width: 110, align: 'right', render: (item) => formatNumber(item.minimum_stock, { decimals: 0 }) },
            {
              key: 'status',
              header: t('ops.col.status'),
              width: 120,
              render: (item) => {
                const st = STATUS[getStockStatus(item.current_stock, item.minimum_stock)]
                return <Pill tone={st.tone}>{t(st.key)}</Pill>
              },
            },
            {
              key: 'tally',
              header: t('ops.col.ledgerTally'),
              width: 130,
              render: (item) => {
                const row = tallyById[item.feed_type_id]
                if (!row) return <span className="text-muted">—</span>
                return row.ok ? (
                  <span className="text-good">{t('ops.stock.tallyOk')}</span>
                ) : (
                  <span className="font-medium text-alert tabular-nums">Δ {row.delta}</span>
                )
              },
            },
            { key: 'value', header: t('ops.col.value'), width: 140, align: 'right', render: (item) => money(item.stock_value || 0) },
          ]}
          rows={stockLevels}
          rowKey={(item) => item.feed_type_id}
          empty={loading ? t('ops.common.loading') : t('ops.stock.none')}
        />
        <p className="-mt-4 text-xs text-muted">{t('ops.stock.ledgerNote')}</p>
      </div>
    </Layout>
  )
}
