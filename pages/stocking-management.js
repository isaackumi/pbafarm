// pages/stocking-management.js
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import {
  Search,
  Filter,
  ChevronDown,
  Edit,
  Trash2,
  Calendar,
  Plus,
  AlertTriangle,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button } from '../components/ui'
import { stockingService } from '../lib/databaseService'
import { useToast } from '../components/Toast'

export default function StockingManagementPage() {
  return (
    <ProtectedRoute>
      <StockingManagement />
    </ProtectedRoute>
  )
}

function StockingManagement() {
  const router = useRouter()
  const { showToast } = useToast()
  const [stockings, setStockings] = useState([])
  const [filteredStockings, setFilteredStockings] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [yearFilter, setYearFilter] = useState('all')
  const [cageFilter, setCageFilter] = useState('all')
  const [sortField, setSortField] = useState('stocking_date')
  const [sortDirection, setSortDirection] = useState('desc')
  const [uniqueCages, setUniqueCages] = useState([])
  const [availableYears, setAvailableYears] = useState([])
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingStocking, setEditingStocking] = useState(null)
  const [deleteStocking, setDeleteStocking] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [formData, setFormData] = useState({
    stocking_date: '',
    fish_count: '',
    initial_abw: '',
    source_location: '',
    notes: '',
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    filterStockings()
  }, [stockings, searchQuery, yearFilter, cageFilter, sortField, sortDirection])

  const fetchData = async () => {
    setLoading(true)
    try {
      const { data, error } = await stockingService.getAllStockings()

      if (error) throw error

      console.log('Fetched stockings:', data)
      setStockings(data || [])

      // Extract unique cages for filtering
      const cages = [...new Set(data.map((s) => s.cage?.name || 'Unknown'))]
        .map((name) => ({
          name,
          id: data.find((s) => s.cage?.name === name)?.cage_id,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      setUniqueCages(cages)

      // Extract available years for filtering
      const years = [
        ...new Set(data.map((s) => new Date(s.stocking_date).getFullYear())),
      ].sort((a, b) => b - a)

      setAvailableYears(years)
    } catch (error) {
      console.error('Error fetching stockings:', error)
    } finally {
      setLoading(false)
    }
  }

  const filterStockings = () => {
    let result = [...stockings]

    // Apply search filter
    if (searchQuery) {
      result = result.filter(
        (stocking) =>
          stocking.batch_number
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          stocking.cage?.name
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          stocking.source_location
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()),
      )
    }

    // Apply year filter
    if (yearFilter !== 'all') {
      const year = parseInt(yearFilter)
      result = result.filter(
        (stocking) => new Date(stocking.stocking_date).getFullYear() === year,
      )
    }

    // Apply cage filter
    if (cageFilter !== 'all') {
      result = result.filter((stocking) => stocking.cage_id === cageFilter)
    }

    // Apply sorting
    result.sort((a, b) => {
      let valueA = a[sortField]
      let valueB = b[sortField]

      // Handle special case for dates
      if (sortField === 'stocking_date') {
        valueA = new Date(valueA)
        valueB = new Date(valueB)
      }

      // Handle cage name sorting
      if (sortField === 'cage_name') {
        valueA = a.cage?.name || ''
        valueB = b.cage?.name || ''
      }

      if (valueA < valueB) {
        return sortDirection === 'asc' ? -1 : 1
      }
      if (valueA > valueB) {
        return sortDirection === 'asc' ? 1 : -1
      }
      return 0
    })

    setFilteredStockings(result)
  }

  const handleSort = (field) => {
    const actualField = field === 'cage_name' ? 'cage_name' : field

    if (sortField === actualField) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // New field, start with appropriate direction
      setSortField(actualField)
      setSortDirection(field === 'stocking_date' ? 'desc' : 'asc')
    }
  }

  const handleEditStocking = (stocking) => {
    setEditingStocking(stocking)
    setFormData({
      stocking_date: stocking.stocking_date,
      fish_count: stocking.fish_count,
      initial_abw: stocking.initial_abw,
      source_location: stocking.source_location || '',
      notes: stocking.notes || '',
    })
    setError('')
    setSuccess('')
    setShowEditModal(true)
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const calculateBiomass = () => {
    if (!formData.fish_count || !formData.initial_abw) return 0

    const count = parseFloat(formData.fish_count)
    const abw = parseFloat(formData.initial_abw)

    if (isNaN(count) || isNaN(abw)) return 0

    // Calculate biomass in kg (ABW in g / 1000 * count)
    return (abw / 1000) * count
  }

  const handleSubmitEdit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    try {
      if (!editingStocking) return

      // Validate input
      if (!formData.stocking_date) {
        throw new Error('Stocking date is required')
      }

      if (!formData.fish_count || parseFloat(formData.fish_count) <= 0) {
        throw new Error('Valid fish count is required')
      }

      if (!formData.initial_abw || parseFloat(formData.initial_abw) <= 0) {
        throw new Error('Valid average body weight is required')
      }

      // Calculate initial biomass
      const initial_biomass = calculateBiomass()

      // Prepare update data
      const updateData = {
        stocking_date: formData.stocking_date,
        fish_count: parseInt(formData.fish_count),
        initial_abw: parseFloat(formData.initial_abw),
        initial_biomass,
        source_location: formData.source_location || null,
        notes: formData.notes || null,
      }

      console.log('Updating stocking with data:', updateData)

      // Update stocking
      const { data, error } = await stockingService.updateStocking(
        editingStocking.id,
        updateData,
      )

      if (error) throw error

      setSuccess('Stocking updated successfully')
      showToast('Stocking updated successfully', 'success')

      setTimeout(() => {
        fetchData()
        setShowEditModal(false)
      }, 800)
    } catch (error) {
      console.error('Error updating stocking:', error)
      setError(error.message)
      showToast(error.message || 'Update failed', 'error')
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteStocking) return
    setDeleting(true)
    try {
      const { error } = await stockingService.deleteStocking(
        deleteStocking.id || deleteStocking._id,
      )
      if (error) throw error
      showToast('Stocking deleted', 'success')
      setDeleteStocking(null)
      fetchData()
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <Layout title="Stocking Management">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Cages', href: '/cages' },
          { label: 'Stocking management' },
        ]}
        description="View and manage fish stockings. Each stocking is a batch added to a cage."
        related={[
          { label: 'New stocking', href: '/stocking' },
          { label: 'Top-up', href: '/topup' },
          { label: 'Approvals', href: '/approvals' },
          { label: 'Cages', href: '/cages' },
        ]}
        actions={
          <Button href="/stocking" size="sm">
            <Plus className="w-4 h-4" />
            New Stocking
          </Button>
        }
      />

        {/* Filters and Actions */}
        <div className="page-card mb-6">
          <div className="p-4 flex flex-col md:flex-row justify-between items-center border-b border-foam-deep">
            <div className="w-full md:w-auto mb-4 md:mb-0 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-muted" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search stockings..."
                className="pl-10 block w-full sm:text-sm border-input-border rounded-md focus:ring-lagoon-800 focus:border-lagoon-800"
              />
            </div>

            <div className="flex space-x-3">
              <div className="relative">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center py-2 px-4 border border-input-border rounded-md shadow-sm bg-white text-sm font-medium text-chart-ink hover:bg-foam-deep/40"
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Filter
                  <ChevronDown className="ml-1 h-4 w-4" />
                </button>

                {showFilters && (
                  <div className="origin-top-right absolute right-0 mt-2 w-72 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-10">
                    <div className="py-1 p-3 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-chart-ink mb-1">
                          Year
                        </label>
                        <select
                          value={yearFilter}
                          onChange={(e) => setYearFilter(e.target.value)}
                          className="block w-full pl-3 pr-10 py-2 text-base border-input-border focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm rounded-md"
                        >
                          <option value="all">All Years</option>
                          {availableYears.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-chart-ink mb-1">
                          Cage
                        </label>
                        <select
                          value={cageFilter}
                          onChange={(e) => setCageFilter(e.target.value)}
                          className="block w-full pl-3 pr-10 py-2 text-base border-input-border focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm rounded-md"
                        >
                          <option value="all">All Cages</option>
                          {uniqueCages.map((cage) => (
                            <option key={cage.id} value={cage.id}>
                              {cage.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stocking Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="py-12 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lagoon-800 mx-auto"></div>
                <p className="mt-3 text-sm text-muted">
                  Loading stocking data...
                </p>
              </div>
            ) : filteredStockings.length > 0 ? (
              <table className="min-w-full divide-y divide-foam-deep">
                <thead className="bg-foam-deep/40">
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider cursor-pointer"
                      onClick={() => handleSort('batch_number')}
                    >
                      <div className="flex items-center">
                        Batch Number
                        {sortField === 'batch_number' && (
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
                      className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider cursor-pointer"
                      onClick={() => handleSort('cage_name')}
                    >
                      <div className="flex items-center">
                        Cage
                        {sortField === 'cage_name' && (
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
                      className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider cursor-pointer"
                      onClick={() => handleSort('stocking_date')}
                    >
                      <div className="flex items-center">
                        Date
                        {sortField === 'stocking_date' && (
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
                      className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider cursor-pointer"
                      onClick={() => handleSort('fish_count')}
                    >
                      <div className="flex items-center">
                        Fish Count
                        {sortField === 'fish_count' && (
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
                      className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider cursor-pointer"
                      onClick={() => handleSort('initial_abw')}
                    >
                      <div className="flex items-center">
                        ABW (g)
                        {sortField === 'initial_abw' && (
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
                      className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider cursor-pointer"
                      onClick={() => handleSort('initial_biomass')}
                    >
                      <div className="flex items-center">
                        Biomass (kg)
                        {sortField === 'initial_biomass' && (
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
                      className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                    >
                      Source
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider"
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-foam-deep">
                  {filteredStockings.map((stocking) => (
                    <tr key={stocking.id} className="hover:bg-foam-deep/40">
                      <td className="px-6 py-4 whitespace-nowrap font-medium text-lagoon-800">
                        {stocking.batch_number}
                        {stocking.species ? (
                          <span className="block text-xs text-muted font-normal">
                            {stocking.species.replace(/_/g, ' ')}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {stocking.cage?.name || 'Unknown'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {formatDate(stocking.stocking_date)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {stocking.fish_count.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {stocking.initial_abw.toFixed(1)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {stocking.initial_biomass.toFixed(1)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {stocking.source_location || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-muted">
                        <div className="flex justify-end gap-3">
                          <button
                            onClick={() => handleEditStocking(stocking)}
                            className="text-lagoon-800 hover:text-lagoon-950"
                            title="Edit Stocking"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          {stocking.status !== 'approved' && (
                            <button
                              onClick={() => setDeleteStocking(stocking)}
                              className="text-signal hover:opacity-80"
                              title="Delete Stocking"
                            >
                              <Trash2 className="w-4 h-4" />
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
                <p className="text-muted">No stocking records found.</p>
                <Link href="/stocking">
                  <button className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-lagoon-800 hover:bg-lagoon-950">
                    <Plus className="w-4 h-4 mr-2" />
                    Create New Stocking
                  </button>
                </Link>
              </div>
            )}
          </div>
        </div>

      {/* Edit Stocking Modal */}
      {showEditModal && editingStocking && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowEditModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">
              Edit Stocking: {editingStocking.batch_number}
            </h3>

            {error && (
              <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-md text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="mb-4 bg-green-50 text-green-700 p-3 rounded-md text-sm">
                {success}
              </div>
            )}

            <form onSubmit={handleSubmitEdit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Stocking Date
                </label>
                <input
                  type="date"
                  name="stocking_date"
                  value={formData.stocking_date}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Fish Count
                </label>
                <input
                  type="number"
                  name="fish_count"
                  value={formData.fish_count}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  min="1"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Initial ABW (g)
                </label>
                <input
                  type="number"
                  name="initial_abw"
                  value={formData.initial_abw}
                  onChange={handleChange}
                  step="0.1"
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  min="0.1"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Initial Biomass (kg)
                </label>
                <input
                  type="text"
                  value={calculateBiomass().toFixed(2)}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm bg-foam-deep/40"
                  readOnly
                />
                <p className="mt-1 text-xs text-muted">
                  Auto-calculated: (ABW/1000) × Fish Count
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Source Location
                </label>
                <input
                  type="text"
                  name="source_location"
                  value={formData.source_location}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Notes
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows="3"
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  placeholder="Optional notes"
                ></textarea>
              </div>

              <div className="flex justify-end space-x-3 mt-5">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-input-border rounded-md shadow-sm text-sm font-medium text-chart-ink bg-white hover:bg-foam-deep/40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-lagoon-800 hover:bg-lagoon-950"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteStocking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !deleting && setDeleteStocking(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-6 h-6 text-signal" />
              <h3 className="text-lg font-semibold text-chart-ink">Delete stocking</h3>
            </div>
            <p className="text-sm text-muted mb-5">
              Delete batch{' '}
              <span className="font-semibold text-chart-ink">
                {deleteStocking.batch_number || deleteStocking.batchNumber}
              </span>
              ? Only pending or rejected stockings can be deleted.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteStocking(null)}
                className="px-4 py-2 border border-input-border rounded-md text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-md text-sm font-medium text-white bg-signal"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
