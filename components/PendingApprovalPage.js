// Stub component for PendingApprovalPage
import React, { useState, useEffect } from 'react'
import stockingService from '../lib/stockingService'

const PendingApprovalPage = () => {
  const [pendingApprovals, setPendingApprovals] = useState({
    stockings: [],
    topups: [],
    all: []
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPendingApprovals()
  }, [])

  const loadPendingApprovals = async () => {
    try {
      setLoading(true)
      const response = await stockingService.getPendingApprovals()
      if (response.data) {
        setPendingApprovals(response.data)
      }
    } catch (error) {
      console.error('Error loading pending approvals:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (type, id) => {
    try {
      await stockingService.approveRecord(type, id, 'current_user')
      alert(`${type} approved successfully!`)
      loadPendingApprovals()
    } catch (error) {
      console.error(`Error approving ${type}:`, error)
      alert(`Error approving ${type}`)
    }
  }

  const handleReject = async (type, id) => {
    const reason = prompt('Enter rejection reason:')
    if (!reason) return
    
    try {
      await stockingService.rejectRecord(type, id, 'current_user', reason)
      alert(`${type} rejected`)
      loadPendingApprovals()
    } catch (error) {
      console.error(`Error rejecting ${type}:`, error)
      alert(`Error rejecting ${type}`)
    }
  }

  if (loading) {
    return <div className="p-4">Loading pending approvals...</div>
  }

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Pending Approvals</h2>
      
      {pendingApprovals.all.length === 0 ? (
        <p className="text-muted">No pending approvals</p>
      ) : (
        <div className="space-y-4">
          {pendingApprovals.all.map(item => (
            <div key={`${item.type}-${item.id}`} className="bg-white p-4 rounded-lg shadow border">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-lg">
                    {item.type === 'stocking' ? 'Stocking Request' : 'Top-up Request'}
                  </h3>
                  <p className="text-muted">Cage: {item.cageName}</p>
                  <p className="text-muted">Batch: {item.batchNumber}</p>
                  <p className="text-muted">Date: {new Date(item.date).toLocaleDateString()}</p>
                  <p className="text-muted">Count: {item.count} fish</p>
                  <p className="text-muted">ABW: {item.abw}g</p>
                  <p className="text-muted">Created: {new Date(item.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(item.type, item.id)}
                    className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600 text-sm"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(item.type, item.id)}
                    className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 text-sm"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default PendingApprovalPage