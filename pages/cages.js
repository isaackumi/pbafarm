// pages/cages.js (Updated with DataTable component)
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import ProtectedRoute from '../components/ProtectedRoute'
import DataTable from '../components/DataTable'
import {
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
  const [loading, setLoading] = useState(true)
  const [statistics, setStatistics] = useState({
    totalCages: 0,
    activeCages: 0,
    harvestedCages: 0,
    maintenanceCages: 0,
    fallowCages: 0,
    emptyCages: 0,
  })
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [cageToDelete, setCageToDelete] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingCage, setEditingCage] = useState(null)
  const [editFormData, setEditFormData] = useState({
    name: '',
    location: '',
    status: '',
  })
  const [editSuccess, setEditSuccess] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

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

  const handleEditCage = (cage) => {
    setEditingCage(cage)
    setEditFormData({
      name: cage.name,
      location: cage.location || '',
      status: cage.status || 'empty',
    })
    setEditSuccess('')
    setShowEditModal(true)
  }

  const handleEditChange = (e) => {
    const { name, value } = e.target
    setEditFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleEditSubmit = async (e) => {
    e.preventDefault()

    try {
      // Check if name is changed and not empty
      if (!editFormData.name.trim()) {
        throw new Error('Cage name cannot be empty')
      }

      // If name is changed, check if it's unique
      if (editFormData.name !== editingCage.name) {
        const nameExists = cages.some(
          (cage) =>
            cage.id !== editingCage.id &&
            cage.name.toLowerCase() === editFormData.name.toLowerCase(),
        )

        if (nameExists) {
          throw new Error(
            'This cage name already exists. Please choose a unique name.',
          )
        }
      }

      // Update cage
      const updateData = {
        name: editFormData.name.trim(),
        location: editFormData.location.trim() || null,
        status: editFormData.status,
      }

      const { data, error } = await cageService.updateCage(
        editingCage.id,
        updateData,
      )

      if (error) throw error

      setEditSuccess('Cage updated successfully')

      // Refresh data after short delay
      setTimeout(() => {
        fetchData()
        setShowEditModal(false)
      }, 1500)
    } catch (error) {
      console.error('Error updating cage:', error)
      setDeleteError(error.message)
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

  // DataTable column definitions
  const columns = [
    {
      header: 'Cage Name',
      accessor: 'name',
      sortable: true,
      searchable: true,
      cell: (row) => (
        <Link
          href={`/cage/${row.id}`}
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
      header: 'Installation Date',
      accessor: 'installation_date',
      sortable: true,
      cell: (row) =>
        row.installation_date
          ? new Date(row.installation_date).toLocaleDateString()
          : '-',
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

  // Define actions for the DataTable
  const tableActions = {
    edit: (row) => handleEditCage(row),
    delete: (row) => {
      // Only allow deleting non-active cages
      if (row.status !== 'active') {
        confirmDeleteCage(row)
      }
    },
    custom: [
      {
        title: 'Change Status',
        icon: <Edit className="w-4 h-4" />,
        className: 'text-blue-600 hover:text-blue-900 relative group',
        handler: () => {}, // This is a dummy handler since we'll use the dropdown
      },
    ],
  }

  const handleViewCage = (cage) => {
    router.push(`/cage/${cage.id}`)
  }

  return (
    <div className="min-h-screen bg-gray-100 font-montserrat">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <Link
                href="/dashboard"
                className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to Dashboard
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">
                Cage Management
              </h1>
            </div>
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

        {/* Action Buttons */}
        <div className="mb-6">
          <Link href="/create-cage">
            <button className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">
              <Plus className="h-4 w-4 mr-2" />
              Create New Cage
            </button>
          </Link>
        </div>

        {/* DataTable */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <DataTable
            data={cages}
            columns={columns}
            actions={tableActions}
            pagination={true}
            recordsPerPage={10}
            loading={loading}
            searchable={true}
            filterable={true}
            sortable={true}
            onRowClick={handleViewCage}
            emptyMessage="No cages found. Create your first cage to get started."
          />
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

      {/* Edit Cage Modal */}
      {showEditModal && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowEditModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Edit Cage
            </h3>

            {deleteError && (
              <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-md text-sm">
                {deleteError}
              </div>
            )}

            {editSuccess && (
              <div className="mb-4 bg-green-50 text-green-700 p-3 rounded-md text-sm">
                {editSuccess}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cage Name
                </label>
                <input
                  type="text"
                  name="name"
                  value={editFormData.name}
                  onChange={handleEditChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location
                </label>
                <input
                  type="text"
                  name="location"
                  value={editFormData.location}
                  onChange={handleEditChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  name="status"
                  value={editFormData.status}
                  onChange={handleEditChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  <option value="empty">Empty</option>
                  <option value="active">Active</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="harvested">Harvested</option>
                  <option value="fallow">Fallow</option>
                </select>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Status Change Modal would go here - but using the standard dropdown for now */}
    </div>
  )
}

// export default CagesPage;
