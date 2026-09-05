import React, { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import FishTransferForm from '../components/FishTransferForm'
import { PageHeader, FormPage, Button, Select } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'

function statusBadge(status) {
  if (status === 'approved') return 'bg-green-100 text-green-900'
  if (status === 'pending_approval') return 'bg-amber-100 text-amber-900'
  if (status === 'rejected') return 'bg-red-100 text-red-900'
  return 'bg-foam-deep text-chart-ink'
}

function FishTransfersContent() {
  const { user, hasRole } = useAuth()
  const { showToast } = useToast()
  const [statusFilter, setStatusFilter] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const transfers = useQuery(
    api.fishTransfers.listFishTransfers,
    user
      ? {
          ...(statusFilter ? { status: statusFilter } : {}),
          // refreshKey unused by API; remount trigger via key on parent
        }
      : 'skip',
  )
  const approveTransfer = useMutation(api.fishTransfers.approveFishTransfer)
  const rejectTransfer = useMutation(api.fishTransfers.rejectFishTransfer)
  const [busyId, setBusyId] = useState(null)

  const rows = useMemo(() => transfers || [], [transfers, refreshKey])
  const isAdmin = hasRole?.('admin')

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
        <FishTransferForm onCreated={() => setRefreshKey((k) => k + 1)} />

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-chart-ink">
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

          {transfers === undefined ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted">No transfers yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-foam-deep bg-white">
              <table className="min-w-full divide-y divide-foam-deep text-sm">
                <thead className="bg-foam-deep/40">
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
                      <td className="px-4 py-3 whitespace-nowrap font-data">
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
                      <td className="px-4 py-3 text-right font-data">
                        {(row.quantity || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-data">
                        {(row.abw || 0).toFixed(1)}g
                      </td>
                      <td className="px-4 py-3 capitalize">{row.transferType}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(row.status)}`}
                        >
                          {row.status?.replace(/_/g, ' ')}
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
                          ) : (
                            '—'
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
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
      <Layout title="Fish Transfers">
        <FishTransfersContent />
      </Layout>
    </ProtectedRoute>
  )
}
