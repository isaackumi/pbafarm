import React, { useState, useEffect } from 'react'
import companyService from '../lib/companyService'
import { useToast } from './Toast'

const AdminCompanyRegistrationsPage = () => {
  const [pendingRegistrations, setPendingRegistrations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { showToast } = useToast()

  useEffect(() => {
    loadPendingRegistrations()
  }, [])

  const loadPendingRegistrations = async () => {
    try {
      setLoading(true)
      setError('')
      const response = await companyService.listPendingRegistrations()
      if (response.error) throw response.error
      setPendingRegistrations(response.data || [])
    } catch (err) {
      console.error('Error loading pending registrations:', err)
      setError(err.message || 'Failed to load registrations')
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (company) => {
    const companyId = company.id || company._id
    const userId = company.submitted_by_user_id
    if (!userId) {
      showToast(
        'Cannot approve: this registration has no submitting user. Ask them to register again.',
        'error',
      )
      return
    }
    try {
      const { error } = await companyService.approveRegistration(companyId, userId)
      if (error) throw error
      showToast(`${company.name || 'Company'} approved`, 'success')
      await loadPendingRegistrations()
    } catch (err) {
      console.error('Error approving company:', err)
      showToast(err.message || 'Could not approve the company', 'error')
    }
  }

  const handleReject = async (company) => {
    const companyId = company.id || company._id
    const reason = prompt('Enter rejection reason:')
    if (!reason) return

    try {
      const { error } = await companyService.rejectRegistration(companyId, reason)
      if (error) throw error
      showToast('Registration rejected', 'success')
      await loadPendingRegistrations()
    } catch (err) {
      console.error('Error rejecting company:', err)
      showToast(err.message || 'Could not reject the registration', 'error')
    }
  }

  if (loading) {
    return <div className="p-4 text-muted">Loading pending registrations…</div>
  }

  return (
    <div className="p-6">
      <h2 className="font-display text-2xl font-semibold text-chart-ink mb-6">
        Company Registration Approvals
      </h2>

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-signal/30 bg-signal/10 text-sm text-signal">
          {error}
        </div>
      )}

      {pendingRegistrations.length === 0 ? (
        <p className="text-muted">No pending registrations</p>
      ) : (
        <div className="space-y-4">
          {pendingRegistrations.map((company) => (
            <div
              key={company.id || company._id}
              className="page-card p-4"
            >
              <h3 className="font-semibold text-lg text-chart-ink">{company.name}</h3>
              <p className="text-sm text-muted font-data">{company.code}</p>
              <p className="text-muted">{company.contact_email}</p>
              <p className="text-muted">{company.address}</p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => handleApprove(company)}
                  className="btn-primary"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => handleReject(company)}
                  className="btn-danger"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default AdminCompanyRegistrationsPage
