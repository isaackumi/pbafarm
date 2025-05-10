// components/AdminCompanyRegistrationsPage.js
import React, { useState, useEffect } from 'react'
import {
  CheckCircle,
  XCircle,
  Briefcase,
  User,
  Mail,
  Clock,
  AlertTriangle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

const AdminCompanyRegistrationsPage = () => {
  const [loading, setLoading] = useState(true)
  const [registrations, setRegistrations] = useState([])
  const [selectedRegistration, setSelectedRegistration] = useState(null)
  const [reviewingId, setReviewingId] = useState(null)
  const [rejectionFeedback, setRejectionFeedback] = useState('')
  const [showRejectionForm, setShowRejectionForm] = useState(false)
  const [actionSuccess, setActionSuccess] = useState({
    show: false,
    message: '',
    type: '',
  })

  // Load registrations
  useEffect(() => {
    const fetchRegistrations = async () => {
      try {
        setLoading(true)

        // Fetch pending registrations using the view
        const { data, error } = await supabase
          .from('pending_company_approvals')
          .select('*')
          .order('submitted_at', { ascending: false })

        if (error) throw error

        setRegistrations(data || [])
      } catch (error) {
        console.error('Error fetching registrations:', error)
        // Show error to user
      } finally {
        setLoading(false)
      }
    }

    fetchRegistrations()
  }, [])

  const handleViewDetails = (registration) => {
    setSelectedRegistration(registration)
  }

  const handleApprove = async (id) => {
    setReviewingId(id)

    try {
      // Get the current user for admin_id
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) throw new Error('User not authenticated')

      // Call the approve function
      const { data, error } = await supabase.rpc(
        'approve_company_registration',
        {
          registration_id: id,
          admin_id: user.id,
        },
      )

      if (error) throw error

      // Remove from list
      setRegistrations(registrations.filter((reg) => reg.id !== id))

      // Show success message
      setActionSuccess({
        show: true,
        message: 'Company registration approved successfully!',
        type: 'success',
      })

      // Hide after 5 seconds
      setTimeout(() => {
        setActionSuccess({ show: false, message: '', type: '' })
      }, 5000)
    } catch (error) {
      console.error('Error approving registration:', error)

      setActionSuccess({
        show: true,
        message: 'Error approving registration: ' + error.message,
        type: 'error',
      })

      setTimeout(() => {
        setActionSuccess({ show: false, message: '', type: '' })
      }, 5000)
    } finally {
      setReviewingId(null)
      setSelectedRegistration(null)
    }
  }

  const handleReject = async (id) => {
    // Show rejection form
    setReviewingId(id)
    setShowRejectionForm(true)
  }

  const submitRejection = async () => {
    try {
      if (!rejectionFeedback) {
        alert('Please provide feedback for the rejection')
        return
      }

      // Get the current user for admin_id
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) throw new Error('User not authenticated')

      // Call the reject function
      const { data, error } = await supabase.rpc(
        'reject_company_registration',
        {
          registration_id: reviewingId,
          admin_id: user.id,
          rejection_feedback: rejectionFeedback,
        },
      )

      if (error) throw error

      // Remove from list
      setRegistrations(registrations.filter((reg) => reg.id !== reviewingId))

      // Show success message
      setActionSuccess({
        show: true,
        message: 'Company registration rejected with feedback.',
        type: 'warning',
      })

      // Reset form
      setRejectionFeedback('')
      setShowRejectionForm(false)

      // Hide after 5 seconds
      setTimeout(() => {
        setActionSuccess({ show: false, message: '', type: '' })
      }, 5000)
    } catch (error) {
      console.error('Error rejecting registration:', error)

      setActionSuccess({
        show: true,
        message: 'Error rejecting registration: ' + error.message,
        type: 'error',
      })

      setTimeout(() => {
        setActionSuccess({ show: false, message: '', type: '' })
      }, 5000)
    } finally {
      setReviewingId(null)
      setSelectedRegistration(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-gray-900">
            Company Registration Approvals
          </h1>
          <p className="mt-3 max-w-2xl mx-auto text-xl text-gray-500 sm:mt-4">
            Review and approve company registration requests
          </p>
        </div>

        {/* Success/Error Message */}
        {actionSuccess.show && (
          <div
            className={`mt-8 mx-auto max-w-3xl rounded-md p-4 ${
              actionSuccess.type === 'success'
                ? 'bg-green-50 border border-green-400'
                : actionSuccess.type === 'warning'
                ? 'bg-yellow-50 border border-yellow-400'
                : 'bg-red-50 border border-red-400'
            }`}
          >
            <div className="flex">
              <div className="flex-shrink-0">
                {actionSuccess.type === 'success' ? (
                  <CheckCircle className="h-5 w-5 text-green-400" />
                ) : actionSuccess.type === 'warning' ? (
                  <AlertTriangle className="h-5 w-5 text-yellow-400" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-400" />
                )}
              </div>
              <div className="ml-3">
                <p
                  className={`text-sm font-medium ${
                    actionSuccess.type === 'success'
                      ? 'text-green-800'
                      : actionSuccess.type === 'warning'
                      ? 'text-yellow-800'
                      : 'text-red-800'
                  }`}
                >
                  {actionSuccess.message}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Registration List */}
        <div className="mt-8 mx-auto max-w-3xl">
          {registrations.length === 0 ? (
            <div className="bg-white shadow overflow-hidden sm:rounded-md py-12">
              <div className="text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-green-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">
                  No pending registrations
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  All company registrations have been processed.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <ul className="divide-y divide-gray-200">
                {registrations.map((registration) => (
                  <li
                    key={registration.id}
                    className="px-6 py-4 flex items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center">
                        <div className="bg-indigo-100 rounded-full p-2 mr-3">
                          <Briefcase className="h-5 w-5 text-indigo-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {registration.name}
                            {registration.abbreviation && (
                              <span className="ml-1 text-gray-500">
                                ({registration.abbreviation})
                              </span>
                            )}
                          </p>
                          <div className="flex items-center text-sm text-gray-500">
                            <User className="flex-shrink-0 mr-1 h-4 w-4" />
                            <span>{registration.user_name}</span>
                          </div>
                          <div className="flex items-center text-sm text-gray-500">
                            <Mail className="flex-shrink-0 mr-1 h-4 w-4" />
                            <span>{registration.contact_email}</span>
                          </div>
                          <div className="flex items-center text-sm text-gray-500 mt-1">
                            <Clock className="flex-shrink-0 mr-1 h-4 w-4" />
                            <span>
                              Submitted:{' '}
                              {new Date(
                                registration.submitted_at,
                              ).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="ml-5 flex-shrink-0 flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => handleViewDetails(registration)}
                        className="inline-flex items-center px-2.5 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                      >
                        Details
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove(registration.id)}
                        disabled={reviewingId === registration.id}
                        className={`inline-flex items-center px-2.5 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white ${
                          reviewingId === registration.id
                            ? 'bg-green-300 cursor-not-allowed'
                            : 'bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500'
                        }`}
                      >
                        {reviewingId === registration.id ? (
                          <>
                            <svg
                              className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              ></circle>
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              ></path>
                            </svg>
                            Processing
                          </>
                        ) : (
                          <>
                            <CheckCircle className="-ml-0.5 mr-1 h-4 w-4" />
                            Approve
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(registration.id)}
                        disabled={reviewingId === registration.id}
                        className={`inline-flex items-center px-2.5 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white ${
                          reviewingId === registration.id
                            ? 'bg-red-300 cursor-not-allowed'
                            : 'bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500'
                        }`}
                      >
                        <XCircle className="-ml-0.5 mr-1 h-4 w-4" />
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Registration Details Modal */}
        {selectedRegistration && (
          <div
            className="fixed z-10 inset-0 overflow-y-auto"
            aria-labelledby="modal-title"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div
                className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
                aria-hidden="true"
              ></div>

              <span
                className="hidden sm:inline-block sm:align-middle sm:h-screen"
                aria-hidden="true"
              >
                &#8203;
              </span>

              <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
                <div>
                  <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100">
                    <Briefcase className="h-6 w-6 text-indigo-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-5">
                    <h3
                      className="text-lg leading-6 font-medium text-gray-900"
                      id="modal-title"
                    >
                      {selectedRegistration.name}
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Registration details for company approval review.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 sm:mt-6">
                  <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                    <div className="sm:col-span-3">
                      <label className="block text-sm font-medium text-gray-700">
                        Company Name
                      </label>
                      <div className="mt-1">
                        <p className="text-sm text-gray-900">
                          {selectedRegistration.name}
                        </p>
                      </div>
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-sm font-medium text-gray-700">
                        Abbreviation
                      </label>
                      <div className="mt-1">
                        <p className="text-sm text-gray-900">
                          {selectedRegistration.abbreviation || '-'}
                        </p>
                      </div>
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-sm font-medium text-gray-700">
                        Industry
                      </label>
                      <div className="mt-1">
                        <p className="text-sm text-gray-900">
                          {selectedRegistration.industry}
                        </p>
                      </div>
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-sm font-medium text-gray-700">
                        Submitted By
                      </label>
                      <div className="mt-1">
                        <p className="text-sm text-gray-900">
                          {selectedRegistration.user_name}
                        </p>
                      </div>
                    </div>

                    <div className="sm:col-span-6">
                      <label className="block text-sm font-medium text-gray-700">
                        Contact Email
                      </label>
                      <div className="mt-1">
                        <p className="text-sm text-gray-900">
                          {selectedRegistration.contact_email}
                        </p>
                      </div>
                    </div>

                    <div className="sm:col-span-6">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setSelectedRegistration(null)}
                          className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                          Close
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApprove(selectedRegistration.id)}
                          disabled={reviewingId === selectedRegistration.id}
                          className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(selectedRegistration.id)}
                          disabled={reviewingId === selectedRegistration.id}
                          className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Rejection Form Modal */}
        {showRejectionForm && (
          <div
            className="fixed z-10 inset-0 overflow-y-auto"
            aria-labelledby="modal-title"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div
                className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
                aria-hidden="true"
              ></div>

              <span
                className="hidden sm:inline-block sm:align-middle sm:h-screen"
                aria-hidden="true"
              >
                &#8203;
              </span>

              <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
                <div>
                  <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                    <XCircle className="h-6 w-6 text-red-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-5">
                    <h3
                      className="text-lg leading-6 font-medium text-gray-900"
                      id="modal-title"
                    >
                      Reject Company Registration
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Please provide feedback explaining why this registration
                        is being rejected.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 sm:mt-6">
                  <label
                    htmlFor="rejection-feedback"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Rejection Feedback
                  </label>
                  <div className="mt-1">
                    <textarea
                      id="rejection-feedback"
                      name="rejection-feedback"
                      rows="4"
                      className="shadow-sm focus:ring-red-500 focus:border-red-500 block w-full sm:text-sm border-gray-300 rounded-md"
                      placeholder="Explain why this registration is being rejected..."
                      value={rejectionFeedback}
                      onChange={(e) => setRejectionFeedback(e.target.value)}
                    ></textarea>
                  </div>

                  <div className="mt-5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:grid-flow-row-dense">
                    <button
                      type="button"
                      onClick={() => {
                        setShowRejectionForm(false)
                        setReviewingId(null)
                        setRejectionFeedback('')
                      }}
                      className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:col-start-1 sm:text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitRejection}
                      className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:col-start-2 sm:text-sm"
                    >
                      Confirm Rejection
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminCompanyRegistrationsPage
