// pages/stocking-management.js
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import {
  Search,
  Filter,
  ChevronDown,
  Edit,
  Trash2,
  Plus,
  AlertTriangle,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button, Field, Input, Select, Textarea, EmptyState } from '../components/ui'
import FarmLocationSelect from '../components/FarmLocationSelect'
import { stockingService } from '../lib/databaseService'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from '../hooks/usePermission'

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
  const { hasRole } = useAuth()
  const isAdmin = usePermission('production.stocking.approve')
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
      const cages = [
        ...new Set(
          data.map((s) => s.cage?.name || s.cage_name).filter(Boolean),
        ),
      ]
        .map((name) => ({
          name,
          id: data.find(
            (s) => (s.cage?.name || s.cage_name) === name,
          )?.cage_id,
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
          stocking.cage_name
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
        valueA = a.cage?.name || a.cage_name || ''
        valueB = b.cage?.name || b.cage_name || ''
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
    <Layout title="Stocking management">
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
            <Plus className="w-4 h-4" aria-hidden />
            New stocking
          </Button>
        }
      />

        {/* Filters and Actions */}
        <div className="page-card mb-6">
          <div className="p-4 flex flex-col md:flex-row gap-3 justify-between md:items-center border-b border-foam-deep">
            <div className="w-full md:w-80 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-muted" aria-hidden />
              </div>
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search stockings"
                aria-label="Search stockings"
                className="pl-10"
              />
            </div>

            <div className="flex gap-3">
              <div className="relative">
                <Button
                  variant="secondary"
                  onClick={() => setShowFilters(!showFilters)}
                  aria-expanded={showFilters}
                >
                  <Filter className="h-4 w-4" aria-hidden />
                  Filter
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </Button>

                {showFilters && (
                  <div className="origin-top-right absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-foam-deep shadow-xl bg-surface focus:outline-none z-10">
                    <div className="py-1 p-3 space-y-4">
                      <Field label="Year" htmlFor="stocking-year">
                        <Select
                          id="stocking-year"
                          value={yearFilter}
                          onChange={(e) => setYearFilter(e.target.value)}
                        >
                          <option value="all">All years</option>
                          {availableYears.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </Select>
                      </Field>

                      <Field label="Cage" htmlFor="stocking-cage">
                        <Select
                          id="stocking-cage"
                          value={cageFilter}
                          onChange={(e) => setCageFilter(e.target.value)}
                        >
                          <option value="all">All cages</option>
                          {uniqueCages.map((cage) => (
                            <option key={cage.id} value={cage.id}>
                              {cage.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
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
                <div className="animate-spin rounded-full h-8 w-8 border-4 border-lake border-t-transparent mx-auto"></div>
                <p className="mt-3 text-sm text-muted">
                  Loading stockings…
                </p>
              </div>
            ) : filteredStockings.length > 0 ? (
              <table className="min-w-full divide-y divide-foam-deep">
                <thead className="bg-foam">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium text-muted cursor-pointer"
                      onClick={() => handleSort('batch_number')}
                    >
                      <div className="flex items-center">
                        Batch number
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
                      className="px-4 py-3 text-left text-xs font-medium text-muted cursor-pointer"
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
                      className="px-4 py-3 text-left text-xs font-medium text-muted cursor-pointer"
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
                      className="px-4 py-3 text-left text-xs font-medium text-muted cursor-pointer"
                      onClick={() => handleSort('fish_count')}
                    >
                      <div className="flex items-center">
                        Fish count
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
                      className="px-4 py-3 text-left text-xs font-medium text-muted cursor-pointer"
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
                      className="px-4 py-3 text-left text-xs font-medium text-muted cursor-pointer"
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
                      className="px-4 py-3 text-left text-xs font-medium text-muted"
                    >
                      Source
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-xs font-medium text-muted"
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-foam-deep">
                  {filteredStockings.map((stocking) => (
                    <tr key={stocking.id} className="hover:bg-foam">
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-chart-ink">
                        {stocking.batch_number}
                        {stocking.species ? (
                          <span className="block text-xs text-muted font-normal">
                            {stocking.species.replace(/_/g, ' ')}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted">
                        {stocking.cage?.name ||
                          stocking.cage_name ||
                          'Unknown'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">
                        {formatDate(stocking.stocking_date)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">
                        {stocking.fish_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">
                        {stocking.initial_abw.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">
                        {stocking.initial_biomass.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted">
                        {stocking.source_location || 'N/A'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-muted">
                        <div className="flex justify-end gap-1">
                          {/* Approved stockings: admin only (backend). */}
                          {(isAdmin || stocking.status !== 'approved') && (
                            <button
                              type="button"
                              onClick={() => handleEditStocking(stocking)}
                              className="inline-flex items-center justify-center h-9 w-9 rounded-lg text-lake hover:bg-foam focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
                              title="Edit stocking"
                              aria-label="Edit stocking"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          )}
                          {isAdmin && stocking.status !== 'approved' && (
                            <button
                              type="button"
                              onClick={() => setDeleteStocking(stocking)}
                              className="inline-flex items-center justify-center h-9 w-9 rounded-lg text-signal hover:bg-signal/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
                              title="Delete stocking"
                              aria-label="Delete stocking"
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
              <EmptyState
                title="No stockings found"
                description="Stockings appear here once a batch is added to a cage."
                action={
                  <Button href="/stocking">
                    <Plus className="w-4 h-4" aria-hidden />
                    New stocking
                  </Button>
                }
              />
            )}
          </div>
        </div>

      {/* Edit Stocking Modal */}
      {showEditModal && editingStocking && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 modal-backdrop"
            onClick={() => setShowEditModal(false)}
          ></div>
          <div className="relative bg-surface rounded-xl border border-foam-deep shadow-xl max-w-md w-full p-6">
            <h3 className="font-display text-lg font-medium text-chart-ink mb-4">
              Edit stocking {editingStocking.batch_number}
            </h3>

            {error && (
              <div className="mb-4 bg-signal/10 text-signal p-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="mb-4 bg-kelp/10 text-kelp p-3 rounded-lg text-sm">
                {success}
              </div>
            )}

            <form onSubmit={handleSubmitEdit} className="space-y-4">
              <Field label="Stocking date" htmlFor="stocking-stocking-date" required>
                <Input
                  id="stocking-stocking-date"
                  type="date"
                  name="stocking_date"
                  value={formData.stocking_date}
                  onChange={handleChange}
                  required
                />
              </Field>

              <Field label="Fish count" htmlFor="stocking-fish-count" required>
                <Input
                  id="stocking-fish-count"
                  type="number"
                  name="fish_count"
                  value={formData.fish_count}
                  onChange={handleChange}
                  min="1"
                  required
                />
              </Field>

              <Field label="Initial ABW (g)" htmlFor="stocking-initial-abw-g" required>
                <Input
                  id="stocking-initial-abw-g"
                  type="number"
                  name="initial_abw"
                  value={formData.initial_abw}
                  onChange={handleChange}
                  step="0.1"
                  min="0.1"
                  required
                />
              </Field>

              <Field
                label="Initial biomass (kg)"
                htmlFor="stocking-biomass"
                hint="Worked out as (ABW / 1000) × fish count"
              >
                <Input
                  id="stocking-biomass"
                  type="text"
                  value={calculateBiomass().toFixed(2)}
                  className="bg-foam tabular-nums"
                  readOnly
                />
              </Field>

              <div className="space-y-1.5">
                <p className="block text-sm font-semibold text-chart-ink">
                  Source location
                </p>
                <FarmLocationSelect
                  name="source_location"
                  value={formData.source_location}
                  onChange={handleChange}
                  valueKind="name"
                  syncWithHeader={false}
                />
              </div>

              <Field label="Notes" htmlFor="stocking-notes">
                <Textarea
                  id="stocking-notes"
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={3}
                  placeholder="Optional notes"
                />
              </Field>

              <div className="flex justify-end gap-3 mt-5">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowEditModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Save changes</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteStocking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 modal-backdrop"
            onClick={() => !deleting && setDeleteStocking(null)}
          />
          <div className="relative bg-surface rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-6 h-6 text-signal" />
              <h3 className="font-display text-lg font-medium text-chart-ink">Delete stocking</h3>
            </div>
            <p className="text-sm text-muted mb-5">
              Delete batch{' '}
              <span className="font-semibold text-chart-ink">
                {deleteStocking.batch_number || deleteStocking.batchNumber}
              </span>
              ? Only pending or rejected stockings can be deleted.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={deleting}
                onClick={() => setDeleteStocking(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={deleting}
                onClick={handleConfirmDelete}
              >
                {deleting ? 'Deleting…' : 'Delete stocking'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
