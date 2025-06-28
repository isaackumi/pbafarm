import React, { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { fetchActiveCages, selectActiveCages, selectCagesLoading, selectCagesError } from '../../../store/slices/cagesSlice'

export default function GrowthAnalyticsPage() {
  return (
    <ProtectedRoute>
      <Layout>
        <GrowthAnalytics />
      </Layout>
    </ProtectedRoute>
  )
}

function GrowthAnalytics() {
  const dispatch = useDispatch()
  const cages = useSelector(selectActiveCages)
  const loading = useSelector(selectCagesLoading)
  const error = useSelector(selectCagesError)

  useEffect(() => {
    dispatch(fetchActiveCages())
  }, [dispatch])

  // Calculate growth data
  const growthData = React.useMemo(() => {
    if (!cages || cages.length === 0) return []

    return cages
      .filter(cage => cage.stocking_date && cage.initial_weight && cage.current_weight)
      .map(cage => {
        const stockingDate = new Date(cage.stocking_date)
        const today = new Date()
        const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))
        const growthRate = ((cage.current_weight - cage.initial_weight) / cage.initial_weight) * 100

        return {
          cageId: cage.id,
          cageName: cage.name,
          doc,
          initialWeight: cage.initial_weight,
          currentWeight: cage.current_weight,
          growthRate: growthRate.toFixed(2),
          dailyGrowthRate: (growthRate / doc).toFixed(2)
        }
      })
      .sort((a, b) => b.growthRate - a.growthRate)
  }, [cages])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent"></div>
            <p className="mt-2 text-gray-600">Loading growth analytics...</p>
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
          <div className="text-center text-gray-500">No cage data available.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Growth Analytics</h1>
        
        <div className="grid grid-cols-1 gap-6">
          {/* Growth Rate Chart */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Growth Rate Analysis</h2>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={growthData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="cageName" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="growthRate" name="Growth Rate (%)" stroke="#8884d8" />
                  <Line type="monotone" dataKey="dailyGrowthRate" name="Daily Growth Rate (%)" stroke="#82ca9d" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Weight Comparison Chart */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Weight Comparison</h2>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={growthData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="cageName" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="initialWeight" name="Initial Weight (g)" stroke="#8884d8" />
                  <Line type="monotone" dataKey="currentWeight" name="Current Weight (g)" stroke="#82ca9d" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Growth Data Table */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Growth Data</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cage Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">DOC</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Initial Weight</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Weight</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Growth Rate</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Daily Growth Rate</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {growthData.map((cage) => (
                    <tr key={cage.cageId}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{cage.cageName}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cage.doc} days</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cage.initialWeight} g</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cage.currentWeight} g</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cage.growthRate}%</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cage.dailyGrowthRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 