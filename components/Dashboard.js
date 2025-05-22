// components/Dashboard.js (Complete)
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { Calculator, Scale, AlertTriangle, Droplets, Plus } from 'lucide-react'
import {
  LineChart as RechartsLineChart,
  Line,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  cageService,
  stockingService,
  dailyRecordService,
  biweeklyRecordService,
} from '../lib/databaseService'
import BiweeklyForm from './BiweeklyForm'
import HarvestForm from './HarvestForm'
import DailyEntryForm from './DailyEntryForm'
import Pagination from './Pagination'
import DataTable from './DataTable'

const Dashboard = ({ activeTab, selectedCage }) => {
  const router = useRouter()
  const [cages, setCages] = useState([])
  const [dailyRecords, setDailyRecords] = useState([])
  const [biweeklyRecords, setBiweeklyRecords] = useState([])
  const [recentStockings, setRecentStockings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [metrics, setMetrics] = useState({
    totalActiveCages: 0,
    totalBiomass: 0,
    averageFCR: 'N/A',
    mortalityRate: '0.0',
  })

  console.log(
    'Dashboard rendered with activeTab:',
    activeTab,
    'selectedCage:',
    selectedCage,
  )

  // Fetch data from database
  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      try {
        console.log('Fetching data for dashboard...')

        // Fetch cages
        const {
          data: cagesData,
          error: cagesError,
        } = await cageService.getAllCages()
        if (cagesError) throw cagesError
        console.log('Fetched cages:', cagesData)
        setCages(cagesData || [])

        // Calculate total active cages
        const activeCages =
          cagesData?.filter((cage) => cage.status === 'active') || []

        // Fetch recent stockings
        const {
          data: stockingsData,
          error: stockingsError,
        } = await stockingService.getAllStockings()
        if (stockingsError) throw stockingsError
        console.log('Fetched stockings:', stockingsData)

        // Sort and get most recent stockings
        const sortedStockings =
          stockingsData?.sort(
            (a, b) => new Date(b.stocking_date) - new Date(a.stocking_date),
          ) || []

        setRecentStockings(sortedStockings)

        // Fetch other metrics as needed for dashboard
        updateDashboardMetrics(cagesData, stockingsData)
      } catch (error) {
        console.error('Error fetching data:', error.message)
        setError(error.message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  // Fetch data for specific cage when selected cage changes
  useEffect(() => {
    async function fetchCageSpecificData() {
      if (!selectedCage) return

      try {
        console.log('Fetching data for selected cage:', selectedCage)

        // Fetch daily records
        const {
          data: dailyData,
          error: dailyError,
        } = await dailyRecordService.getDailyRecords(selectedCage)
        if (dailyError) throw dailyError
        setDailyRecords(dailyData || [])

        // Fetch biweekly records
        const {
          data: biweeklyData,
          error: biweeklyError,
        } = await biweeklyRecordService.getBiweeklyRecords(selectedCage)
        if (biweeklyError) throw biweeklyError
        setBiweeklyRecords(biweeklyData || [])
      } catch (error) {
        console.error(
          `Error fetching data for cage ${selectedCage}:`,
          error.message,
        )
      }
    }

    if (
      activeTab === 'daily' ||
      activeTab === 'biweekly' ||
      activeTab === 'harvest'
    ) {
      fetchCageSpecificData()
    }
  }, [selectedCage, activeTab])

  // Calculate dashboard metrics
  const updateDashboardMetrics = (cages, stockings) => {
    if (!cages || cages.length === 0) return

    // Calculate total active cages
    const activeCages = cages.filter((cage) => cage.status === 'active')

    // Use most recent stockings for each active cage
    const recentStockingsMap = {}
    activeCages.forEach((cage) => {
      const cageStockings = stockings
        .filter((stocking) => stocking.cage_id === cage.id)
        .sort((a, b) => new Date(b.stocking_date) - new Date(a.stocking_date))

      if (cageStockings.length > 0) {
        recentStockingsMap[cage.id] = cageStockings[0]
      }
    })

    // Calculate total biomass and other metrics
    let totalBiomass = 0
    Object.values(recentStockingsMap).forEach((stocking) => {
      totalBiomass += stocking.initial_biomass || 0
    })

    // Set metrics
    setMetrics({
      totalActiveCages: activeCages.length,
      totalBiomass: Math.round(totalBiomass),
      averageFCR: calculateAverageFCR(cages, dailyRecords, biweeklyRecords),
      mortalityRate: calculateMortalityRate(cages, dailyRecords),
    })
  }

  // Helper function to calculate FCR - placeholder logic
  const calculateAverageFCR = (cages, dailyRecords, biweeklyRecords) => {
    // This would normally require complex calculation with real data
    return '1.45' // Placeholder
  }

  // Helper function to calculate mortality rate - placeholder logic
  const calculateMortalityRate = (cages, dailyRecords) => {
    // This would normally require complex calculation with real data
    return '2.8' // Placeholder
  }

  // Process growth data for chart
  const prepareGrowthData = () => {
    // Group data by cage and date
    const groupedByDate = {}

    biweeklyRecords.forEach((record) => {
      // Format date
      const date = new Date(record.date).toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
      })

      if (!groupedByDate[date]) {
        groupedByDate[date] = {}
      }

      // Find cage name
      const cage = cages.find((c) => c.id === record.cage_id)
      const cageName = cage
        ? cage.name
        : `Cage ${record.cage_id?.substr(0, 4) || 'Unknown'}`

      groupedByDate[date][cageName] = record.average_body_weight
    })

    // Convert to array for recharts
    return Object.keys(groupedByDate)
      .sort((a, b) => new Date(a) - new Date(b))
      .map((date) => ({
        date,
        ...groupedByDate[date],
      }))
  }

  // Process feed data for chart
  const prepareFeedData = () => {
    // Group by week
    const groupedByWeek = {}

    dailyRecords.forEach((record) => {
      const date = new Date(record.date)
      const weekStart = new Date(date)
      weekStart.setDate(date.getDate() - date.getDay())
      const week = `Week ${Math.ceil(weekStart.getDate() / 7)}`

      if (!groupedByWeek[week]) {
        groupedByWeek[week] = {}
      }

      // Find cage name
      const cage = cages.find((c) => c.id === record.cage_id)
      const cageName = cage
        ? cage.name
        : `Cage ${record.cage_id?.substr(0, 4) || 'Unknown'}`

      groupedByWeek[week][cageName] =
        (groupedByWeek[week][cageName] || 0) + (record.feed_amount || 0)
    })

    return Object.keys(groupedByWeek).map((week) => ({
      week,
      ...groupedByWeek[week],
    }))
  }

  // Format date in a user-friendly way
  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const growthData = prepareGrowthData()
  const feedData = prepareFeedData()

  // Stock table column definitions
  const stockingColumns = [
    {
      header: 'Batch Number',
      accessor: 'batch_number',
      sortable: true,
      searchable: true,
      cell: (row) => (
        <span className="font-medium text-indigo-600">{row.batch_number}</span>
      ),
    },
    {
      header: 'Cage',
      accessor: 'cage.name',
      sortable: true,
      searchable: true,
    },
    {
      header: 'Stocking Date',
      accessor: 'stocking_date',
      sortable: true,
      cell: (row) => formatDate(row.stocking_date),
    },
    {
      header: 'DOC',
      accessor: 'stocking_date',
      cell: (value) => {
        const stockingDate = new Date(value)
        const today = new Date()
        const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))
        return `${doc} days`
      },
    },
    {
      header: 'Initial Count',
      accessor: 'fish_count',
      cell: (value) => value?.toLocaleString() || 'N/A',
    },
    {
      header: 'Initial ABW (g)',
      accessor: 'initial_abw',
      cell: (value) => value?.toFixed(1) || 'N/A',
    },
    {
      header: 'Initial Biomass (kg)',
      accessor: 'initial_biomass',
      cell: (value) => value?.toFixed(1) || 'N/A',
    },
  ]

  const handleViewStocking = (stocking) => {
    router.push(`/stocking/${stocking.id}`)
  }

  // Render different content based on active tab
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div
                className="bg-blue-50 rounded-lg shadow p-6 cursor-pointer hover:shadow-md transition-shadow duration-300"
                onClick={() => router.push('/cages')}
              >
                <div className="flex items-center">
                  <div className="bg-blue-100 p-3 rounded-full mr-4">
                    <Droplets className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-500">
                      Active Cages
                    </div>
                    <div className="text-2xl font-semibold text-blue-600">
                      {metrics.totalActiveCages}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-red-50 rounded-lg shadow p-6 flex items-center">
                <div className="bg-red-100 p-3 rounded-full mr-4">
                  <Calculator className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-500">
                    Average FCR
                  </div>
                  <div className="text-2xl font-semibold text-red-600">
                    {metrics.averageFCR}
                  </div>
                </div>
              </div>

              <div className="bg-green-50 rounded-lg shadow p-6 flex items-center">
                <div className="bg-green-100 p-3 rounded-full mr-4">
                  <Scale className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-500">
                    Total Biomass
                  </div>
                  <div className="text-2xl font-semibold text-green-600">
                    {metrics.totalBiomass} kg
                  </div>
                </div>
              </div>

              <div className="bg-yellow-50 rounded-lg shadow p-6 flex items-center">
                <div className="bg-yellow-100 p-3 rounded-full mr-4">
                  <AlertTriangle className="w-6 h-6 text-yellow-600" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-500">
                    Mortality Rate
                  </div>
                  <div className="text-2xl font-semibold text-yellow-600">
                    {metrics.mortalityRate}%
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap gap-4">
              <Link href="/create-cage">
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700">
                  <Plus className="w-4 h-4 mr-2" />
                  New Cage
                </button>
              </Link>

              <Link href="/stocking">
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700">
                  <Plus className="w-4 h-4 mr-2" />
                  New Stocking
                </button>
              </Link>

              <Link href="/feed-types">
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700">
                  <Plus className="w-4 h-4 mr-2" />
                  Manage Feed Types
                </button>
              </Link>

              <Link href="/feed-suppliers">
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-purple-600 hover:bg-purple-700">
                  <Plus className="w-4 h-4 mr-2" />
                  Manage Feed Suppliers
                </button>
              </Link>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="font-medium text-gray-700 mb-4">
                  Growth Performance
                </h2>
                <div className="h-64">
                  {loading ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                  ) : growthData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsLineChart
                        data={growthData}
                        margin={{
                          top: 5,
                          right: 30,
                          left: 20,
                          bottom: 5,
                        }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        {cages.slice(0, 3).map((cage, index) => {
                          const colors = ['#3B82F6', '#EF4444', '#10B981']
                          const cageName = cage.name
                          // Only add a line if there's data for this cage
                          if (
                            growthData.some(
                              (item) => item[cageName] !== undefined,
                            )
                          ) {
                            return (
                              <Line
                                key={cage.id}
                                type="monotone"
                                dataKey={cageName}
                                stroke={colors[index % colors.length]}
                                strokeWidth={2}
                              />
                            )
                          }
                          return null
                        })}
                      </RechartsLineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-500">
                      No growth data available
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="font-medium text-gray-700 mb-4">
                  Feed Consumption
                </h2>
                <div className="h-64">
                  {loading ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                  ) : feedData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsBarChart
                        data={feedData}
                        margin={{
                          top: 5,
                          right: 30,
                          left: 20,
                          bottom: 5,
                        }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="week" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        {cages.slice(0, 3).map((cage, index) => {
                          const colors = ['#3B82F6', '#EF4444', '#10B981']
                          const cageName = cage.name
                          // Only add a bar if there's data for this cage
                          if (
                            feedData.some(
                              (item) => item[cageName] !== undefined,
                            )
                          ) {
                            return (
                              <Bar
                                key={cage.id}
                                dataKey={cageName}
                                fill={colors[index % colors.length]}
                              />
                            )
                          }
                          return null
                        })}
                      </RechartsBarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-500">
                      No feed data available
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Recent Stockings Table */}
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <h2 className="font-medium text-gray-700">Recent Stockings</h2>
                <Link href="/stocking-management">
                  <button className="text-sm text-indigo-600 hover:text-indigo-800">
                    View All Stockings
                  </button>
                </Link>
              </div>

              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Cage
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Stocking Date
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      DOC
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Initial Count
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Initial ABW (g)
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Initial Biomass (kg)
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {cages.map((cage) => {
                    // Calculate DOC (Days of Culture)
                    const stockingDate = new Date(cage.stocking_date)
                    const today = new Date()
                    const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))

                    return (
                      <tr key={cage.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {cage.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(cage.stocking_date).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {doc} days
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {cage.initial_count?.toLocaleString() || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {cage.initial_abw?.toFixed(1) || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {cage.initial_biomass?.toFixed(1) || 'N/A'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      case 'daily':
        // Use the provided selectedCage, or if it's empty, default to the first cage
        const dailyCageId =
          selectedCage || (cages.length > 0 ? cages[0].id : '')
        return <DailyEntryForm cageId={dailyCageId} />
      case 'biweekly':
        // Use the provided selectedCage, or if it's empty, default to the first cage
        const biweeklyCageId =
          selectedCage || (cages.length > 0 ? cages[0].id : '')
        return <BiweeklyForm cageId={biweeklyCageId} />
      case 'harvest':
        // Use the provided selectedCage, or if it's empty, default to the first cage
        const harvestCageId =
          selectedCage || (cages.length > 0 ? cages[0].id : '')
        return <HarvestForm cageId={harvestCageId} />
      default:
        return (
          <div className="bg-white shadow rounded-lg p-8">
            <p className="text-center text-gray-600">
              Please select a tab from the sidebar
            </p>
          </div>
        )
    }
  }

  return renderContent()
}

export default Dashboard
