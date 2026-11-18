import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../../components/ProtectedRoute'
import { formatCurrency, formatNumber } from '../../lib/currencyUtils'
import Layout from '../../components/Layout'
import {
  PageHeader,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  StatCard,
} from '../../components/ui'
import DataTable from '../../components/DataTable'
import { feedTypeService } from '../../lib/feedTypeService'
import { supplierService } from '../../lib/supplierService'
import { feedService } from '../../lib/feedService'
import { buildFeedTypeDescription } from '../../lib/feedTypeMeta'
import { getConvexHttpClient, api } from '../../lib/convexBridge'
import { withActiveLocation } from '../../lib/locationScope'
import { useToast } from '../../components/Toast'
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal'
import FeedPurchaseModal from '../../components/FeedPurchaseModal'
import { Plus, ArrowLeft, Download, Filter, Search, ChevronLeft, ChevronRight, ShoppingCart } from 'lucide-react'
import Link from 'next/link'

const FeedManagement = () => {
  const [feedTypes, setFeedTypes] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingType, setEditingType] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    price_per_kg: '0.00',
    protein_content: '',
    description: '',
    pellet_size: '',
    minimum_stock: '',
    bag_size_kg: '20',
    supplier_id: '',
    active: true,
  })
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all') // 'all', 'active', 'inactive'
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)
  const { showToast } = useToast()
  const router = useRouter()
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false)
  const [supplierFormData, setSupplierFormData] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    active: true
  })
  const [showPurchaseModal, setShowPurchaseModal] = useState(false)
  const [totalStockKg, setTotalStockKg] = useState(0)
  const [monthlyUsageKg, setMonthlyUsageKg] = useState(0)

  useEffect(() => {
    refreshPageData()
  }, [])

  const fetchDashboardStats = async (typesFallback = []) => {
    try {
      const client = getConvexHttpClient()
      const [stockLevels, usageResult] = await Promise.all([
        client.query(api.inventory.listStockLevels, withActiveLocation({})),
        feedService.getFeedUsageStats('30d'),
      ])
      const stock = (stockLevels || []).reduce(
        (sum, row) => sum + Number(row.current_stock ?? row.currentStock ?? 0),
        0,
      )
      setTotalStockKg(stock)
      setMonthlyUsageKg(Number(usageResult?.data?.totalUsage) || 0)
    } catch (error) {
      console.error('Error fetching dashboard stats:', error)
      const fallbackStock = (typesFallback || []).reduce(
        (sum, type) => sum + Number(type.current_stock || type.currentStock || 0),
        0,
      )
      setTotalStockKg(fallbackStock)
    }
  }

  const fetchFeedTypes = async () => {
    try {
      setLoading(true)
      const { data, error } = await feedTypeService.getAllFeedTypes()
      if (error) throw error
      const types = data || []
      setFeedTypes(types)
      return types
    } catch (error) {
      console.error('Error fetching feed types:', error)
      setError('Failed to load feed types')
      showToast('Error loading feed types', 'error')
      return []
    } finally {
      setLoading(false)
    }
  }

  const fetchSuppliers = async () => {
    try {
      const { data, error } = await supplierService.getAllSuppliers()
      if (error) {
        console.error('Error fetching suppliers:', error)
        showToast(error.message || 'Failed to load suppliers', 'error')
        return
      }
      setSuppliers(data || [])
    } catch (error) {
      console.error('Error in fetchSuppliers:', error)
      showToast('An unexpected error occurred while loading suppliers', 'error')
    }
  }

  const refreshPageData = async () => {
    const [types] = await Promise.all([fetchFeedTypes(), fetchSuppliers()])
    await fetchDashboardStats(types)
  }

  const emptyFeedForm = () => ({
    name: '',
    price_per_kg: '0.00',
    protein_content: '',
    description: '',
    pellet_size: '',
    minimum_stock: '',
    bag_size_kg: '20',
    supplier_id: '',
    active: true,
  })

  const closeFeedModal = () => {
    setShowAddModal(false)
    setShowEditModal(false)
    setEditingType(null)
    setFormData(emptyFeedForm())
  }

  const handleAddFeedType = () => {
    setEditingType(null)
    setFormData(emptyFeedForm())
    setShowEditModal(false)
    setShowAddModal(true)
  }

  const handleEditFeedType = (feedType) => {
    setEditingType(feedType)
    const protein =
      feedType.protein_percentage ??
      feedType.protein_content ??
      ''
    setFormData({
      name: feedType.name || '',
      price_per_kg: String(feedType.price_per_kg ?? feedType.pricePerKg ?? '0.00'),
      protein_content: protein !== '' && protein != null ? String(protein) : '',
      description: feedType.description || '',
      pellet_size: feedType.pellet_size || '',
      minimum_stock:
        feedType.minimum_stock != null
          ? String(feedType.minimum_stock)
          : '',
      bag_size_kg: String(
        feedType.bag_size_kg || feedType.bagSizeKg || 25,
      ),
      supplier_id: feedType.supplier_id || feedType.supplierId || '',
      active: feedType.active !== false,
    })
    setShowEditModal(false)
    setShowAddModal(true)
  }

  const handleDeleteFeedType = async () => {
    const id = deleteConfirm?.id || deleteConfirm
    if (!id) return
    try {
      const { error } = await feedTypeService.deleteFeedType(id)
      if (error) throw error
      showToast('Feed type deleted successfully', 'success')
      setDeleteConfirm(null)
      refreshPageData()
    } catch (error) {
      console.error('Error deleting feed type:', error)
      showToast(error.message || 'Failed to delete feed type', 'error')
    }
  }

  const buildFeedPayload = () => {
    const bag_size_kg =
      formData.bag_size_kg !== ''
        ? Number(formData.bag_size_kg)
        : 25
    const description = buildFeedTypeDescription({
      protein_content: formData.protein_content,
      pellet_size: formData.pellet_size,
      bag_size_kg,
    })
    return {
      name: formData.name.trim(),
      description:
        description || formData.description?.trim() || undefined,
      price_per_kg: formData.price_per_kg,
      current_stock: 0,
      minimum_stock:
        formData.minimum_stock !== ''
          ? Number(formData.minimum_stock)
          : 0,
      bag_size_kg,
      supplier_id: formData.supplier_id || undefined,
      active: formData.active !== false,
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (!formData.name.trim()) {
        showToast('Name is required', 'error')
        return
      }
      const payload = buildFeedPayload()
      if (editingType) {
        const { error } = await feedTypeService.updateFeedType(
          editingType.id || editingType._id,
          payload,
        )
        if (error) throw error
        showToast('Feed type updated successfully', 'success')
      } else {
        const { error } = await feedTypeService.createFeedType(payload)
        if (error) throw error
        showToast('Feed type created successfully', 'success')
      }
      closeFeedModal()
      refreshPageData()
    } catch (error) {
      console.error('Error saving feed type:', error)
      showToast(error.message || 'Failed to save feed type', 'error')
    }
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  const filteredFeedTypes = feedTypes
    .filter(feedType => {
      const matchesSearch = feedType.name.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesStatus = statusFilter === 'all' || 
        (statusFilter === 'active' && feedType.active) || 
        (statusFilter === 'inactive' && !feedType.active)
      return matchesSearch && matchesStatus
    })

  // Pagination
  const indexOfLastItem = currentPage * itemsPerPage
  const indexOfFirstItem = indexOfLastItem - itemsPerPage
  const currentItems = filteredFeedTypes.slice(indexOfFirstItem, indexOfLastItem)
  const totalPages = Math.ceil(filteredFeedTypes.length / itemsPerPage)

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber)
  }

  const handleStatusChange = async (id, newStatus) => {
    try {
      const { error } = await feedTypeService.updateFeedType(id, { active: newStatus })
      if (error) throw error
      showToast(`Feed type ${newStatus ? 'activated' : 'deactivated'} successfully`, 'success')
      refreshPageData()
    } catch (error) {
      console.error('Error updating feed type status:', error)
      showToast('Failed to update feed type status', 'error')
    }
  }

  const handleAddSupplier = () => {
    setSupplierFormData({
      name: '',
      contact_person: '',
      phone: '',
      email: '',
      address: '',
      active: true
    })
    setShowAddSupplierModal(true)
  }

  const handleSupplierSubmit = async (e) => {
    e.preventDefault()
    try {
      const { error } = await supplierService.createSupplier(supplierFormData)
      if (error) throw error
      showToast('Supplier added successfully', 'success')
      setShowAddSupplierModal(false)
      fetchSuppliers()
    } catch (error) {
      console.error('Error adding supplier:', error)
      showToast('Failed to add supplier', 'error')
    }
  }

  const handleSupplierChange = (e) => {
    const { name, value, type, checked } = e.target
    setSupplierFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  const activeSupplierCount = suppliers.filter(
    (s) => s.active !== false && !s.deleted_at,
  ).length
  const activeFeedTypeCount = feedTypes.filter(
    (t) => t.active !== false && !t.deleted_at,
  ).length

  return (
    <ProtectedRoute>
      <Layout title="Feed Management">
        <div className="max-w-7xl" data-tour="page-feed-management">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Feed' },
              { label: 'Management' },
            ]}
            description="Manage feed types, suppliers, and track usage across your farm."
            related={[
              { label: 'Stock levels', href: '/stock-levels' },
              { label: 'Issue feed', href: '/feed-issue' },
              { label: 'Purchases', href: '/feed-purchases' },
              { label: 'Overview', href: '/feed-management/overview' },
            ]}
            actions={
              <Button href="/feed-issue" size="sm">
                Issue feed
              </Button>
            }
          />

          {/* Quick Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              label="Feed types"
              value={loading ? '—' : formatNumber(activeFeedTypeCount, { decimals: 0 })}
            />
            <StatCard
              label="Active suppliers"
              value={formatNumber(activeSupplierCount, { decimals: 0 })}
            />
            <StatCard
              label="Feed in stock"
              value={loading ? '—' : formatNumber(totalStockKg, { decimals: 0 })}
              unit={loading ? '' : 'kg'}
            />
            <StatCard
              label="Monthly usage"
              value={loading ? '—' : formatNumber(monthlyUsageKg, { decimals: 0 })}
              unit={loading ? '' : 'kg'}
            />
          </div>

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Feed Types Card */}
            <div className="lg:col-span-2">
              <div className="page-card-sm">
                <div className="px-4 sm:px-6 py-4 border-b border-foam-deep">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-medium text-chart-ink">Feed types</h2>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={handleAddFeedType}>
                        <Plus className="h-4 w-4" aria-hidden />
                        Add feed type
                      </Button>
                      <Button variant="secondary" onClick={() => setShowPurchaseModal(true)}>
                        <ShoppingCart className="h-4 w-4" aria-hidden />
                        Record purchase
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="p-4 sm:p-6">
                  {/* Filters */}
                  <div className="mb-6 flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <Input
                        type="text"
                        aria-label="Search feed types"
                        placeholder="Search feed types…"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-4 w-4 text-muted" aria-hidden />
                      </div>
                    </div>
                    <Select
                      aria-label="Status"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="sm:w-44"
                    >
                      <option value="all">All statuses</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </Select>
                  </div>

                  {loading ? (
                    <div className="flex justify-center items-center h-32">
                      <div className="w-8 h-8 border-4 border-lake border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  ) : error ? (
                    <div className="text-center text-signal">{error}</div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-foam-deep">
                          <thead className="bg-foam-deep/40">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-muted">Name</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-muted">Protein %</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-muted">Price/kg</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-muted">Status</th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-muted">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-surface divide-y divide-foam-deep">
                            {currentItems.map((type) => (
                              <tr key={type.id} className="hover:bg-foam">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-chart-ink">{type.name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted tabular-nums">
                                  {type.protein_percentage != null && type.protein_percentage !== ''
                                    ? `${type.protein_percentage}%`
                                    : '—'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted tabular-nums">{formatCurrency(type.price_per_kg)}</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => handleStatusChange(type.id, !type.active)}
                                    className={`px-2 inline-flex text-xs leading-5 font-medium rounded-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-lake ${
                                      type.active ? 'bg-kelp/15 text-kelp' : 'bg-signal/15 text-signal'
                                    }`}
                                  >
                                    {type.active ? 'Active' : 'Inactive'}
                                  </button>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleEditFeedType(type)}
                                      className="text-lake"
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setDeleteConfirm(type)}
                                      className="text-signal"
                                    >
                                      Delete
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-foam-deep bg-surface px-4 py-3 sm:px-6 mt-4">
                          <div className="flex flex-1 justify-between sm:hidden">
                            <Button
                              variant="secondary"
                              onClick={() => handlePageChange(currentPage - 1)}
                              disabled={currentPage === 1}
                            >
                              Previous
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => handlePageChange(currentPage + 1)}
                              disabled={currentPage === totalPages}
                              className="ml-3"
                            >
                              Next
                            </Button>
                          </div>
                          <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm text-muted tabular-nums">
                                Showing <span className="font-medium">{indexOfFirstItem + 1}</span> to{' '}
                                <span className="font-medium">
                                  {Math.min(indexOfLastItem, filteredFeedTypes.length)}
                                </span>{' '}
                                of <span className="font-medium">{filteredFeedTypes.length}</span> results
                              </p>
                            </div>
                            <div>
                              <nav className="isolate inline-flex -space-x-px rounded-lg" aria-label="Pagination">
                                <button
                                  type="button"
                                  onClick={() => handlePageChange(currentPage - 1)}
                                  disabled={currentPage === 1}
                                  aria-label="Previous page"
                                  className="relative inline-flex items-center rounded-l-lg px-2 min-h-9 text-muted border border-foam-deep hover:bg-foam disabled:opacity-50 focus:z-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
                                >
                                  <ChevronLeft className="h-4 w-4" aria-hidden />
                                </button>
                                {[...Array(totalPages)].map((_, index) => (
                                  <button
                                    key={index + 1}
                                    type="button"
                                    onClick={() => handlePageChange(index + 1)}
                                    aria-current={currentPage === index + 1 ? 'page' : undefined}
                                    className={`relative inline-flex items-center px-3.5 min-h-9 text-sm font-medium tabular-nums border focus:z-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-lake ${
                                      currentPage === index + 1
                                        ? 'z-10 border-lake bg-lake-soft text-lake'
                                        : 'border-foam-deep text-chart-ink hover:bg-foam'
                                    }`}
                                  >
                                    {index + 1}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => handlePageChange(currentPage + 1)}
                                  disabled={currentPage === totalPages}
                                  aria-label="Next page"
                                  className="relative inline-flex items-center rounded-r-lg px-2 min-h-9 text-muted border border-foam-deep hover:bg-foam disabled:opacity-50 focus:z-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
                                >
                                  <ChevronRight className="h-4 w-4" aria-hidden />
                                </button>
                              </nav>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Feed Suppliers Card */}
            <div className="lg:col-span-1">
              <div className="page-card-sm mb-6">
                <div className="px-4 sm:px-6 py-4 border-b border-foam-deep">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-medium text-chart-ink">Feed suppliers</h2>
                    <div className="flex items-center gap-2">
                      <Link
                        href="/feed-suppliers"
                        className="text-sm text-lake hover:underline"
                      >
                        View all
                      </Link>
                      <Button size="sm" variant="secondary" onClick={() => setShowAddSupplierModal(true)}>
                        <Plus className="h-4 w-4" aria-hidden />
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="p-4 sm:p-6">
                  <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                    {suppliers.map((supplier) => (
                      <div key={supplier.id} className="p-4 bg-foam border border-foam-deep rounded-lg">
                        <div className="flex justify-between items-start gap-3">
                          <div>
                            <h3 className="text-sm font-medium text-chart-ink">{supplier.name}</h3>
                            <p className="text-xs text-muted mt-1">{supplier.contact_person}</p>
                            <p className="text-xs text-muted">{supplier.phone}</p>
                          </div>
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            supplier.active ? 'bg-kelp/15 text-kelp' : 'bg-signal/15 text-signal'
                          }`}>
                            {supplier.active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recently Used Feed Card */}
              <div className="page-card-sm">
                <div className="px-4 sm:px-6 py-4 border-b border-foam-deep">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-medium text-chart-ink">Recently used feed</h2>
                    <Link
                      href="/feed-types"
                      className="text-sm text-lake hover:underline"
                    >
                      View all
                    </Link>
                  </div>
                </div>
                <div className="p-4 sm:p-6">
                  <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                    {feedTypes
                      .filter(type => type.active)
                      .slice(0, 5)
                      .map((type) => (
                        <div key={type.id} className="p-4 bg-foam border border-foam-deep rounded-lg">
                          <div className="flex justify-between items-start gap-3">
                            <div>
                              <h3 className="text-sm font-medium text-chart-ink">{type.name}</h3>
                              <p className="text-xs text-muted mt-1 tabular-nums">
                                {type.protein_percentage != null &&
                                type.protein_percentage !== ''
                                  ? `${type.protein_percentage}% protein`
                                  : 'Protein —'}
                                {' · '}
                                {Number(type.bag_size_kg || type.bagSizeKg || 25)}
                                Kg bags
                                {' · '}
                                {formatCurrency(type.price_per_kg)}/kg
                              </p>
                              <p className="text-xs text-muted mt-1">
                                Last used 2 hours ago
                              </p>
                            </div>
                            <span className="px-2 py-1 text-xs font-medium rounded-full bg-kelp/15 text-kelp">
                              Active
                            </span>
                          </div>
                        </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Add/Edit Feed Type Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-backdrop">
            <div className="page-card-xl max-w-md w-full max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true">
              <div className="px-4 sm:px-6 py-4 border-b border-foam-deep">
                <h3 className="text-lg font-medium text-chart-ink">
                  {editingType ? 'Edit feed type' : 'Add feed type'}
                </h3>
              </div>
              <form onSubmit={handleSubmit} className="p-4 sm:p-6">
                <div className="space-y-4">
                  <Field label="Name" htmlFor="fm-type-name">
                    <Input
                      id="fm-type-name"
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      required
                    />
                  </Field>
                  <Field label="Protein content (%)" htmlFor="fm-type-protein-content">
                    <Input
                      id="fm-type-protein-content"
                      type="number"
                      name="protein_content"
                      value={formData.protein_content}
                      onChange={handleChange}
                      required
                    />
                  </Field>
                  <Field label="Price per kg (₵)" htmlFor="fm-type-price-per-kg">
                    <Input
                      id="fm-type-price-per-kg"
                      type="number"
                      name="price_per_kg"
                      value={formData.price_per_kg}
                      onChange={handleChange}
                      step="0.01"
                      required
                    />
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Minimum stock (kg)" htmlFor="fm-type-minimum-stock">
                      <Input
                        id="fm-type-minimum-stock"
                        type="number"
                        name="minimum_stock"
                        value={formData.minimum_stock}
                        onChange={handleChange}
                        step="1"
                        min="0"
                        placeholder="e.g. 500"
                        className="font-data tabular-nums"
                      />
                      <p className="mt-1 text-xs text-muted">
                        Alerts when stock ≤ this
                      </p>
                    </Field>
                    <Field label="Bag size (kg)" htmlFor="fm-type-bag-size-kg">
                      <Input
                        id="fm-type-bag-size-kg"
                        type="number"
                        name="bag_size_kg"
                        value={formData.bag_size_kg}
                        onChange={handleChange}
                        step="0.1"
                        min="0.1"
                        className="font-data tabular-nums"
                      />
                    </Field>
                  </div>
                  <Field label="Description" htmlFor="fm-type-description">
                    <Textarea
                      id="fm-type-description"
                      name="description"
                      value={formData.description}
                      onChange={handleChange}
                      rows="3"
                    />
                  </Field>
                </div>
                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  <Button variant="secondary" onClick={closeFeedModal}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    {editingType ? 'Save changes' : 'Add feed type'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Supplier Modal */}
        {showAddSupplierModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-backdrop">
            <div className="page-card-xl max-w-md w-full max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true">
              <div className="px-4 sm:px-6 py-4 border-b border-foam-deep">
                <h3 className="text-lg font-medium text-chart-ink">Add supplier</h3>
              </div>
              <form onSubmit={handleSupplierSubmit} className="p-4 sm:p-6">
                <div className="space-y-4">
                  <Field label="Company name" htmlFor="fm-supplier-name">
                    <Input
                      id="fm-supplier-name"
                      type="text"
                      name="name"
                      value={supplierFormData.name}
                      onChange={handleSupplierChange}
                      required
                    />
                  </Field>
                  <Field label="Contact person" htmlFor="fm-supplier-contact-person">
                    <Input
                      id="fm-supplier-contact-person"
                      type="text"
                      name="contact_person"
                      value={supplierFormData.contact_person}
                      onChange={handleSupplierChange}
                      required
                    />
                  </Field>
                  <Field label="Phone" htmlFor="fm-supplier-phone">
                    <Input
                      id="fm-supplier-phone"
                      type="tel"
                      name="phone"
                      value={supplierFormData.phone}
                      onChange={handleSupplierChange}
                      required
                    />
                  </Field>
                  <Field label="Email" htmlFor="fm-supplier-email">
                    <Input
                      id="fm-supplier-email"
                      type="email"
                      name="email"
                      value={supplierFormData.email}
                      onChange={handleSupplierChange}
                      required
                    />
                  </Field>
                  <Field label="Address" htmlFor="fm-supplier-address">
                    <Textarea
                      id="fm-supplier-address"
                      name="address"
                      value={supplierFormData.address}
                      onChange={handleSupplierChange}
                      rows="3"
                    />
                  </Field>
                </div>
                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  <Button variant="secondary" onClick={() => setShowAddSupplierModal(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    Add supplier
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        <FeedPurchaseModal
          open={showPurchaseModal}
          onClose={() => setShowPurchaseModal(false)}
          onSaved={refreshPageData}
          feedTypes={feedTypes}
          suppliers={suppliers}
          title="New feed purchase"
        />

        <ConfirmDeleteModal
          open={Boolean(deleteConfirm)}
          title="Delete feed type"
          message={
            <>
              Delete{' '}
              <span className="font-semibold text-chart-ink">
                {deleteConfirm?.name || 'this feed type'}
              </span>
              ? Purchases and usage history that reference it may be affected.
            </>
          }
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={handleDeleteFeedType}
        />
      </Layout>
    </ProtectedRoute>
  )
}

export default FeedManagement 