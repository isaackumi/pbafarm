// components/Dashboard.js (Fixed)
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
import { cages } from '../data/cages'
import { dailyRecords } from '../data/daily-records'
import { biweeklyRecords } from '../data/biweekly-records'
import BiweeklyForm from './BiweeklyForm'
import HarvestForm from './HarvestForm'
import DailyEntryForm from './DailyEntryForm'

const Dashboard = ({ activeTab, selectedCage }) => {
  const router = useRouter()
  const [metrics, setMetrics] = useState({
    totalActiveCages: 0,
    totalBiomass: 0,
    averageFCR: 'N/A',
    mortalityRate: '0.0',
  })

  useEffect(() => {
    // Calculate metrics when component mounts
    const calculatedMetrics = calculateMetrics()
    setMetrics(calculatedMetrics)
  }, [])

  // Process growth data for chart
  const processGrowthData = () => {
    // Group biweekly records by date and cage
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
      const cageName = cageMap[record.cageId]
      groupedByDate[date][cageName] = record.averageBodyWeight
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

      const cageName = cageMap[record.cageId]
      groupedByWeek[week][cageName] =
        (groupedByWeek[week][cageName] || 0) + record.feedAmount
    })

    return Object.keys(groupedByWeek).map((week) => ({
      week,
      ...groupedByWeek[week],
    }))
  }

  // Calculate summary metrics
  const calculateMetrics = () => {
    // Total cages (active only)
    const totalActiveCages = cages.filter((cage) => cage.status === 'active')
      .length

    // Total biomass calculation
    let totalBiomass = 0
    cages
      .filter((cage) => cage.status === 'active')
      .forEach((cage) => {
        const latestRecord = biweeklyRecords
          .filter((record) => record.cageId === cage.id)
          .sort((a, b) => new Date(b.date) - new Date(a.date))[0]

        if (latestRecord) {
          // Convert from g to kg and multiply by estimated count
          const cageMortality = dailyRecords
            .filter((record) => record.cageId === cage.id)
            .reduce((total, record) => total + record.mortality, 0)

          const estimatedCount = cage.initialCount - cageMortality
          totalBiomass +=
            (latestRecord.averageBodyWeight * estimatedCount) / 1000
        }
      })

    // Average FCR
    let totalFCR = 0
    let cageCount = 0
    cages
      .filter((cage) => cage.status === 'active')
      .forEach((cage) => {
        const totalFeed = dailyRecords
          .filter((record) => record.cageId === cage.id)
          .reduce((total, record) => total + record.feedAmount, 0)

        const initialBiomass = cage.initialWeight

        const latestRecord = biweeklyRecords
          .filter((record) => record.cageId === cage.id)
          .sort((a, b) => new Date(b.date) - new Date(a.date))[0]

        if (latestRecord) {
          const cageMortality = dailyRecords
            .filter((record) => record.cageId === cage.id)
            .reduce((total, record) => total + record.mortality, 0)

          const estimatedCount = cage.initialCount - cageMortality
          const currentBiomass =
            (latestRecord.averageBodyWeight * estimatedCount) / 1000

          const fcr = totalFeed / (currentBiomass - initialBiomass)
          if (!isNaN(fcr) && isFinite(fcr)) {
            totalFCR += fcr
            cageCount++
          }
        }
      })

    const averageFCR = cageCount > 0 ? (totalFCR / cageCount).toFixed(2) : 'N/A'

    // Mortality rate
    const totalInitialCount = cages.reduce(
      (total, cage) => total + cage.initialCount,
      0,
    )
    const totalMortality = dailyRecords.reduce(
      (total, record) => total + record.mortality,
      0,
    )
    const mortalityRate = ((totalMortality / totalInitialCount) * 100).toFixed(
      1,
    )

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
          <Line
            type="monotone"
            dataKey="Cage 1"
            stroke="#3B82F6"
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="Cage 2"
            stroke="#EF4444"
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="Cage 3"
            stroke="#10B981"
            strokeWidth={2}
          />
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
          <Bar dataKey="Cage 1" fill="#3B82F6" />
          <Bar dataKey="Cage 2" fill="#EF4444" />
          <Bar dataKey="Cage 3" fill="#10B981" />
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
                  <GrowthChart />
                </div>
              </div>

              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="font-medium text-gray-700 mb-4">
                  Feed Consumption
                </h2>
                <div className="h-64">
                  <FeedChart />
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
                    {cages.map((cage) => {
                      // Calculate days since stocking
                      const stockingDate = new Date(cage.stockingDate)
                      const today = new Date()
                      const daysSinceStocking = Math.floor(
                        (today - stockingDate) / (1000 * 60 * 60 * 24),
                      )

                      // Get latest ABW
                      const latestRecord = biweeklyRecords
                        .filter((record) => record.cageId === cage.id)
                        .sort((a, b) => new Date(b.date) - new Date(a.date))[0]

                      // Calculate total feed
                      const totalFeed = dailyRecords
                        .filter((record) => record.cageId === cage.id)
                        .reduce((total, record) => total + record.feedAmount, 0)

                      // Calculate FCR
                      let fcr = 'N/A'
                      if (latestRecord) {
                        const cageMortality = dailyRecords
                          .filter((record) => record.cageId === cage.id)
                          .reduce(
                            (total, record) => total + record.mortality,
                            0,
                          )

                        const estimatedCount = cage.initialCount - cageMortality
                        const currentBiomass =
                          (latestRecord.averageBodyWeight * estimatedCount) /
                          1000
                        const biomassGain = currentBiomass - cage.initialWeight

                        if (biomassGain > 0) {
                          fcr = (totalFeed / biomassGain).toFixed(2)
                        }
                      }

                      return (
                        <tr key={cage.id}>
                          <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                            {cage.name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {cage.stockingDate}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {daysSinceStocking}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {latestRecord
                              ? `${latestRecord.averageBodyWeight.toFixed(1)} g`
                              : '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {fcr}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {totalFeed > 0 ? `${totalFeed.toFixed(1)} kg` : '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span
                              className={`px-2 py-1 text-xs font-medium rounded-full ${
                                cage.status === 'active'
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-yellow-100 text-yellow-800'
                              }`}
                            >
                              {cage.status === 'active'
                                ? 'Active'
                                : 'Harvested'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
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
