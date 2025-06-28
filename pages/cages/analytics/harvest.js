import React, { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { fetchHarvestReadyCages, selectHarvestReadyCages, selectCagesLoading, selectCagesError } from '../../../store/slices/cagesSlice'

export default function HarvestAnalyticsPage() {
  return (
    <ProtectedRoute>
      <Layout>
        <HarvestAnalytics />
      </Layout>
    </ProtectedRoute>
  )
}

function HarvestAnalytics() {
  const dispatch = useDispatch()
  const cages = useSelector(selectHarvestReadyCages)
  const loading = useSelector(selectCagesLoading)
  const error = useSelector(selectCagesError)

  useEffect(() => {
    dispatch(fetchHarvestReadyCages())
  }, [dispatch])

  // Calculate harvest readiness data
  const harvestData = React.useMemo(() => {
    if (!cages || cages.length === 0) return []

    return cages
      .filter(cage => cage.stocking_date)
      .map(cage => {
        const stockingDate = new Date(cage.stocking_date)
        const today = new Date()
        const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))
        const daysToHarvest = Math.max(0, 120 - doc) // 120 days is the harvest threshold

        return {
          cageId: cage.id,
          cageName: cage.name,
          doc,
          daysToHarvest,
          initialWeight: cage.initial_weight || 0,
          currentWeight: cage.current_weight || 0,
          growthRate: cage.growth_rate || 0,
          status: daysToHarvest <= 0 ? 'Ready' : daysToHarvest <= 20 ? 'Soon' : 'Growing'
        }
      })
      .sort((a, b) => a.daysToHarvest - b.daysToHarvest)
  }, [cages])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent"></div>
            <p className="mt-2 text-gray-600">Loading harvest analytics...</p>
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
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Harvest Analytics</h1>
        
        <div className="grid grid-cols-1 gap-6">
          {/* Harvest Readiness Chart */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Harvest Readiness</h2>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={harvestData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="cageName" />
                  <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                  <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="doc" name="Days of Culture" fill="#8884d8" />
                  <Bar yAxisId="right" dataKey="daysToHarvest" name="Days to Harvest" fill="#82ca9d" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Growth Rate Chart */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Growth Rate Analysis</h2>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={harvestData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="cageName" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="initialWeight" name="Initial Weight" fill="#8884d8" />
                  <Bar dataKey="currentWeight" name="Current Weight" fill="#82ca9d" />
                  <Bar dataKey="growthRate" name="Growth Rate" fill="#ffc658" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Harvest Ready Cages Table */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Harvest Ready Cages</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cage Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">DOC</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Days to Harvest</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Initial Weight</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Weight</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Growth Rate</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {harvestData.map((cage) => (
                    <tr key={cage.cageId}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{cage.cageName}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cage.doc} days</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cage.daysToHarvest} days</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cage.initialWeight} g</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cage.currentWeight} g</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cage.growthRate}%</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          cage.status === 'Ready' ? 'bg-red-100 text-red-800' :
                          cage.status === 'Soon' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {cage.status}
                        </span>
                      </td>
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