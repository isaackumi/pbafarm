// pages/cages.js (Updated to focus on physical cage management)
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import ProtectedRoute from '../components/ProtectedRoute'
import {
  Search,
  Filter,
  ChevronDown,
  Edit,
  Trash,
  CheckCircle,
  AlertCircle,
  Clock,
  Plus,
} from 'lucide-react'
import { cageService, analyticsService } from '../lib/databaseService'

export default function CagesPage() {
  return (
    <ProtectedRoute>
      <CagesManagement />
    </ProtectedRoute>
  )
}

function CagesManagement() {
  const router = useRouter()
  const [cages, setCages] = useState([])
  const [filteredCages, setFilteredCages] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [sortField, setSortField] = useState('name')
  const [sortDirection, setSortDirection] = useState('asc')
  const [statistics, setStatistics] = useState({
    totalCages: 0,
    activeCages: 0,
    harvestedCages: 0,
    maintenanceCages: 0,
    fallowCages: 0,
    emptyCages: 0,
  })
  const [statusOptions, setStatusOptions] = useState([
    { value: 'active', label: 'Active' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'harvested', label: 'Harvested' },
    { value: 'fallow', label: 'Fallow' },
    { value: 'empty', label: 'Empty' },
  ])
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [cageToDelete, setCageToDelete] = useState(null)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    filterCages()
  }, [cages, searchQuery, statusFilter, sortField, sortDirection])

  const fetchData = async () => {
    setLoading(true)

    try {
      // Fetch cages
      const {
        data: cageData,
        error: cageError,
      } = await cageService.getAllCages()

      if (cageError) {
        console.error('Error fetching cages:', cageError)
        throw cageError
      }

      console.log('Fetched cages:', cageData)
      setCages(cageData || [])

      // Fetch statistics
      const {
        data: statsData,
        error: statsError,
      } = await analyticsService.getCageSummaryStats()

      if (statsError) {
        console.error('Error fetching statistics:', statsError)
        throw statsError
      }

      console.log('Fetched statistics:', statsData)
      setStatistics(statsData)
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const filterCages = () => {
    let result = [...cages]

    // Apply search filter
    if (searchQuery) {
      result = result.filter(
        (cage) =>
          cage.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (cage.location &&
            cage.location.toLowerCase().includes(searchQuery.toLowerCase())),
      )
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter((cage) => cage.status === statusFilter)
    }

    // Apply sorting
    result.sort((a, b) => {
      let valueA = a[sortField]
      let valueB = b[sortField]

      // Handle special case for dates
      if (sortField === 'installation_date') {
        valueA = valueA ? new Date(valueA) : new Date(0)
        valueB = valueB ? new Date(valueB) : new Date(0)
      }

      // Handle nulls in comparison
      if (valueA === null && valueB === null) return 0
      if (valueA === null) return sortDirection === 'asc' ? 1 : -1
      if (valueB === null) return sortDirection === 'asc' ? -1 : 1

      if (valueA < valueB) {
        return sortDirection === 'asc' ? -1 : 1
      }
      if (valueA > valueB) {
        return sortDirection === 'asc' ? 1 : -1
      }
      return 0
    })

    setFilteredCages(result)
  }

  const handleSort = (field) => {
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // New field, start with ascending
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const updateCageStatus = async (cageId, newStatus) => {
    try {
      const { error } = await cageService.updateCageStatus(cageId, newStatus)

      if (error) {
        console.error('Error updating cage status:', error)
        return
      }

      // Refresh data after update
      fetchData()
    } catch (error) {
      console.error('Error updating cage status:', error)
    }
  }

  const confirmDeleteCage = (cage) => {
    setCageToDelete(cage)
    setDeleteError('')
    setShowDeleteModal(true)
  }

  const handleDeleteCage = async () => {
    if (!cageToDelete) return

    try {
      const { error } = await cageService.deleteCage(cageToDelete.id)

      if (error) {
        setDeleteError(error.message)
        return
      }

      // Close modal and refresh data
      setShowDeleteModal(false)
      setCageToDelete(null)
      fetchData()
    } catch (error) {
      console.error('Error deleting cage:', error)
      setDeleteError(error.message)
    }
  }

  // Status badge component
  const StatusBadge = ({ status }) => {
    const getStatusStyles = () => {
      switch (status) {
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
        {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown'}
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 font-montserrat">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900">
              Cage Management
            </h1>
            <div className="flex space-x-2">
              <Link href="/stocking-management">
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
                  View Stocking History
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
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">Total Cages</div>
            <div className="mt-2 text-2xl font-semibold text-blue-600">
              {statistics.totalCages}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">Active</div>
            <div className="mt-2 text-2xl font-semibold text-green-600">
              {statistics.activeCages}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">Harvested</div>
            <div className="mt-2 text-2xl font-semibold text-blue-600">
              {statistics.harvestedCages}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">Maintenance</div>
            <div className="mt-2 text-2xl font-semibold text-yellow-600">
              {statistics.maintenanceCages}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">Fallow</div>
            <div className="mt-2 text-2xl font-semibold text-gray-600">
              {statistics.fallowCages}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">Empty</div>
            <div className="mt-2 text-2xl font-semibold text-purple-600">
              {statistics.emptyCages}
            </div>
          </div>
        </div>

        {/* Filters and Actions */}
        <div className="bg-white shadow rounded-lg mb-6">
          <div className="p-4 flex flex-col md:flex-row justify-between items-center border-b border-gray-200">
            <div className="w-full md:w-auto mb-4 md:mb-0 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search cages..."
                className="pl-10 block w-full sm:text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <div className="flex space-x-3">
              <div className="relative">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Filter
                  <ChevronDown className="ml-1 h-4 w-4" />
                </button>

                {showFilters && (
                  <div className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-10">
                    <div className="py-1 p-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Status
                      </label>
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                      >
                        <option value="all">All Statuses</option>
                        {statusOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <Link href="/create-cage">
                <button className="inline-flex items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Cage
                </button>
              </Link>
            </div>
          </div>

          {/* Cage Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="py-12 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="mt-3 text-sm text-gray-500">Loading cages...</p>
              </div>
            ) : filteredCages.length > 0 ? (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center">
                        Cage Name
                        {sortField === 'name' && (
                          <ChevronDown
                            className={`ml-1 h-4 w-4 ${
                              sortDirection === 'desc'
                                ? 'transform rotate-180'
                                : ''
                            }`}
                          />
                        )}
                      </div>
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      onClick={() => handleSort('location')}
                    >
                      <div className="flex items-center">
                        Location
                        {sortField === 'location' && (
                          <ChevronDown
                            className={`ml-1 h-4 w-4 ${
                              sortDirection === 'desc'
                                ? 'transform rotate-180'
                                : ''
                            }`}
                          />
                        )}
                      </div>
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      onClick={() => handleSort('size')}
                    >
                      <div className="flex items-center">
                        Size
                        {sortField === 'size' && (
                          <ChevronDown
                            className={`ml-1 h-4 w-4 ${
                              sortDirection === 'desc'
                                ? 'transform rotate-180'
                                : ''
                            }`}
                          />
                        )}
                      </div>
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      onClick={() => handleSort('installation_date')}
                    >
                      <div className="flex items-center">
                        Installation Date
                        {sortField === 'installation_date' && (
                          <ChevronDown
                            className={`ml-1 h-4 w-4 ${
                              sortDirection === 'desc'
                                ? 'transform rotate-180'
                                : ''
                            }`}
                          />
                        )}
                      </div>
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center">
                        Status
                        {sortField === 'status' && (
                          <ChevronDown
                            className={`ml-1 h-4 w-4 ${
                              sortDirection === 'desc'
                                ? 'transform rotate-180'
                                : ''
                            }`}
                          />
                        )}
                      </div>
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredCages.map((cage) => (
                    <tr key={cage.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Link
                          href={`/cage/${cage.id}`}
                          className="text-indigo-600 hover:text-indigo-900 font-medium"
                        >
                          {cage.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {cage.location || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {cage.size ? `${cage.size} m³` : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {cage.installation_date
                          ? new Date(
                              cage.installation_date,
                            ).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <StatusBadge status={cage.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-500">
                        <div className="flex justify-end space-x-3">
                          {/* Change Status Dropdown */}
                          <div className="relative group">
                            <button
                              className="p-1 rounded hover:bg-gray-100"
                              title="Change Status"
                            >
                              <Edit className="w-4 h-4 text-gray-500" />
                            </button>

                            <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg hidden group-hover:block z-10">
                              <div className="py-1">
                                <button
                                  onClick={() =>
                                    updateCageStatus(cage.id, 'active')
                                  }
                                  className="flex items-center w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                >
                                  <CheckCircle className="w-4 h-4 mr-2 text-green-500" />
                                  Set as Active
                                </button>
                                <button
                                  onClick={() =>
                                    updateCageStatus(cage.id, 'maintenance')
                                  }
                                  className="flex items-center w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                >
                                  <Clock className="w-4 h-4 mr-2 text-yellow-500" />
                                  Set as Maintenance
                                </button>
                                <button
                                  onClick={() =>
                                    updateCageStatus(cage.id, 'harvested')
                                  }
                                  className="flex items-center w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                >
                                  <CheckCircle className="w-4 h-4 mr-2 text-blue-500" />
                                  Set as Harvested
                                </button>
                                <button
                                  onClick={() =>
                                    updateCageStatus(cage.id, 'fallow')
                                  }
                                  className="flex items-center w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                >
                                  <AlertCircle className="w-4 h-4 mr-2 text-gray-500" />
                                  Set as Fallow
                                </button>
                                <button
                                  onClick={() =>
                                    updateCageStatus(cage.id, 'empty')
                                  }
                                  className="flex items-center w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                >
                                  <AlertCircle className="w-4 h-4 mr-2 text-purple-500" />
                                  Set as Empty
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* View Cage Details */}
                          <Link href={`/cage/${cage.id}`}>
                            <button
                              className="p-1 rounded hover:bg-gray-100"
                              title="View Cage Details"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-4 w-4 text-indigo-600"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                />
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                />
                              </svg>
                            </button>
                          </Link>

                          {/* Delete Cage */}
                          {cage.status !== 'active' && (
                            <button
                              onClick={() => confirmDeleteCage(cage)}
                              className="p-1 rounded hover:bg-gray-100"
                              title="Delete Cage"
                            >
                              <Trash className="w-4 h-4 text-red-500" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-12 text-center">
                <p className="text-gray-500">
                  No cages found matching your filters.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowDeleteModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Confirm Deletion
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Are you sure you want to delete the cage "{cageToDelete?.name}"?
              This action cannot be undone.
            </p>

            {deleteError && (
              <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-md text-sm">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteCage}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
