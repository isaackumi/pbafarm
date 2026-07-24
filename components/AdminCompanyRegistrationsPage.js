// Stub component for AdminCompanyRegistrationsPage
import React, { useState, useEffect } from 'react'
import companyService from '../lib/companyService'

const AdminCompanyRegistrationsPage = () => {
  const [pendingRegistrations, setPendingRegistrations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPendingRegistrations()
  }, [])

  const loadPendingRegistrations = async () => {
    try {
      setLoading(true)
      const response = await companyService.listPendingRegistrations()
      if (response.data) {
        setPendingRegistrations(response.data)
      }
    } catch (error) {
      console.error('Error loading pending registrations:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (companyId) => {
    try {
      await companyService.approveRegistration(companyId)
      alert('Company approved successfully!')
      loadPendingRegistrations()
    } catch (error) {
      console.error('Error approving company:', error)
      alert('Error approving company')
    }
  }

  const handleReject = async (companyId) => {
    const reason = prompt('Enter rejection reason:')
    if (!reason) return
    
    try {
      await companyService.rejectRegistration(companyId, reason)
      alert('Company rejected')
      loadPendingRegistrations()
    } catch (error) {
      console.error('Error rejecting company:', error)
      alert('Error rejecting company')
    }
  }

  if (loading) {
    return <div className="p-4">Loading pending registrations...</div>
  }

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Company Registration Approvals</h2>
      
      {pendingRegistrations.length === 0 ? (
        <p className="text-gray-600">No pending registrations</p>
      ) : (
        <div className="space-y-4">
          {pendingRegistrations.map(company => (
            <div key={company._id} className="bg-white p-4 rounded-lg shadow border">
              <h3 className="font-semibold text-lg">{company.name}</h3>
              <p className="text-gray-600">{company.email}</p>
              <p className="text-gray-600">{company.address}</p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => handleApprove(company._id)}
                  className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleReject(company._id)}
                  className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
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