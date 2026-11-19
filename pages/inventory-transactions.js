import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { SlidersHorizontal } from 'lucide-react'
import { Field, GhostButton, GradientButton, Input, Pill, Table } from '../components/ui'
import NavTabs from '../components/ui/NavTabs'
import { inventoryTabs } from '../lib/sectionTabs'
import { movementKind } from '../lib/feedOverview'
import { useT } from '../lib/i18n/context'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { formatNumber, localToday } from '../lib/format'
import { usePermission } from '../hooks/usePermission'

export default function InventoryTransactionsPage() {
  return (
    <ProtectedRoute>
      <InventoryTransactions />
    </ProtectedRoute>
  )
}

function InventoryTransactions() {
  const t = useT()
  const { user } = useAuth()
  const canAdjust = usePermission('inventory.adjust')
  const { showToast } = useToast()
  const { locations } = useLocation()
  const siteName = (id) => (locations || []).find((l) => (l.id || l._id) === id)?.name || '—'
  const reverseTransaction = useMutation(api.inventory.reverseTransaction)

  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .split('T')[0],
    end: localToday(),
  })
  const [reverseTarget, setReverseTarget] = useState(null)
  const [reverseReason, setReverseReason] = useState('')
  const [reversing, setReversing] = useState(false)

  const dateFrom = useMemo(
    () => new Date(dateRange.start).getTime(),
    [dateRange.start],
  )
  const dateTo = useMemo(
    () => new Date(dateRange.end + 'T23:59:59').getTime(),
    [dateRange.end],
  )

  const feedTypes = useQuery(api.feed.listFeedTypes, user ? {} : 'skip')
  const transactions = useQuery(
    api.inventory.listTransactions,
    user ? { dateFrom, dateTo, limit: 500 } : 'skip',
  )

  const typeMap = useMemo(() => {
    const map = {}
    for (const ft of feedTypes || []) {
      map[ft.id || ft._id] = ft
    }
    return map
  }, [feedTypes])

  const loading = feedTypes === undefined || transactions === undefined

  const onReverse = async () => {
    if (!reverseTarget) return
    const reason = reverseReason.trim()
    if (!reason) {
      showToast('error', 'Enter a reason for the reversal')
      return
    }
    setReversing(true)
    try {
      await reverseTransaction({
        transactionId: reverseTarget.id || reverseTarget._id,
        reason,
      })
      showToast('success', 'Transaction reversed')
      setReverseTarget(null)
      setReverseReason('')
    } catch (err) {
      showToast('error', err.message || 'Reversal failed')
    } finally {
      setReversing(false)
    }
  }

  return (
    <Layout
      title={t('ops.inventory.title')}
      eyebrow={t('ops.ledger.eyebrow')}
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
      <Table
        title={t('ops.ledger.title')}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Field label={t('ops.ledger.from')} htmlFor="ledger-from">
              <Input
                id="ledger-from"
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange((p) => ({ ...p, start: e.target.value }))}
              />
            </Field>
            <Field label={t('ops.ledger.to')} htmlFor="ledger-to">
              <Input
                id="ledger-to"
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange((p) => ({ ...p, end: e.target.value }))}
              />
            </Field>
          </div>
        }
        columns={[
          {
            key: 'when',
            header: t('ops.col.date'),
            width: 190,
            render: (txn) => <span className="whitespace-nowrap">{new Date(txn.transaction_date).toLocaleString()}</span>,
          },
          {
            key: 'type',
            header: t('ops.col.type'),
            width: 150,
            render: (txn) => (
              <Pill tone={movementKind(txn.transaction_type).tone}>{String(txn.transaction_type).replace(/_/g, ' ')}</Pill>
            ),
          },
          {
            key: 'feed',
            header: t('ops.col.feedType'),
            render: (txn) => typeMap[txn.feed_type_id]?.name || '—',
            sub: (txn) => txn.notes || undefined,
          },
          { key: 'site', header: t('ops.ledger.site'), width: 150, render: (txn) => (txn.location_id ? siteName(txn.location_id) : '—') },
          {
            key: 'kg',
            header: t('ops.col.kg'),
            width: 110,
            align: 'right',
            render: (txn) => (
              <span className={txn.quantity_kg < 0 ? 'text-alert' : 'text-good'}>
                {txn.quantity_kg > 0 ? '+' : ''}
                {formatNumber(txn.quantity_kg, { decimals: 1 })}
              </span>
            ),
          },
          {
            key: 'actions',
            header: <span className="sr-only">{t('ops.col.actions')}</span>,
            width: 110,
            align: 'right',
            render: (txn) =>
              canAdjust &&
              txn.transaction_type !== 'reversal' &&
              !String(txn.transaction_type).startsWith('transfer') ? (
                <GhostButton
                  size="sm"
                  tone="danger"
                  onClick={() => {
                    setReverseReason('')
                    setReverseTarget(txn)
                  }}
                >
                  {t('ops.ledger.reverse')}
                </GhostButton>
              ) : null,
          },
        ]}
        rows={loading ? [] : transactions || []}
        empty={loading ? t('ops.common.loading') : t('ops.ledger.empty')}
      />
      </div>

      <ConfirmDeleteModal
        open={Boolean(reverseTarget)}
        title="Reverse transaction"
        confirmLabel="Reverse"
        busy={reversing}
        message={
          <div className="space-y-3">
            <p>
              Reverse this{' '}
              <span className="font-semibold text-chart-ink">
                {reverseTarget?.transaction_type}
              </span>{' '}
              of{' '}
              <span className="font-data text-chart-ink">
                {reverseTarget?.quantity_kg} kg
              </span>
              ? Stock will be adjusted.
            </p>
            <Field label="Reason" htmlFor="reverse-reason">
              <Input
                id="reverse-reason"
                type="text"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="Why reverse this entry?"
                autoFocus
              />
            </Field>
          </div>
        }
        onCancel={() => {
          if (reversing) return
          setReverseTarget(null)
          setReverseReason('')
        }}
        onConfirm={onReverse}
      />
    </Layout>
  )
}
