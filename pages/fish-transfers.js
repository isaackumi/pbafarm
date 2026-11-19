import React, { useMemo, useState } from 'react'
import { useMutation, usePaginatedQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import FishTransferForm from '../components/FishTransferForm'
import MultiTransferForm from '../components/MultiTransferForm'
import { useRouter } from 'next/router'
import { PageHeader, FormPage, Button, Select, TabBar } from '../components/ui'
import { errorMessage } from '../lib/errorMessage'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { usePermission } from '../hooks/usePermission'

function statusBadge(status) {
  if (status === 'approved') return 'bg-kelp/10 text-kelp'
  if (status === 'pending_approval') return 'bg-warn/10 text-warn'
  if (status === 'rejected') return 'bg-signal/10 text-signal'
  return 'bg-foam-deep text-chart-ink'
}

function FishTransfersContent() {
  const { user, hasRole } = useAuth()
  const { showToast } = useToast()
  const [statusFilter, setStatusFilter] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  // Paginated (PLAT-001): newest first, 50 at a time, "Load more" below.
  const {
    results: transfers,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    api.fishTransfers.listFishTransfersPage,
    user ? (statusFilter ? { status: statusFilter } : {}) : 'skip',
    { initialNumItems: 50 },
  )
  const approveTransfer = useMutation(api.fishTransfers.approveFishTransfer)
  const rejectTransfer = useMutation(api.fishTransfers.rejectFishTransfer)
  const reverseTransfer = useMutation(api.fishTransfers.reverseFishTransfer)
  const router = useRouter()
  const sourceParam = typeof router.query.source === 'string' ? router.query.source : ''
  const [mode, setMode] = useState('single')
  const [busyId, setBusyId] = useState(null)

  const rows = useMemo(() => transfers || [], [transfers, refreshKey])
  const isAdmin = usePermission('production.transfer.approve')

  const onApprove = async (id) => {
    setBusyId(id)
    try {
      await approveTransfer({ id })
      showToast('success', 'Transfer approved')
      setRefreshKey((k) => k + 1)
    } catch (e) {
      showToast('error', e?.message || 'Approve failed')
    } finally {
      setBusyId(null)
    }
  }

  const onReject = async (id) => {
    const reason = window.prompt('Rejection reason (optional):') ?? ''
    setBusyId(id)
    try {
      await rejectTransfer({ id, reason: reason || undefined })
      showToast('success', 'Transfer rejected')
      setRefreshKey((k) => k + 1)
    } catch (e) {
      showToast('error', e?.message || 'Reject failed')
    } finally {
      setBusyId(null)
    }
  }

  const onReverse = async (row) => {
    const reason = window.prompt(
      `Reverse the transfer of ${(row.quantity || 0).toLocaleString()} fish from ${row.sourceCageName} to ${row.destinationCageName}? Give a reason:`,
    )
    if (!reason || !reason.trim()) return
    setBusyId(row.id)
    try {
      await reverseTransfer({ id: row.id, reason: reason.trim() })
      showToast('success', 'Transfer reversed')
      setRefreshKey((k) => k + 1)
    } catch (e) {
      showToast('error', errorMessage(e, 'Reverse failed'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <FormPage data-tour="page-fish-transfers">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Stocking management', href: '/stocking-management' },
          { label: 'Fish transfers' },
        ]}
        description="Move fish between cages (full or partial). Empty destinations get a new stocking; occupied cages get a top-up."
        related={[
          { label: 'Stocking management', href: '/stocking-management' },
          { label: 'New stocking', href: '/stocking' },
          { label: 'Approvals', href: '/approvals' },
        ]}
      />

      <div className="space-y-8">
        {isAdmin && (
          <TabBar
            tabs={[
              { id: 'single', label: 'One destination' },
              { id: 'multi', label: 'Several destinations' },
            ]}
            active={mode}
            onChange={setMode}
          />
        )}
        {isAdmin && mode === 'multi' ? (
          <MultiTransferForm initialSourceId={sourceParam} onCreated={() => setRefreshKey((k) => k + 1)} />
        ) : (
          <FishTransferForm onCreated={() => setRefreshKey((k) => k + 1)} />
        )}

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-lg font-medium text-chart-ink">
              Transfer history
            </h2>
            <div className="w-48">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                <option value="pending_approval">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </Select>
            </div>
          </div>

          {pageStatus === 'LoadingFirstPage' ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted">No transfers yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-foam-deep bg-surface">
              <table className="min-w-full divide-y divide-foam-deep text-sm">
                <thead className="bg-foam text-muted">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">From → To</th>
                    <th className="px-4 py-3 text-right font-medium">Qty</th>
                    <th className="px-4 py-3 text-right font-medium">ABW</th>
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    {isAdmin ? (
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-foam-deep">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 whitespace-nowrap font-data tabular-nums">
                        {row.transferDate}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">
                          {row.sourceCageName || '—'}
                        </span>
                        {' → '}
                        <span className="font-medium">
                          {row.destinationCageName || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-data tabular-nums">
                        {(row.quantity || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-data tabular-nums">
                        {(row.abw || 0).toFixed(1)}g
                      </td>
                      <td className="px-4 py-3 capitalize">{row.transferType}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(row.status)}`}
                        >
                          {row.reversedAt ? 'reversed' : row.status?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      {isAdmin ? (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {row.status === 'pending_approval' ? (
                            <div className="inline-flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={busyId === row.id}
                                onClick={() => onApprove(row.id)}
                              >
                                Approve
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={busyId === row.id}
                                onClick={() => onReject(row.id)}
                              >
                                Reject
                              </Button>
                            </div>
                          ) : row.status === 'approved' && !row.reversedAt ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={busyId === row.id}
                              onClick={() => onReverse(row)}
                            >
                              Reverse
                            </Button>
                          ) : (
                            '—'
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
              {pageStatus === 'CanLoadMore' || pageStatus === 'LoadingMore' ? (
                <div className="p-4 text-center border-t border-foam-deep">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pageStatus === 'LoadingMore'}
                    onClick={() => loadMore(50)}
                  >
                    {pageStatus === 'LoadingMore' ? 'Loading…' : 'Load more'}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </FormPage>
  )
}

export default function FishTransfersPage() {
  return (
    <ProtectedRoute>
      <Layout title="Fish transfers">
        <FishTransfersContent />
      </Layout>
    </ProtectedRoute>
  )
}
