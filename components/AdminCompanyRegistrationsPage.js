import React from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useToast } from './Toast'
import { LoadingState } from './ui'

const AdminCompanyRegistrationsPage = () => {
  const pending = useQuery(api.companies.listPending, {})
  const approve = useMutation(api.companies.approve)
  const reject = useMutation(api.companies.reject)
  const pendingRegistrations = pending ?? []
  const { showToast } = useToast()

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
      await approve({ companyId, userId })
      showToast(`${company.name || 'Company'} approved`, 'success')
    } catch (err) {
      console.error('Error approving company:', err)
      showToast(errorMessage(err, 'Could not approve the company'), 'error')
    }
  }

  const handleReject = async (company) => {
    const companyId = company.id || company._id
    const reason = prompt('Enter rejection reason:')
    if (!reason) return

    try {
      await reject({ companyId, reason })
      showToast('Registration rejected', 'success')
    } catch (err) {
      console.error('Error rejecting company:', err)
      showToast(errorMessage(err, 'Could not reject the registration'), 'error')
    }
  }

  if (pending === undefined) {
    return <LoadingState label="Loading pending registrations…" />
  }

  return (
    <div className="p-6">
      <h2 className="font-display text-2xl font-semibold text-chart-ink mb-6">
        Company Registration Approvals
      </h2>

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
