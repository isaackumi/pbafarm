import React, { useState, useEffect } from 'react'
import companyService from '../lib/companyService'

const AdminCompanyRegistrationsPage = () => {
  const [pendingRegistrations, setPendingRegistrations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
      alert(
        'Cannot approve: no submitting user on this registration. Re-register the company after updating.',
      )
      return
    }
    try {
      const { error } = await companyService.approveRegistration(companyId, userId)
      if (error) throw error
      await loadPendingRegistrations()
    } catch (err) {
      console.error('Error approving company:', err)
      alert(err.message || 'Error approving company')
    }
  }

  const handleReject = async (company) => {
    const companyId = company.id || company._id
    const reason = prompt('Enter rejection reason:')
    if (!reason) return

    try {
      const { error } = await companyService.rejectRegistration(companyId, reason)
      if (error) throw error
      await loadPendingRegistrations()
    } catch (err) {
      console.error('Error rejecting company:', err)
      alert(err.message || 'Error rejecting company')
    }
  }

  if (loading) {
    return <div className="p-4 text-muted">Loading pending registrations…</div>
  }

  return (
    <div className="p-6">
      <h2 className="font-display text-2xl font-bold text-chart-ink mb-6">
        Company Registration Approvals
      </h2>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-signal/30 bg-signal/10 text-sm text-signal">
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
