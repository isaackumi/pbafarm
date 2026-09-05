import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button } from '../components/ui'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'

export default function InventoryTransactionsPage() {
  return (
    <ProtectedRoute>
      <InventoryTransactions />
    </ProtectedRoute>
  )
}

function InventoryTransactions() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const reverseTransaction = useMutation(api.inventory.reverseTransaction)

  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .split('T')[0],
    end: new Date().toISOString().split('T')[0],
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
    for (const t of feedTypes || []) {
      map[t.id || t._id] = t
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
    <Layout title="Inventory Ledger">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Inventory', href: '/inventory/overview' },
          { label: 'Ledger' },
        ]}
        description="Live inventory ledger — purchases, issues, adjustments, transfers, reversals."
        related={[
          { label: 'Adjust / transfer', href: '/inventory/adjust' },
          { label: 'Lots', href: '/inventory/lots' },
          { label: 'Stock levels', href: '/stock-levels' },
          { label: 'Feed purchases', href: '/feed-purchases' },
        ]}
        actions={
          <Button href="/inventory/adjust" size="sm">
            Adjust / transfer
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs text-muted mb-1">From</label>
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) =>
              setDateRange((p) => ({ ...p, start: e.target.value }))
            }
            className="border border-input-border rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">To</label>
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange((p) => ({ ...p, end: e.target.value }))}
            className="border border-input-border rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="page-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted">Loading ledger…</div>
        ) : (transactions || []).length === 0 ? (
          <div className="p-8 text-center text-muted">No transactions in range.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-foam-deep">
              <thead className="bg-foam-deep/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    When
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    Feed
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted uppercase">
                    kg
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    Notes
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foam-deep">
                {(transactions || []).map((txn) => {
                  const ft = typeMap[txn.feed_type_id]
                  const canReverse =
                    user?.role === 'admin' ||
                    user?.role === 'super_admin'
                  return (
                    <tr key={txn.id || txn._id} className="hover:bg-foam/60">
                      <td className="px-4 py-3 text-sm font-data whitespace-nowrap">
                        {new Date(txn.transaction_date).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-lagoon-800">
                        {txn.transaction_type}
                      </td>
                      <td className="px-4 py-3 text-sm">{ft?.name || '—'}</td>
                      <td
                        className={`px-4 py-3 text-sm font-data text-right ${
                          txn.quantity_kg < 0 ? 'text-red-600' : 'text-green-700'
                        }`}
                      >
                        {txn.quantity_kg > 0 ? '+' : ''}
                        {txn.quantity_kg}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted max-w-xs truncate">
                        {txn.notes || '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canReverse &&
                          txn.transaction_type !== 'reversal' &&
                          txn.transaction_type !== 'transfer' && (
                            <button
                              type="button"
                              onClick={() => {
                                setReverseReason('')
                                setReverseTarget(txn)
                              }}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Reverse
                            </button>
                          )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
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
            <label className="block text-xs font-semibold text-chart-ink">
              Reason
              <input
                type="text"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="mt-1 w-full rounded-xl border border-input-border bg-surface px-3 py-2 text-sm text-chart-ink"
                placeholder="Why reverse this entry?"
                autoFocus
              />
            </label>
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
