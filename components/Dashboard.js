import React, { useState } from 'react'
import { useRouter } from 'next/router'
import {
  BarChart,
  AreaChart,
  PieChart,
  LineChart,
  Users,
  Database,
  FileText,
  LogOut,
  Droplets,
  Calculator,
  Scale,
  AlertTriangle,
} from 'lucide-react'
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
import { useAuth } from '../contexts/AuthContext'

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
        totalBiomass += (latestRecord.averageBodyWeight * estimatedCount) / 1000
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
  const mortalityRate = ((totalMortality / totalInitialCount) * 100).toFixed(1)

  return {
    totalActiveCages,
    totalBiomass: Math.round(totalBiomass),
    averageFCR,
    mortalityRate,
  }
}

// Dashboard Component
const Dashboard = () => {
  const { user, userRole, signOut } = useAuth()
  const router = useRouter()

  const [totalCages, setTotalCages] = useState(0)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [selectedCage, setSelectedCage] = useState(
    cages.length > 0 ? cages[0].id : '',
  )
  const metrics = calculateMetrics()

  // Add the renderContent function here
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
                      {totalCages}
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
        return <DailyEntryForm cageId={selectedCage} />
      case 'biweekly':
        return <BiweeklyForm cageId={selectedCage} />
      case 'harvest':
        return <HarvestForm cageId={selectedCage} />
      case 'reports':
        return (
          <div className="bg-white shadow rounded-lg p-8">
            <h2 className="text-xl font-medium text-gray-700 mb-4">Reports</h2>
            <p className="text-center text-gray-600">
              Reports functionality coming soon...
            </p>
          </div>
        )
      case 'export':
        return (
          <div className="bg-white shadow rounded-lg p-8">
            <h2 className="text-xl font-medium text-gray-700 mb-4">
              Export Data
            </h2>
            <p className="text-center text-gray-600">
              Data export functionality coming soon...
            </p>
          </div>
        )
      case 'users':
        return (
          <div className="bg-white shadow rounded-lg p-8">
            <h2 className="text-xl font-medium text-gray-700 mb-4">
              User Management
            </h2>
            <p className="text-center text-gray-600">
              User management functionality coming soon...
            </p>
          </div>
        )
      default:
        return (
          <div className="bg-white shadow rounded-lg p-8">
            <p className="text-center text-gray-600">Coming soon...</p>
          </div>
        )
    }
  }

  return (
    <div className="flex h-screen bg-gray-100 font-montserrat">
      {/* Sidebar */}
      <div className="w-64 bg-indigo-900 text-white flex flex-col">
        <div className="p-4 border-b border-indigo-800 flex items-center space-x-2">
          <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center">
            <span className="text-indigo-900 font-bold">FM</span>
          </div>
          <span className="text-sm font-medium">PBA Farm Management</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1">
            <li>
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`flex items-center w-full px-4 py-2 text-sm font-medium ${
                  activeTab === 'dashboard'
                    ? 'bg-indigo-800 text-white'
                    : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                }`}
              >
                <span className="mr-3">
                  <BarChart className="w-5 h-5" />
                </span>
                <span>Dashboard</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveTab('daily')}
                className={`flex items-center w-full px-4 py-2 text-sm font-medium ${
                  activeTab === 'daily'
                    ? 'bg-indigo-800 text-white'
                    : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                }`}
              >
                <span className="mr-3">
                  <AreaChart className="w-5 h-5" />
                </span>
                <span>Daily Data Entry</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveTab('biweekly')}
                className={`flex items-center w-full px-4 py-2 text-sm font-medium ${
                  activeTab === 'biweekly'
                    ? 'bg-indigo-800 text-white'
                    : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                }`}
              >
                <span className="mr-3">
                  <LineChart className="w-5 h-5" />
                </span>
                <span>Biweekly ABW</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveTab('harvest')}
                className={`flex items-center w-full px-4 py-2 text-sm font-medium ${
                  activeTab === 'harvest'
                    ? 'bg-indigo-800 text-white'
                    : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                }`}
              >
                <span className="mr-3">
                  <PieChart className="w-5 h-5" />
                </span>
                <span>Harvest Data</span>
              </button>
            </li>

            <li className="px-3 py-2 text-xs font-semibold text-indigo-300 uppercase tracking-wider">
              Admin
            </li>
            <li>
              <button
                onClick={() => setActiveTab('reports')}
                className={`flex items-center w-full px-4 py-2 text-sm font-medium ${
                  activeTab === 'reports'
                    ? 'bg-indigo-800 text-white'
                    : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                }`}
              >
                <span className="mr-3">
                  <FileText className="w-5 h-5" />
                </span>
                <span>Reports</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => setActiveTab('export')}
                className={`flex items-center w-full px-4 py-2 text-sm font-medium ${
                  activeTab === 'export'
                    ? 'bg-indigo-800 text-white'
                    : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                }`}
              >
                <span className="mr-3">
                  <Database className="w-5 h-5" />
                </span>
                <span>Export Data</span>
              </button>
            </li>

            <li className="px-3 py-2 text-xs font-semibold text-indigo-300 uppercase tracking-wider">
              Super Admin
            </li>
            <li>
              <button
                onClick={() => setActiveTab('users')}
                className={`flex items-center w-full px-4 py-2 text-sm font-medium ${
                  activeTab === 'users'
                    ? 'bg-indigo-800 text-white'
                    : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                }`}
              >
                <span className="mr-3">
                  <Users className="w-5 h-5" />
                </span>
                <span>User Management</span>
              </button>
            </li>
          </ul>
        </nav>

        <div className="p-4 border-t border-indigo-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-pink-500 rounded-full flex items-center justify-center">
                <span className="text-white font-bold">
                  {user?.email?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
              <div>
                <div className="text-sm font-medium truncate max-w-[120px]">
                  {user?.user_metadata?.full_name}
                </div>
                <div className="text-xs text-indigo-300">User</div>
              </div>
            </div>
            <button
              onClick={signOut}
              className="text-indigo-200 hover:text-white"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        <header className="bg-white shadow">
          <div className="flex justify-between items-center px-6 py-4">
            <h1 className="text-xl font-semibold text-gray-800">
              {activeTab === 'dashboard'
                ? 'Dashboard'
                : activeTab === 'daily'
                ? 'Daily Data Entry'
                : activeTab === 'biweekly'
                ? 'Biweekly ABW'
                : activeTab === 'harvest'
                ? 'Harvest Data'
                : activeTab === 'reports'
                ? 'Reports'
                : activeTab === 'export'
                ? 'Export Data'
                : activeTab === 'users'
                ? 'User Management'
                : 'Settings'}
            </h1>

            {/* Cage selector - only show for data entry forms */}
            {['daily', 'biweekly', 'harvest'].includes(activeTab) && (
              <div className="flex items-center space-x-4">
                <label className="text-sm font-medium text-gray-700">
                  Select Cage:
                </label>
                <select
                  value={selectedCage}
                  onChange={(e) => setSelectedCage(e.target.value)}
                  className="block w-40 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  <option value="" disabled>
                    Select a cage
                  </option>
                  {cages.map((cage) => (
                    <option key={cage.id} value={cage.id}>
                      {cage.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </header>

        <main className="p-6">{renderContent()}</main>
      </div>
    </div>
  )
}

export default Dashboard
