// pages/approvals.js
import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from 'convex/react'
import {
  CheckCircle,
  XCircle,
  Calendar,
  Clock,
  Info,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button, EmptyState, Field, Modal, Textarea } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'

export default function ApprovalsPage() {
  return (
    <ProtectedRoute permission="production.stocking.approve">
      <PendingApprovals />
    </ProtectedRoute>
  )
}

function PendingApprovals() {
  const { user } = useAuth()
  const { showToast } = useToast()

  const approvals = useQuery(
    api.stocking.listPendingApprovals,
    user ? {} : 'skip',
  )
  const approveStocking = useMutation(api.stocking.approveStocking)
  const approveTopup = useMutation(api.stocking.approveTopup)
  const approveFishTransfer = useMutation(api.fishTransfers.approveFishTransfer)
  const rejectStocking = useMutation(api.stocking.rejectStocking)
  const rejectTopup = useMutation(api.stocking.rejectTopup)
  const rejectFishTransfer = useMutation(api.fishTransfers.rejectFishTransfer)

  const [currentRecord, setCurrentRecord] = useState(null)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [processingAction, setProcessingAction] = useState(false)
  const [actionError, setActionError] = useState('')

  const loading = approvals === undefined
  const rows = approvals?.all ?? []

  const handleApprove = (record) => {
    setCurrentRecord(record)
    setActionError('')
    setShowApproveModal(true)
  }

  const handleReject = (record) => {
    setCurrentRecord(record)
    setRejectionReason('')
    setActionError('')
    setShowRejectModal(true)
  }

  const typeLabel = (type) => {
    if (type === 'stocking') return 'Stocking'
    if (type === 'topup') return 'Top-up'
    if (type === 'fish_transfer') return 'Fish transfer'
    return type
  }

  const confirmApprove = async () => {
    if (!currentRecord) return

    setProcessingAction(true)
    setActionError('')
    try {
      if (currentRecord.type === 'topup') {
        await approveTopup({ id: currentRecord.id })
      } else if (currentRecord.type === 'fish_transfer') {
        await approveFishTransfer({ id: currentRecord.id })
      } else {
        await approveStocking({ id: currentRecord.id })
      }

      showToast(
        'success',
        `${typeLabel(currentRecord.type)} approved successfully`,
      )

      setShowApproveModal(false)
      setCurrentRecord(null)
    } catch (error) {
      console.error('Error approving record:', error)
      const message = error?.message || 'Failed to approve'
      setActionError(message)
      showToast('error', `Failed to approve: ${message}`)
    } finally {
      setProcessingAction(false)
    }
  }

  const confirmReject = async () => {
    if (!currentRecord) return

    if (!rejectionReason.trim()) {
      setActionError('Please provide a reason for rejection')
      return
    }

    setProcessingAction(true)
    setActionError('')
    try {
      if (currentRecord.type === 'topup') {
        await rejectTopup({
          id: currentRecord.id,
          reason: rejectionReason.trim(),
        })
      } else if (currentRecord.type === 'fish_transfer') {
        await rejectFishTransfer({
          id: currentRecord.id,
          reason: rejectionReason.trim(),
        })
      } else {
        await rejectStocking({
          id: currentRecord.id,
          reason: rejectionReason.trim(),
        })
      }

      showToast('success', `${typeLabel(currentRecord.type)} rejected`)

      setShowRejectModal(false)
      setCurrentRecord(null)
      setRejectionReason('')
    } catch (error) {
      console.error('Error rejecting record:', error)
      const message = error?.message || 'Failed to reject'
      setActionError(message)
      showToast('error', `Failed to reject: ${message}`)
    } finally {
      setProcessingAction(false)
    }
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatTime = (dateString) => {
    return new Date(dateString).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <Layout title="Pending approvals">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Approvals' },
        ]}
        description="Review and manage pending stocking and top-up approvals."
        related={[
          { label: 'Stocking management', href: '/stocking-management' },
          { label: 'New stocking', href: '/stocking' },
          { label: 'Top-up', href: '/topup' },
        ]}
        actions={
          <Button href="/dashboard" variant="secondary" size="sm">
            Back
          </Button>
        }
      />

      <div className="page-card overflow-hidden">
        {loading ? (
          <div className="py-12 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lake mx-auto"></div>
            <p className="mt-3 text-muted">Loading pending approvals…</p>
          </div>
        ) : rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-foam-deep">
              <thead className="bg-foam">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted"
                  >
                    Type
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted"
                  >
                    Batch/Cage
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted"
                  >
                    Date
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted"
                  >
                    Quantity
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted"
                  >
                    Requested
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-muted"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-surface divide-y divide-foam-deep">
                {rows.map((record) => (
                  <tr
                    key={`${record.type}-${record.id}`}
                    className="hover:bg-foam"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 inline-flex text-xs leading-5 font-medium rounded-full ${
                          record.type === 'stocking'
                            ? 'bg-lake-soft text-lake'
                            : record.type === 'fish_transfer'
                              ? 'bg-foam-deep text-chart-ink'
                              : 'bg-warn/10 text-warn'
                        }`}
                      >
                        {typeLabel(record.type)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <div className="text-sm font-medium text-chart-ink">
                          {record.batchNumber}
                        </div>
                        <div className="text-sm text-muted">
                          {record.cageName}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Calendar className="flex-shrink-0 mr-1.5 h-4 w-4 text-muted" />
                        <span className="text-sm text-chart-ink tabular-nums">
                          {formatDate(record.date)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-chart-ink tabular-nums">
                        {record.count.toLocaleString()} fish
                      </div>
                      <div className="text-sm text-muted tabular-nums">
                        {record.abw.toFixed(1)}g /{' '}
                        {(record.biomass || 0).toFixed(1)}kg
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Clock className="flex-shrink-0 mr-1.5 h-4 w-4 text-muted" />
                        <div className="text-sm text-muted tabular-nums">
                          {formatDate(record.createdAt)}{' '}
                          <span className="text-xs">
                            {formatTime(record.createdAt)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleApprove(record)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-kelp hover:bg-kelp/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
                          title="Approve"
                          aria-label="Approve"
                        >
                          <CheckCircle className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(record)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-signal hover:bg-signal/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
                          title="Reject"
                          aria-label="Reject"
                        >
                          <XCircle className="h-5 w-5" />
                        </button>
                        {record.type !== 'fish_transfer' ? (
                          <Link
                            href={`/${record.type}/${record.id}/details`}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-lake hover:bg-lake-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
                            title="View details"
                            aria-label="View details"
                          >
                            <Info className="h-5 w-5" />
                          </Link>
                        ) : (
                          <Link
                            href="/fish-transfers"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-lake hover:bg-lake-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
                            title="View transfers"
                            aria-label="View transfers"
                          >
                            <Info className="h-5 w-5" />
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No pending approvals"
            description="All stocking and top-up requests have been processed."
          />
        )}
      </div>

      {showApproveModal && currentRecord && (
        <Modal
          onClose={() => setShowApproveModal(false)}
          dismissible={!processingAction}
          title="Approve request?"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setShowApproveModal(false)}
                disabled={processingAction}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={confirmApprove}
                disabled={processingAction}
              >
                {processingAction ? 'Processing…' : 'Approve'}
              </Button>
            </>
          }
        >
          <p className="text-muted mb-4">
            Are you sure you want to approve this{' '}
            {currentRecord.type === 'stocking'
              ? 'stocking'
              : currentRecord.type === 'fish_transfer'
                ? 'fish transfer'
                : 'top-up'}{' '}
            for{' '}
            <span className="font-medium">{currentRecord.batchNumber}</span>{' '}
            in <span className="font-medium">{currentRecord.cageName}</span>?
          </p>

          <div className="bg-foam border border-foam-deep p-3 rounded-lg mb-4">
            <div className="grid grid-cols-2 gap-2 text-sm tabular-nums">
              <div>
                <span className="font-medium text-muted">Date:</span>{' '}
                <span className="text-chart-ink">
                  {formatDate(currentRecord.date)}
                </span>
              </div>
              <div>
                <span className="font-medium text-muted">Quantity:</span>{' '}
                <span className="text-chart-ink">
                  {currentRecord.count.toLocaleString()} fish
                </span>
              </div>
              <div>
                <span className="font-medium text-muted">ABW:</span>{' '}
                <span className="text-chart-ink">
                  {currentRecord.abw.toFixed(1)}g
                </span>
              </div>
              <div>
                <span className="font-medium text-muted">Biomass:</span>{' '}
                <span className="text-chart-ink">
                  {(currentRecord.biomass || 0).toFixed(1)}kg
                </span>
              </div>
            </div>
          </div>

          {actionError && (
            <div role="alert" className="mb-4 bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
              {actionError}
            </div>
          )}
        </Modal>
      )}

      {showRejectModal && currentRecord && (
        <Modal
          onClose={() => setShowRejectModal(false)}
          dismissible={!processingAction}
          title="Reject request?"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setShowRejectModal(false)}
                disabled={processingAction}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmReject}
                disabled={processingAction}
              >
                {processingAction ? 'Processing…' : 'Reject'}
              </Button>
            </>
          }
        >
          <p className="text-muted mb-4">
            Are you sure you want to reject this{' '}
            {currentRecord.type === 'stocking'
              ? 'stocking'
              : currentRecord.type === 'fish_transfer'
                ? 'fish transfer'
                : 'top-up'}{' '}
            for{' '}
            <span className="font-medium">{currentRecord.batchNumber}</span>{' '}
            in <span className="font-medium">{currentRecord.cageName}</span>?
          </p>

          <Field
            label="Reason for rejection"
            htmlFor="rejection-reason"
            required
            className="mb-4"
          >
            <Textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={3}
              placeholder="Tell the requester why this was rejected"
              required
            />
          </Field>

          {actionError && (
            <div role="alert" className="mb-4 bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
              {actionError}
            </div>
          )}
        </Modal>
      )}
    </Layout>
  )
}
