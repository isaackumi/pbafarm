// components/Dashboard.js (Complete)
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { Calculator, Scale, AlertTriangle, Droplets } from 'lucide-react'
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
import { supabase } from '../lib/supabase'
// Fallback data if database fetch fails
import { cages as localCages } from '../data/cages'
import { dailyRecords as localDailyRecords } from '../data/daily-records'
import { biweeklyRecords as localBiweeklyRecords } from '../data/biweekly-records'
import BiweeklyForm from './BiweeklyForm'
import HarvestForm from './HarvestForm'
import DailyEntryForm from './DailyEntryForm'

const Dashboard = ({ activeTab, selectedCage }) => {
  const router = useRouter()
  const [cages, setCages] = useState([])
  const [dailyRecords, setDailyRecords] = useState([])
  const [biweeklyRecords, setBiweeklyRecords] = useState([])
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

  // Fetch data from Supabase
  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      try {
        console.log('Fetching data from Supabase...')

        // Fetch cages
        const { data: cagesData, error: cagesError } = await supabase
          .from('cages')
          .select('*')

        if (cagesError) throw cagesError
        console.log('Fetched cages:', cagesData)
        setCages(cagesData || localCages)

        // Fetch daily records
        const { data: dailyData, error: dailyError } = await supabase
          .from('daily_records')
          .select('*')

        if (dailyError) throw dailyError
        console.log('Fetched daily records:', dailyData)
        setDailyRecords(dailyData || localDailyRecords)

        // Fetch biweekly records
        const {
          data: biweeklyData,
          error: biweeklyError,
        } = await supabase.from('biweekly_records').select('*')

        if (biweeklyError) throw biweeklyError
        console.log('Fetched biweekly records:', biweeklyData)
        setBiweeklyRecords(biweeklyData || localBiweeklyRecords)
      } catch (error) {
        console.error('Error fetching data:', error.message)
        setError(error.message)
        // Fallback to local data
        console.log('Using fallback local data due to error')
        setCages(localCages)
        setDailyRecords(localDailyRecords)
        setBiweeklyRecords(localBiweeklyRecords)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  // Calculate metrics when data is loaded
  useEffect(() => {
    if (cages.length > 0 && !loading) {
      const calculatedMetrics = calculateMetrics()
      setMetrics(calculatedMetrics)
    }
  }, [cages, dailyRecords, biweeklyRecords, loading])

  // Process growth data for chart
  const processGrowthData = () => {
    // Create a map of cage IDs to cage names
    const cageMap = {}
    cages.forEach((cage) => {
      cageMap[cage.id] = cage.name
    })

    // Convert dates to readable format and group by date
    const groupedByDate = {}
    biweeklyRecords.forEach((record) => {
      const date = new Date(record.date).toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
      })
      if (!groupedByDate[date]) {
        groupedByDate[date] = {}
      }
      const cageName =
        cageMap[record.cage_id] ||
        `Cage ${record.cage_id?.substr(0, 4) || 'Unknown'}`
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
  const processFeedData = () => {
    const cageMap = {}
    cages.forEach((cage) => {
      cageMap[cage.id] = cage.name
    })

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

      const cageName =
        cageMap[record.cage_id] ||
        `Cage ${record.cage_id?.substr(0, 4) || 'Unknown'}`
      groupedByWeek[week][cageName] =
        (groupedByWeek[week][cageName] || 0) + (record.feed_amount || 0)
    })

    return Object.keys(groupedByWeek).map((week) => ({
      week,
      ...groupedByWeek[week],
    }))
  }

  // Calculate summary metrics
  const calculateMetrics = () => {
    // Total  Active cages (active only)
    const totalActiveCages = cages.filter((cage) => cage.status === 'active')
      .length

    // Total biomass calculation
    let totalBiomass = 0
    cages
      .filter((cage) => cage.status === 'active')
      .forEach((cage) => {
        const latestRecord = biweeklyRecords
          .filter((record) => record.cage_id === cage.id)
          .sort((a, b) => new Date(b.date) - new Date(a.date))[0]

        if (latestRecord) {
          // Convert from g to kg and multiply by estimated count
          const cageMortality = dailyRecords
            .filter((record) => record.cage_id === cage.id)
            .reduce((total, record) => total + (record.mortality || 0), 0)

          const estimatedCount = cage.initial_count - cageMortality
          totalBiomass +=
            (latestRecord.average_body_weight * estimatedCount) / 1000
        }
      })

    // Average FCR
    let totalFCR = 0
    let cageCount = 0
    cages
      .filter((cage) => cage.status === 'active')
      .forEach((cage) => {
        const totalFeed = dailyRecords
          .filter((record) => record.cage_id === cage.id)
          .reduce((total, record) => total + (record.feed_amount || 0), 0)

        // Use initial_biomass instead of initial_weight based on DB schema
        const initialBiomass = cage.initial_biomass || 0

        const latestRecord = biweeklyRecords
          .filter((record) => record.cage_id === cage.id)
          .sort((a, b) => new Date(b.date) - new Date(a.date))[0]

        if (latestRecord) {
          const cageMortality = dailyRecords
            .filter((record) => record.cage_id === cage.id)
            .reduce((total, record) => total + (record.mortality || 0), 0)

          const estimatedCount = cage.initial_count - cageMortality
          const currentBiomass =
            (latestRecord.average_body_weight * estimatedCount) / 1000

          const fcr = totalFeed / (currentBiomass - initialBiomass)
          if (!isNaN(fcr) && isFinite(fcr) && fcr > 0) {
            totalFCR += fcr
            cageCount++
          }
        }
      })

    const averageFCR = cageCount > 0 ? (totalFCR / cageCount).toFixed(2) : 'N/A'

    // Mortality rate
    const totalInitialCount = cages.reduce(
      (total, cage) => total + (cage.initial_count || 0),
      0,
    )
    const totalMortality = dailyRecords.reduce(
      (total, record) => total + (record.mortality || 0),
      0,
    )
    const mortalityRate =
      totalInitialCount > 0
        ? ((totalMortality / totalInitialCount) * 100).toFixed(1)
        : '0.0'

    return {
      totalActiveCages,
      totalBiomass: Math.round(totalBiomass),
      averageFCR,
      mortalityRate,
    }
  }

  // Growth Chart Component
  const GrowthChart = () => {
    const growthData = processGrowthData()

    return (
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
            if (growthData.some((item) => item[cageName] !== undefined)) {
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
    )
  }

  // Feed Chart Component
  const FeedChart = () => {
    const feedData = processFeedData()

    return (
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
            if (feedData.some((item) => item[cageName] !== undefined)) {
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
    )
  }

  // Render different content based on active tab
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <div className="space-y-6">
            {/* Summary Cards - with icons and horizontal grid */}
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
                      Total Cages
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
                  ) : (
                    <GrowthChart />
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
                  ) : (
                    <FeedChart />
                  )}
                </div>
              </div>
            </div>

            {/* Cage Summary Table */}
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="font-medium text-gray-700">
                  Cage Performance Summary
                </h2>
              </div>
              <div className="overflow-x-auto">
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
                        Days
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        Current ABW
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        Current FCR
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        Total Feed
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {loading ? (
                      <tr>
                        <td colSpan="7" className="px-6 py-4 text-center">
                          <div className="flex justify-center">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                          </div>
                        </td>
                      </tr>
                    ) : cages.length > 0 ? (
                      cages.map((cage) => {
                        // Calculate days since stocking
                        const stockingDate = new Date(cage.stocking_date)
                        const today = new Date()
                        const daysSinceStocking = Math.floor(
                          (today - stockingDate) / (1000 * 60 * 60 * 24),
                        )

                        // Get latest ABW
                        const latestRecord = biweeklyRecords
                          .filter((record) => record.cage_id === cage.id)
                          .sort(
                            (a, b) => new Date(b.date) - new Date(a.date),
                          )[0]

                        // Calculate total feed
                        const totalFeed = dailyRecords
                          .filter((record) => record.cage_id === cage.id)
                          .reduce(
                            (total, record) =>
                              total + (record.feed_amount || 0),
                            0,
                          )

                        // Calculate FCR using initial_biomass instead of initial_weight
                        let fcr = 'N/A'
                        if (latestRecord) {
                          const cageMortality = dailyRecords
                            .filter((record) => record.cage_id === cage.id)
                            .reduce(
                              (total, record) =>
                                total + (record.mortality || 0),
                              0,
                            )

                          const estimatedCount =
                            cage.initial_count - cageMortality
                          const currentBiomass =
                            (latestRecord.average_body_weight *
                              estimatedCount) /
                            1000
                          const biomassGain =
                            currentBiomass - (cage.initial_biomass || 0)

                          if (biomassGain > 0 && totalFeed > 0) {
                            fcr = (totalFeed / biomassGain).toFixed(2)
                          }
                        }

                        return (
                          <tr key={cage.id}>
                            <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                              {cage.name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {new Date(
                                cage.stocking_date,
                              ).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {daysSinceStocking}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {latestRecord
                                ? `${latestRecord.average_body_weight.toFixed(
                                    1,
                                  )} g`
                                : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {fcr}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {totalFeed > 0
                                ? `${totalFeed.toFixed(1)} kg`
                                : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <span
                                className={`px-2 py-1 text-xs font-medium rounded-full ${
                                  cage.status === 'active'
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-yellow-100 text-yellow-800'
                                }`}
                              >
                                {cage.status.charAt(0).toUpperCase() +
                                  cage.status.slice(1)}
                              </span>
                            </td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan="7"
                          className="px-6 py-4 text-center text-sm text-gray-500"
                        >
                          No cages found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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
