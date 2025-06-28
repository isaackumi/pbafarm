import React, { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import Link from 'next/link'
import { ArrowLeft, Tool, AlertCircle } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { fetchMaintenanceCages, selectMaintenanceCages, selectCagesLoading, selectCagesError } from '../../store/slices/cagesSlice'

export default function MaintenancePage() {
  return (
    <ProtectedRoute>
      <Layout>
        <MaintenanceCages />
      </Layout>
    </ProtectedRoute>
  )
}

function MaintenanceCages() {
  const dispatch = useDispatch()
  const cages = useSelector(selectMaintenanceCages)
  const loading = useSelector(selectCagesLoading)
  const error = useSelector(selectCagesError)

  useEffect(() => {
    dispatch(fetchMaintenanceCages())
  }, [dispatch])

  // Calculate maintenance data
  const maintenanceData = React.useMemo(() => {
    if (!cages || cages.length === 0) return []

    return cages
      .filter(cage => cage.last_maintenance_date)
      .map(cage => {
        const lastMaintenance = new Date(cage.last_maintenance_date)
        const today = new Date()
        const daysSinceMaintenance = Math.floor((today - lastMaintenance) / (1000 * 60 * 60 * 24))
        const maintenanceDue = Math.max(0, 30 - daysSinceMaintenance) // 30 days maintenance interval

        return {
          ...cage,
          daysSinceMaintenance,
          maintenanceDue,
          status: maintenanceDue <= 0 ? 'Overdue' : maintenanceDue <= 7 ? 'Due Soon' : 'Maintained'
        }
      })
      .sort((a, b) => a.maintenanceDue - b.maintenanceDue)
  }, [cages])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent"></div>
            <p className="mt-2 text-gray-600">Loading maintenance cages...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!cages || cages.length === 0) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center text-gray-500">No maintenance cages available.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Link href="/cages">
              <button className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to Cages
              </button>
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Maintenance Cages</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {maintenanceData.map((cage) => (
            <div
              key={cage.id}
              className="bg-white rounded-lg shadow p-6 border border-gray-200 hover:border-indigo-400 transition-colors"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">{cage.name}</h3>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                  cage.status === 'Overdue' ? 'bg-red-100 text-red-800' :
                  cage.status === 'Due Soon' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-green-100 text-green-800'
                }`}>
                  {cage.status}
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Last Maintenance:</span>
                  <span className="text-sm font-medium text-gray-900">
                    {new Date(cage.last_maintenance_date).toLocaleDateString()}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Days Since Maintenance:</span>
                  <span className="text-sm font-medium text-gray-900">{cage.daysSinceMaintenance} days</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Maintenance Due In:</span>
                  <span className="text-sm font-medium text-gray-900">{cage.maintenanceDue} days</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Location:</span>
                  <span className="text-sm font-medium text-gray-900">{cage.location}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Size:</span>
                  <span className="text-sm font-medium text-gray-900">{cage.size} m³</span>
                </div>

                {cage.status === 'Overdue' && (
                  <div className="mt-4 p-3 bg-red-50 rounded-md">
                    <div className="flex items-center text-red-800">
                      <AlertCircle className="w-4 h-4 mr-2" />
                      <span className="text-sm font-medium">Maintenance overdue</span>
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  <Link href={`/cage/${cage.id}`}>
                    <button className="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                      View Details
                    </button>
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
} 