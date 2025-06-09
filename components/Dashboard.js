// components/Dashboard.js (Complete)
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { Calculator, Scale, AlertTriangle, Droplets, Plus, TrendingUp, Calendar, DollarSign, Percent } from 'lucide-react'
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

function Dashboard({ selectedCage }) {
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
    avgDailyGrowth: 'N/A',
    daysToHarvest: 'N/A',
    feedCostPerKg: 'N/A',
    survivalRate: 'N/A',
  })

  console.log(
    'Dashboard rendered with selectedCage:',
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

    if (selectedCage) {
      fetchCageSpecificData()
    }
  }, [selectedCage])

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
      avgDailyGrowth: calculateAvgDailyGrowth(cages, dailyRecords, biweeklyRecords),
      daysToHarvest: calculateDaysToHarvest(cages, dailyRecords, biweeklyRecords),
      feedCostPerKg: calculateFeedCostPerKg(cages, dailyRecords, biweeklyRecords),
      survivalRate: calculateSurvivalRate(cages, dailyRecords),
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

  // Helper function to calculate average daily growth
  const calculateAvgDailyGrowth = (cages, dailyRecords, biweeklyRecords) => {
    if (!biweeklyRecords || biweeklyRecords.length < 2) return 'N/A'

    let totalGrowth = 0
    let count = 0

    // Group records by cage
    const cageRecords = {}
    biweeklyRecords.forEach(record => {
      if (!cageRecords[record.cage_id]) {
        cageRecords[record.cage_id] = []
      }
      cageRecords[record.cage_id].push(record)
    })

    // Calculate growth rate for each cage
    Object.values(cageRecords).forEach(records => {
      if (records.length >= 2) {
        // Sort by date
        records.sort((a, b) => new Date(a.date) - new Date(b.date))
        
        // Calculate growth between first and last record
        const firstRecord = records[0]
        const lastRecord = records[records.length - 1]
        const daysDiff = Math.floor((new Date(lastRecord.date) - new Date(firstRecord.date)) / (1000 * 60 * 60 * 24))
        
        if (daysDiff > 0) {
          const growth = lastRecord.average_body_weight - firstRecord.average_body_weight
          const dailyGrowth = growth / daysDiff
          totalGrowth += dailyGrowth
          count++
        }
      }
    })

    return count > 0 ? (totalGrowth / count).toFixed(1) : 'N/A'
  }

  // Helper function to calculate days to harvest
  const calculateDaysToHarvest = (cages, dailyRecords, biweeklyRecords) => {
    if (!biweeklyRecords || biweeklyRecords.length < 2) return 'N/A'

    const targetWeight = 500 // Target harvest weight in grams
    const avgGrowth = parseFloat(calculateAvgDailyGrowth(cages, dailyRecords, biweeklyRecords))
    
    if (avgGrowth === 'N/A' || avgGrowth <= 0) return 'N/A'

    // Get current average weight
    const currentWeight = biweeklyRecords.reduce((sum, record) => sum + record.average_body_weight, 0) / biweeklyRecords.length
    
    const remainingGrowth = targetWeight - currentWeight
    const daysToHarvest = Math.ceil(remainingGrowth / avgGrowth)

    return daysToHarvest > 0 ? daysToHarvest : 'N/A'
  }

  // Helper function to calculate feed cost per kg
  const calculateFeedCostPerKg = (cages, dailyRecords, biweeklyRecords) => {
    if (!dailyRecords || dailyRecords.length === 0) return 'N/A'

    let totalFeedCost = 0
    let totalFeedAmount = 0

    dailyRecords.forEach(record => {
      if (record.feed_amount && record.feed_price) {
        totalFeedCost += record.feed_amount * record.feed_price
        totalFeedAmount += record.feed_amount
      }
    })

    if (totalFeedAmount === 0) return 'N/A'

    const feedCostPerKg = totalFeedCost / totalFeedAmount
    return feedCostPerKg.toFixed(2)
  }

  // Helper function to calculate survival rate
  const calculateSurvivalRate = (cages, dailyRecords) => {
    if (!cages || cages.length === 0) return 'N/A'

    let totalInitialCount = 0
    let totalMortality = 0

    cages.forEach(cage => {
      if (cage.status === 'active') {
        totalInitialCount += cage.initial_count || 0
        
        // Sum up mortalities from daily records
        const cageMortality = dailyRecords
          .filter(record => record.cage_id === cage.id)
          .reduce((sum, record) => sum + (record.mortality || 0), 0)
        
        totalMortality += cageMortality
      }
    })

    if (totalInitialCount === 0) return 'N/A'

    const survivalRate = ((totalInitialCount - totalMortality) / totalInitialCount) * 100
    return survivalRate.toFixed(1)
  }

  // Process growth data for chart
  const prepareGrowthData = () => {
    if (!biweeklyRecords || biweeklyRecords.length === 0) return []

    // Group data by date and cage
    const groupedByDate = {}
    
    biweeklyRecords.forEach((record) => {
      const date = new Date(record.date).toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
      })

      if (!groupedByDate[date]) {
        groupedByDate[date] = {
          date,
          // Initialize with null values for all cages
          ...cages.reduce((acc, cage) => {
            acc[cage.name] = null
            return acc
          }, {})
        }
      }

      // Find cage name
      const cage = cages.find((c) => c.id === record.cage_id)
      if (cage) {
        groupedByDate[date][cage.name] = record.average_body_weight
      }
    })

    // Convert to array and sort by date
    return Object.values(groupedByDate).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    )
  }

  // Process feed data for chart
  const prepareFeedData = () => {
    if (!dailyRecords || dailyRecords.length === 0) return []

    // Group by date and cage
    const groupedByDate = {}
    
    dailyRecords.forEach((record) => {
      const date = new Date(record.date).toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
      })

      if (!groupedByDate[date]) {
        groupedByDate[date] = {
          date,
          // Initialize with 0 values for all cages
          ...cages.reduce((acc, cage) => {
            acc[cage.name] = 0
            return acc
          }, {})
        }
      }

      // Find cage name
      const cage = cages.find((c) => c.id === record.cage_id)
      if (cage) {
        groupedByDate[date][cage.name] += record.feed_amount || 0
      }
    })

    // Convert to array and sort by date
    return Object.values(groupedByDate).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    )
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

  // Remove renderContent and just render the dashboard content directly
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

        {/* New Analytics Cards */}
        <div className="bg-purple-50 rounded-lg shadow p-6 flex items-center">
          <div className="bg-purple-100 p-3 rounded-full mr-4">
            <TrendingUp className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <div className="text-sm font-medium text-gray-500">
              Avg. Daily Growth
            </div>
            <div className="text-2xl font-semibold text-purple-600">
              {metrics.avgDailyGrowth} g/day
            </div>
          </div>
        </div>

        <div className="bg-indigo-50 rounded-lg shadow p-6 flex items-center">
          <div className="bg-indigo-100 p-3 rounded-full mr-4">
            <Calendar className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <div className="text-sm font-medium text-gray-500">
              Days to Harvest
            </div>
            <div className="text-2xl font-semibold text-indigo-600">
              {metrics.daysToHarvest}
            </div>
          </div>
        </div>

        <div className="bg-pink-50 rounded-lg shadow p-6 flex items-center">
          <div className="bg-pink-100 p-3 rounded-full mr-4">
            <DollarSign className="w-6 h-6 text-pink-600" />
          </div>
          <div>
            <div className="text-sm font-medium text-gray-500">
              Feed Cost/kg
            </div>
            <div className="text-2xl font-semibold text-pink-600">
              ₵{metrics.feedCostPerKg}
            </div>
          </div>
        </div>

        <div className="bg-teal-50 rounded-lg shadow p-6 flex items-center">
          <div className="bg-teal-100 p-3 rounded-full mr-4">
            <Percent className="w-6 h-6 text-teal-600" />
          </div>
          <div>
            <div className="text-sm font-medium text-gray-500">
              Survival Rate
            </div>
            <div className="text-2xl font-semibold text-teal-600">
              {metrics.survivalRate}%
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
                  <XAxis 
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis 
                    label={{ 
                      value: 'Weight (g)', 
                      angle: -90, 
                      position: 'insideLeft',
                      style: { textAnchor: 'middle' }
                    }}
                  />
                  <Tooltip 
                    formatter={(value) => [`${value} g`, 'Weight']}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Legend />
                  {cages.filter(cage => cage.status === 'active').map((cage, index) => {
                    const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6']
                    return (
                      <Line
                        key={cage.id}
                        type="monotone"
                        dataKey={cage.name}
                        stroke={colors[index % colors.length]}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    )
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
                  <XAxis 
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis 
                    label={{ 
                      value: 'Feed Amount (kg)', 
                      angle: -90, 
                      position: 'insideLeft',
                      style: { textAnchor: 'middle' }
                    }}
                  />
                  <Tooltip 
                    formatter={(value) => [`${value} kg`, 'Feed Amount']}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Legend />
                  {cages.filter(cage => cage.status === 'active').map((cage, index) => {
                    const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6']
                    return (
                      <Bar
                        key={cage.id}
                        dataKey={cage.name}
                        fill={colors[index % colors.length]}
                        stackId="feed"
                      />
                    )
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
}

export default Dashboard
