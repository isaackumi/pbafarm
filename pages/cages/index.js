import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useRouter } from 'next/router'
import Link from 'next/link'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import CageManagementSidebar from '../../components/CageManagementSidebar'
import DataTable from '../../components/DataTable'
import { 
  fetchCages, 
  selectCages, 
  selectCagesLoading, 
  selectCagesError,
  selectCagesPagination
} from '../../store/slices/cagesSlice'
import {
  Search,
  Filter,
  ChevronDown,
  AlertTriangle,
  Clock,
  CheckCircle,
  Activity,
  Tool,
  BarChart2,
  LineChart,
  PieChart,
  Plus,
  ArrowLeft
} from 'lucide-react'
import { PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import cageService from '../../lib/cageService'

export default function CagesPage() {
  return (
    <ProtectedRoute>
      <Layout>
        <CagesManagement />
      </Layout>
    </ProtectedRoute>
  )
}

function CagesManagement() {
  const dispatch = useDispatch()
  const router = useRouter()
  const cages = useSelector(selectCages)
  const loading = useSelector(selectCagesLoading)
  const error = useSelector(selectCagesError)
  const { currentPage, totalPages } = useSelector(selectCagesPagination)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [localLoading, setLocalLoading] = useState(true)
  const [localError, setLocalError] = useState(null)
  const [analyticsData, setAnalyticsData] = useState({
    statusDistribution: [],
    harvestReadiness: [],
    maintenanceNeeded: [],
    utilizationRate: 0
  })

  // Initial data fetching using direct API call
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setLocalLoading(true)
        setLocalError(null)
        
        // Fetch cages directly from API
        const { data, error: apiError } = await cageService.getAllCages(1, 50)
        
        if (apiError) {
          console.error('Error fetching cages:', apiError)
          setLocalError(apiError.message || 'Failed to load cages')
          return
        }

        // Dispatch to Redux store
        dispatch(fetchCages.fulfilled({
          data,
          totalCount: data.length,
          totalPages: 1
        }, 'initial-fetch', { page: 1, pageSize: 50 }))
        
      } catch (error) {
        console.error('Error in initial data fetch:', error)
        setLocalError(error.message || 'Failed to load cages')
      } finally {
        setLocalLoading(false)
      }
    }

    fetchInitialData()
  }, [dispatch])

  // Filter and search cages
  const filteredCages = React.useMemo(() => {
    if (!cages) return []
    
    return cages.filter(cage => {
      const matchesSearch = searchQuery === '' || 
        cage.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (cage.location && cage.location.toLowerCase().includes(searchQuery.toLowerCase()))
      
      const matchesStatus = statusFilter === 'all' || cage.status === statusFilter
      
      return matchesSearch && matchesStatus
    })
  }, [cages, searchQuery, statusFilter])

  // Calculate analytics
  const analytics = React.useMemo(() => {
    if (!cages) return {
      totalCages: 0,
      activeCages: 0,
      harvestReadyCages: 0,
      maintenanceCages: 0
    }

    return {
      totalCages: cages.length,
      activeCages: cages.filter(c => c.status === 'active').length,
      harvestReadyCages: cages.filter(c => c.status === 'ready_to_harvest').length,
      maintenanceCages: cages.filter(c => c.status === 'maintenance').length
    }
  }, [cages])

  // Calculate analytics data
  useEffect(() => {
    if (!cages) return

    // Status distribution
    const statusCount = cages.reduce((acc, cage) => {
      acc[cage.status] = (acc[cage.status] || 0) + 1
      return acc
    }, {})

    const statusData = Object.entries(statusCount).map(([status, count]) => ({
      name: status.charAt(0).toUpperCase() + status.slice(1),
      value: count,
      color: getStatusColor(status)
    }))

    // Harvest readiness
    const harvestData = cages.reduce((acc, cage) => {
      if (!cage.stocking_date) return acc
      
      const stockingDate = new Date(cage.stocking_date)
      const today = new Date()
      const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))
      
      if (doc >= 100) {
        acc.ready++
      } else if (doc >= 80) {
        acc.soon++
      } else {
        acc.growing++
      }
      return acc
    }, { ready: 0, soon: 0, growing: 0 })

    const harvestReadinessData = [
      { name: 'Ready for Harvest', value: harvestData.ready, color: '#EF4444' },
      { name: 'Harvest Soon', value: harvestData.soon, color: '#F59E0B' },
      { name: 'Growing', value: harvestData.growing, color: '#10B981' }
    ]

    // Maintenance needed
    const maintenanceData = cages.reduce((acc, cage) => {
      if (cage.status === 'maintenance') {
        acc.maintenance++
      } else if (cage.status === 'active') {
        acc.active++
      } else {
        acc.other++
      }
      return acc
    }, { maintenance: 0, active: 0, other: 0 })

    const maintenanceDataFormatted = [
      { name: 'Needs Maintenance', value: maintenanceData.maintenance, color: '#F59E0B' },
      { name: 'Active', value: maintenanceData.active, color: '#10B981' },
      { name: 'Other', value: maintenanceData.other, color: '#6B7280' }
    ]

    // Utilization rate
    const utilizationRate = (cages.filter(cage => cage.status === 'active').length / cages.length) * 100

    setAnalyticsData({
      statusDistribution: statusData,
      harvestReadiness: harvestReadinessData,
      maintenanceNeeded: maintenanceDataFormatted,
      utilizationRate
    })
  }, [cages])

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return '#10B981'
      case 'maintenance': return '#F59E0B'
      case 'harvested': return '#3B82F6'
      case 'fallow': return '#6B7280'
      case 'empty': return '#8B5CF6'
      default: return '#6B7280'
    }
  }

  const handlePageChange = (newPage) => {
    dispatch(fetchCages({ page: newPage }))
  }

  // DataTable column definitions
  const columns = [
    {
      header: 'Cage Name',
      accessor: 'name',
      sortable: true,
      searchable: true,
      cell: (row) => (
        <Link
          href={`/cages/${row.id}`}
          className="text-indigo-600 hover:text-indigo-900 font-medium"
        >
          {row.name}
        </Link>
      ),
    },
    {
      header: 'Location',
      accessor: 'location',
      sortable: true,
      searchable: true,
    },
    {
      header: 'Size',
      accessor: 'size',
      sortable: true,
      cell: (row) => (row.size ? `${row.size} m³` : '-'),
    },
    {
      header: 'Status',
      accessor: 'status',
      sortable: true,
      filterable: true,
      cell: (row) => {
        const getStatusStyles = () => {
          switch (row.status) {
            case 'active':
              return 'bg-green-100 text-green-800'
            case 'maintenance':
              return 'bg-yellow-100 text-yellow-800'
            case 'harvested':
              return 'bg-blue-100 text-blue-800'
            case 'fallow':
              return 'bg-gray-100 text-gray-800'
            case 'empty':
              return 'bg-purple-100 text-purple-800'
            default:
              return 'bg-gray-100 text-gray-800'
          }
        }

        return (
          <span
            className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusStyles()}`}
          >
            {row.status
              ? row.status.charAt(0).toUpperCase() + row.status.slice(1)
              : 'Unknown'}
          </span>
        )
      },
    },
  ]

  // Show loading state for initial load
  if (localLoading) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent"></div>
            <p className="mt-2 text-gray-600">Loading cages...</p>
          </div>
        </div>
      </div>
    )
  }

  // Show error state
  if (localError) {
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
                  <p>{localError}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <Link href="/dashboard">
                <button className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4">
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back to Dashboard
                </button>
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">
                Cage Management
              </h1>
            </div>
            <div className="flex space-x-2">
              <Link href="/create-cage">
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
                  <Plus className="h-4 w-4 mr-2" />
                  Create New Cage
                </button>
              </Link>
            </div>
          </div>
          <p className="text-gray-600">
            Manage your physical cages. Create new cages, update their status,
            or remove unused cages.
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">Total Cages</div>
            <div className="mt-2 text-2xl font-semibold text-blue-600">
              {analytics.totalCages}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">Active</div>
            <div className="mt-2 text-2xl font-semibold text-green-600">
              {analytics.activeCages}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">Ready for Harvest</div>
            <div className="mt-2 text-2xl font-semibold text-red-600">
              {analytics.harvestReadyCages}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">Maintenance</div>
            <div className="mt-2 text-2xl font-semibold text-yellow-600">
              {analytics.maintenanceCages}
            </div>
          </div>
        </div>

        {/* Enhanced Analytics Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Status Distribution */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Cage Status Distribution</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie
                    data={analyticsData.statusDistribution}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label
                  >
                    {analyticsData.statusDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </RechartsPieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Harvest Readiness */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Harvest Readiness</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie
                    data={analyticsData.harvestReadiness}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label
                  >
                    {analyticsData.harvestReadiness.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </RechartsPieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Enhanced Filter Section */}
        <div className="mb-6 bg-white rounded-lg shadow p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search cages by name or location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div className="flex gap-4">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="maintenance">Maintenance</option>
                <option value="harvested">Harvested</option>
                <option value="fallow">Fallow</option>
                <option value="empty">Empty</option>
              </select>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {showFilters ? 'Hide Filters' : 'Show Filters'}
              </button>
            </div>
          </div>
          
          {showFilters && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">DOC Range</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Min"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Size Range (m³)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Min"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Installation Date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
            </div>
          )}
        </div>

        {/* DataTable */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <DataTable
            data={filteredCages}
            columns={columns}
            pagination={true}
            currentPage={currentPage}
            totalPages={totalPages}
            recordsPerPage={50}
            loading={loading}
            searchable={true}
            filterable={true}
            sortable={true}
            onPageChange={handlePageChange}
            emptyMessage="No cages found. Create your first cage to get started."
          />
        </div>
      </div>
    </div>
  )
} 