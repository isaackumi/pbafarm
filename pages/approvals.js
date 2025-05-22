// pages/approvals.js
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertCircle,
  Calendar,
  Clock,
  User,
  Info,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { useAuth } from '../contexts/AuthContext'
import stockingService from '../lib/stockingService'
import { useToast } from '../components/Toast'

export default function ApprovalsPage() {
  return (
    <ProtectedRoute>
      <PendingApprovals />
    </ProtectedRoute>
  )
}

function PendingApprovals() {
  const router = useRouter()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [approvals, setApprovals] = useState({
    all: [],
    stockings: [],
    topups: [],
  })
  const [currentRecord, setCurrentRecord] = useState(null)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [processingAction, setProcessingAction] = useState(false)
  const [error, setError] = useState('')

  // Fetch pending approvals on mount
  useEffect(() => {
    fetchPendingApprovals()
  }, [])

  const fetchPendingApprovals = async () => {
    setLoading(true)
    try {
      const { data, error } = await stockingService.getPendingApprovals()

      if (error) throw error

      console.log('Pending approvals:', data)
      setApprovals(data || { all: [], stockings: [], topups: [] })
    } catch (error) {
      console.error('Error fetching pending approvals:', error)
      setError('Failed to load pending approvals')
      showToast('error', 'Failed to load pending approvals')
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = (record) => {
    setCurrentRecord(record)
    setShowApproveModal(true)
  }

  const handleReject = (record) => {
    setCurrentRecord(record)
    setRejectionReason('')
    setShowRejectModal(true)
  }

  const confirmApprove = async () => {
    if (!currentRecord) return

    setProcessingAction(true)
    try {
      const { error } = await stockingService.approveRecord(
        currentRecord.type,
        currentRecord.id,
        user.id,
      )

      if (error) throw error

      showToast(
        'success',
        `${
          currentRecord.type === 'stocking' ? 'Stocking' : 'Top-up'
        } approved successfully`,
      )

      // Close modal and refresh data
      setShowApproveModal(false)
      setCurrentRecord(null)
      fetchPendingApprovals()
    } catch (error) {
      console.error('Error approving record:', error)
      setError(error.message)
      showToast('error', `Failed to approve: ${error.message}`)
    } finally {
      setProcessingAction(false)
    }
  }

  const confirmReject = async () => {
    if (!currentRecord) return

    if (!rejectionReason.trim()) {
      setError('Please provide a reason for rejection')
      return
    }

    setProcessingAction(true)
    try {
      const { error } = await stockingService.rejectRecord(
        currentRecord.type,
        currentRecord.id,
        user.id,
        rejectionReason,
      )

      if (error) throw error

      showToast(
        'success',
        `${currentRecord.type === 'stocking' ? 'Stocking' : 'Top-up'} rejected`,
      )

      // Close modal and refresh data
      setShowRejectModal(false)
      setCurrentRecord(null)
      setRejectionReason('')
      fetchPendingApprovals()
    } catch (error) {
      console.error('Error rejecting record:', error)
      setError(error.message)
      showToast('error', `Failed to reject: ${error.message}`)
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
    <div className="min-h-screen bg-gray-100 font-montserrat">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center mb-6">
          <Link
            href="/dashboard"
            className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            Pending Approvals
          </h1>
        </div>

        <div className="mb-6">
          <p className="text-gray-600">
            Review and manage pending stocking and top-up approvals.
          </p>
        </div>

        {/* Main Content */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {loading ? (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-3 text-gray-500">Loading pending approvals...</p>
            </div>
          ) : approvals.all.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Type
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Batch/Cage
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Date
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Quantity
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Requested
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {approvals.all.map((record) => (
                    <tr
                      key={`${record.type}-${record.id}`}
                      className="hover:bg-gray-50"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 inline-flex text-xs leading-5 font-medium rounded-full ${
                            record.type === 'stocking'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-orange-100 text-orange-800'
                          }`}
                        >
                          {record.type === 'stocking' ? 'Stocking' : 'Top-up'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <div className="text-sm font-medium text-gray-900">
                            {record.batchNumber}
                          </div>
                          <div className="text-sm text-gray-500">
                            {record.cageName}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <Calendar className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-900">
                            {formatDate(record.date)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {record.count.toLocaleString()} fish
                        </div>
                        <div className="text-sm text-gray-500">
                          {record.abw.toFixed(1)}g /{' '}
                          {(record.biomass || 0).toFixed(1)}kg
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <Clock className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" />
                          <div className="text-sm text-gray-500">
                            {formatDate(record.createdAt)}{' '}
                            <span className="text-xs">
                              {formatTime(record.createdAt)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-3">
                          <button
                            onClick={() => handleApprove(record)}
                            className="text-green-600 hover:text-green-900"
                            title="Approve"
                          >
                            <CheckCircle className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleReject(record)}
                            className="text-red-600 hover:text-red-900"
                            title="Reject"
                          >
                            <XCircle className="h-5 w-5" />
                          </button>
                          <Link
                            href={`/${record.type}/${record.id}/details`}
                            className="text-blue-600 hover:text-blue-900"
                            title="View Details"
                          >
                            <Info className="h-5 w-5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <AlertCircle className="h-12 w-12 text-gray-400 mx-auto" />
              <p className="mt-3 text-gray-500">No pending approvals found.</p>
              <p className="text-sm text-gray-400">
                All stocking and top-up requests have been processed.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Approve Confirmation Modal */}
      {showApproveModal && currentRecord && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => !processingAction && setShowApproveModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Confirm Approval
            </h3>

            <p className="text-gray-600 mb-4">
              Are you sure you want to approve this{' '}
              {currentRecord.type === 'stocking' ? 'stocking' : 'top-up'} for{' '}
              <span className="font-medium">{currentRecord.batchNumber}</span>{' '}
              in <span className="font-medium">{currentRecord.cageName}</span>?
            </p>

            <div className="bg-blue-50 p-3 rounded-md mb-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="font-medium text-blue-800">Date:</span>{' '}
                  <span className="text-blue-800">
                    {formatDate(currentRecord.date)}
                  </span>
                </div>
                <div>
                  <span className="font-medium text-blue-800">Quantity:</span>{' '}
                  <span className="text-blue-800">
                    {currentRecord.count.toLocaleString()} fish
                  </span>
                </div>
                <div>
                  <span className="font-medium text-blue-800">ABW:</span>{' '}
                  <span className="text-blue-800">
                    {currentRecord.abw.toFixed(1)}g
                  </span>
                </div>
                <div>
                  <span className="font-medium text-blue-800">Biomass:</span>{' '}
                  <span className="text-blue-800">
                    {(currentRecord.biomass || 0).toFixed(1)}kg
                  </span>
                </div>
              </div>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 text-red-800 p-3 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowApproveModal(false)}
                disabled={processingAction}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmApprove}
                disabled={processingAction}
                className={`px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                  processingAction
                    ? 'bg-green-400'
                    : 'bg-green-600 hover:bg-green-700'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500`}
              >
                {processingAction ? 'Processing...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Confirmation Modal */}
      {showRejectModal && currentRecord && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => !processingAction && setShowRejectModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Confirm Rejection
            </h3>

            <p className="text-gray-600 mb-4">
              Are you sure you want to reject this{' '}
              {currentRecord.type === 'stocking' ? 'stocking' : 'top-up'} for{' '}
              <span className="font-medium">{currentRecord.batchNumber}</span>{' '}
              in <span className="font-medium">{currentRecord.cageName}</span>?
            </p>

            {/* Rejection Reason */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Rejection <span className="text-red-500">*</span>
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows="3"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Please provide a reason for rejection"
                required
              ></textarea>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 text-red-800 p-3 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                disabled={processingAction}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmReject}
                disabled={processingAction}
                className={`px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                  processingAction
                    ? 'bg-red-400'
                    : 'bg-red-600 hover:bg-red-700'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500`}
              >
                {processingAction ? 'Processing...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
