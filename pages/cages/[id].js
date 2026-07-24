// Cage details page - stub version
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Layout from '../../components/Layout'
import { cageService } from '../../lib/cageService'

const CageDetailsPage = () => {
  const router = useRouter()
  const { id } = router.query
  const [cage, setCage] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) {
      loadCage()
    }
  }, [id])

  const loadCage = async () => {
    try {
      setLoading(true)
      const response = await cageService.getCageById(id)
      if (response.data) {
        setCage(response.data)
      }
    } catch (error) {
      console.error('Error loading cage:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <div className="text-lg">Loading cage details...</div>
        </div>
      </Layout>
    )
  }

  if (!cage) {
    return (
      <Layout>
        <div className="text-center py-8">
          <h1 className="text-2xl font-bold text-red-600">Cage Not Found</h1>
          <p className="mt-2">The cage you're looking for doesn't exist.</p>
          <button
            onClick={() => router.push('/cages')}
            className="mt-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Back to Cages
          </button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Cage {cage.name}</h1>
          <button
            onClick={() => router.push('/cages')}
            className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
          >
            Back to Cages
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Cage Information</h2>
            <div className="space-y-2">
              <p><strong>Name:</strong> {cage.name}</p>
              <p><strong>Location:</strong> {cage.location}</p>
              <p><strong>Status:</strong> <span className={`px-2 py-1 rounded text-sm ${getStatusColor(cage.status)}`}>{cage.status}</span></p>
              <p><strong>Size:</strong> {cage.size} m³</p>
              <p><strong>Capacity:</strong> {cage.capacity} fish</p>
              <p><strong>Material:</strong> {cage.material}</p>
              <p><strong>Installation Date:</strong> {cage.installationDate ? new Date(cage.installationDate).toLocaleDateString() : 'N/A'}</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Current Status</h2>
            <div className="space-y-2">
              <p><strong>Stocking Date:</strong> {cage.stockingDate ? new Date(cage.stockingDate).toLocaleDateString() : 'N/A'}</p>
              <p><strong>Initial Count:</strong> {cage.initialCount || 'N/A'}</p>
              <p><strong>Current Count:</strong> {cage.currentCount || 'N/A'}</p>
              <p><strong>Initial ABW:</strong> {cage.initialAbw || 'N/A'}g</p>
              <p><strong>Current Weight:</strong> {cage.currentWeight || 'N/A'}g</p>
              <p><strong>Growth Rate:</strong> {cage.growthRate || 'N/A'}%</p>
              <p><strong>Mortality Rate:</strong> {cage.mortalityRate || 'N/A'}%</p>
            </div>
          </div>
        </div>

        {cage.notes && (
          <div className="bg-white p-6 rounded-lg shadow mt-6">
            <h2 className="text-xl font-semibold mb-4">Notes</h2>
            <p>{cage.notes}</p>
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <button
            onClick={() => router.push(`/daily-entry?cage=${cage._id}`)}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Daily Entry
          </button>
          <button
            onClick={() => router.push(`/biweekly-entry?cage=${cage._id}`)}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >
            Biweekly Entry
          </button>
          <button
            onClick={() => router.push(`/harvest-sampling?cage=${cage._id}`)}
            className="bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600"
          >
            Harvest Sampling
          </button>
        </div>
      </div>
    </Layout>
  )
}

function getStatusColor(status) {
  switch (status?.toLowerCase()) {
    case 'active':
      return 'bg-green-100 text-green-800'
    case 'empty':
      return 'bg-gray-100 text-gray-800'
    case 'maintenance':
      return 'bg-yellow-100 text-yellow-800'
    case 'harvested':
      return 'bg-blue-100 text-blue-800'
    case 'fallow':
      return 'bg-purple-100 text-purple-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export default CageDetailsPage