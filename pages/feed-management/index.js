import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../../components/ProtectedRoute'
import { formatCurrency, formatNumber } from '../../lib/currencyUtils'
import Layout from '../../components/Layout'
import { PageHeader, Button } from '../../components/ui'
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
import { Plus, ArrowLeft, Download, Filter, Search, Utensils, Users, Database, LineChart, ChevronLeft, ChevronRight, ShoppingCart } from 'lucide-react'
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="page-card-sm p-6 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-foam-deep">
                  <Utensils className="h-6 w-6 text-lagoon-800" />
                </div>
                <div className="ml-4">
                  <h2 className="text-sm font-medium text-muted">Total Feed Types</h2>
                  <p className="text-2xl font-semibold text-chart-ink">
                    {loading ? '—' : formatNumber(activeFeedTypeCount, { decimals: 0 })}
                  </p>
                </div>
              </div>
            </div>

            <div className="page-card-sm p-6 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-green-50">
                  <Users className="h-6 w-6 text-green-600" />
                </div>
                <div className="ml-4">
                  <h2 className="text-sm font-medium text-muted">Active Suppliers</h2>
                  <p className="text-2xl font-semibold text-chart-ink">
                    {formatNumber(activeSupplierCount, { decimals: 0 })}
                  </p>
                </div>
              </div>
            </div>

            <div className="page-card-sm p-6 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-foam-deep">
                  <Database className="h-6 w-6 text-lagoon-800" />
                </div>
                <div className="ml-4">
                  <h2 className="text-sm font-medium text-muted">Total Feed Stock</h2>
                  <p className="text-2xl font-semibold text-chart-ink">
                    {loading ? '—' : `${formatNumber(totalStockKg, { decimals: 0 })} kg`}
                  </p>
                </div>
              </div>
            </div>

            <div className="page-card-sm p-6 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-purple-50">
                  <LineChart className="h-6 w-6 text-purple-600" />
                </div>
                <div className="ml-4">
                  <h2 className="text-sm font-medium text-muted">Monthly Usage</h2>
                  <p className="text-2xl font-semibold text-chart-ink">
                    {loading ? '—' : `${formatNumber(monthlyUsageKg, { decimals: 0 })} kg`}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Feed Types Card */}
            <div className="lg:col-span-2">
              <div className="page-card-sm border border-gray-100">
                <div className="px-6 py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-chart-ink">Feed Types</h2>
                    <div className="flex space-x-3">
                      <button
                        onClick={handleAddFeedType}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-lagoon-800 hover:bg-lagoon-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Feed Type
                      </button>
                      <button
                        onClick={() => setShowPurchaseModal(true)}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                      >
                        <ShoppingCart className="h-4 w-4 mr-2" />
                        Feed Purchase
                      </button>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  {/* Filters */}
                  <div className="mb-6 flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Search feed types..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="block w-full pl-10 pr-3 py-2 border border-input-border rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                        />
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Search className="h-5 w-5 text-muted" />
                        </div>
                      </div>
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="block w-full pl-3 pr-10 py-2 text-base border border-input-border focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm rounded-md"
                      >
                        <option value="all">All Status</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>

                  {loading ? (
                    <div className="flex justify-center items-center h-32">
                      <div className="w-8 h-8 border-4 border-lagoon-800 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  ) : error ? (
                    <div className="text-center text-red-600">{error}</div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-foam-deep">
                          <thead className="bg-foam-deep/40">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Name</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Protein %</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Price/kg</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-foam-deep">
                            {currentItems.map((type) => (
                              <tr key={type.id} className="hover:bg-foam-deep/40">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-chart-ink">{type.name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                                  {type.protein_percentage != null && type.protein_percentage !== ''
                                    ? `${type.protein_percentage}%`
                                    : '—'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">{formatCurrency(type.price_per_kg)}</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <button
                                    onClick={() => handleStatusChange(type.id, !type.active)}
                                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full cursor-pointer ${
                                      type.active ? 'bg-kelp/15 text-kelp' : 'bg-signal/15 text-signal'
                                    }`}
                                  >
                                    {type.active ? 'Active' : 'Inactive'}
                                  </button>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                  <button
                                    onClick={() => handleEditFeedType(type)}
                                    className="text-lagoon-800 hover:text-lagoon-950 mr-4"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeleteConfirm(type)}
                                    className="text-red-600 hover:text-red-900"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-foam-deep bg-white px-4 py-3 sm:px-6 mt-4">
                          <div className="flex flex-1 justify-between sm:hidden">
                            <button
                              onClick={() => handlePageChange(currentPage - 1)}
                              disabled={currentPage === 1}
                              className="relative inline-flex items-center rounded-md border border-input-border bg-white px-4 py-2 text-sm font-medium text-chart-ink hover:bg-foam-deep/40"
                            >
                              Previous
                            </button>
                            <button
                              onClick={() => handlePageChange(currentPage + 1)}
                              disabled={currentPage === totalPages}
                              className="relative ml-3 inline-flex items-center rounded-md border border-input-border bg-white px-4 py-2 text-sm font-medium text-chart-ink hover:bg-foam-deep/40"
                            >
                              Next
                            </button>
                          </div>
                          <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm text-chart-ink">
                                Showing <span className="font-medium">{indexOfFirstItem + 1}</span> to{' '}
                                <span className="font-medium">
                                  {Math.min(indexOfLastItem, filteredFeedTypes.length)}
                                </span>{' '}
                                of <span className="font-medium">{filteredFeedTypes.length}</span> results
                              </p>
                            </div>
                            <div>
                              <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                                <button
                                  onClick={() => handlePageChange(currentPage - 1)}
                                  disabled={currentPage === 1}
                                  className="relative inline-flex items-center rounded-l-md px-2 py-2 text-muted ring-1 ring-inset ring-gray-300 hover:bg-foam-deep/40 focus:z-20 focus:outline-offset-0"
                                >
                                  <ChevronLeft className="h-5 w-5" />
                                </button>
                                {[...Array(totalPages)].map((_, index) => (
                                  <button
                                    key={index + 1}
                                    onClick={() => handlePageChange(index + 1)}
                                    className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ${
                                      currentPage === index + 1
                                        ? 'z-10 bg-lagoon-800 text-white focus:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lagoon-800'
                                        : 'text-chart-ink ring-1 ring-inset ring-gray-300 hover:bg-foam-deep/40 focus:z-20 focus:outline-offset-0'
                                    }`}
                                  >
                                    {index + 1}
                                  </button>
                                ))}
                                <button
                                  onClick={() => handlePageChange(currentPage + 1)}
                                  disabled={currentPage === totalPages}
                                  className="relative inline-flex items-center rounded-r-md px-2 py-2 text-muted ring-1 ring-inset ring-gray-300 hover:bg-foam-deep/40 focus:z-20 focus:outline-offset-0"
                                >
                                  <ChevronRight className="h-5 w-5" />
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
              <div className="page-card-sm border border-gray-100 mb-6">
                <div className="px-6 py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-chart-ink">Feed Suppliers</h2>
                    <div className="flex items-center space-x-2">
                      <Link
                        href="/feed-suppliers"
                        className="text-sm text-lagoon-800 hover:text-lagoon-950"
                      >
                        View All
                      </Link>
                      <button
                        onClick={() => setShowAddSupplierModal(true)}
                        className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-lagoon-800 hover:bg-lagoon-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </button>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                    {suppliers.map((supplier) => (
                      <div key={supplier.id} className="p-4 bg-foam-deep/40 rounded-lg">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="text-sm font-medium text-chart-ink">{supplier.name}</h3>
                            <p className="text-xs text-muted mt-1">{supplier.contact_person}</p>
                            <p className="text-xs text-muted">{supplier.phone}</p>
                          </div>
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
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
              <div className="page-card-sm border border-gray-100">
                <div className="px-6 py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-chart-ink">Recently Used Feed</h2>
                    <Link
                      href="/feed-types"
                      className="text-sm text-lagoon-800 hover:text-lagoon-950"
                    >
                      View All
                    </Link>
                  </div>
                </div>
                <div className="p-6">
                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                    {feedTypes
                      .filter(type => type.active)
                      .slice(0, 5)
                      .map((type) => (
                        <div key={type.id} className="p-4 bg-foam-deep/40 rounded-lg">
                          <div className="flex justify-between items-start">
                            <div>
                              <h3 className="text-sm font-medium text-chart-ink">{type.name}</h3>
                              <p className="text-xs text-muted mt-1">
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
                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-kelp/15 text-kelp">
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
            <div className="page-card-xl max-w-md w-full">
              <div className="px-6 py-4 border-b border-foam-deep">
                <h3 className="text-lg font-medium text-chart-ink">
                  {editingType ? 'Edit Feed Type' : 'Add New Feed Type'}
                </h3>
              </div>
              <form onSubmit={handleSubmit} className="p-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-chart-ink">Name</label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      className="mt-1 block w-full border border-input-border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-chart-ink">Protein Content (%)</label>
                    <input
                      type="number"
                      name="protein_content"
                      value={formData.protein_content}
                      onChange={handleChange}
                      className="mt-1 block w-full border border-input-border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-chart-ink">Price per kg (₵)</label>
                    <input
                      type="number"
                      name="price_per_kg"
                      value={formData.price_per_kg}
                      onChange={handleChange}
                      step="0.01"
                      className="mt-1 block w-full border border-input-border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-chart-ink">
                        Minimum stock (kg)
                      </label>
                      <input
                        type="number"
                        name="minimum_stock"
                        value={formData.minimum_stock}
                        onChange={handleChange}
                        step="1"
                        min="0"
                        placeholder="e.g. 500"
                        className="mt-1 block w-full border border-input-border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm font-data"
                      />
                      <p className="mt-1 text-xs text-muted">
                        Alerts when stock ≤ this
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-chart-ink">
                        Bag size (kg)
                      </label>
                      <input
                        type="number"
                        name="bag_size_kg"
                        value={formData.bag_size_kg}
                        onChange={handleChange}
                        step="0.1"
                        min="0.1"
                        className="mt-1 block w-full border border-input-border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm font-data"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-chart-ink">Description</label>
                    <textarea
                      name="description"
                      value={formData.description}
                      onChange={handleChange}
                      rows="3"
                      className="mt-1 block w-full border border-input-border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={closeFeedModal}
                    className="px-4 py-2 border border-input-border rounded-md shadow-sm text-sm font-medium text-chart-ink bg-white hover:bg-foam-deep/40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-lagoon-800 hover:bg-lagoon-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800"
                  >
                    {editingType ? 'Update' : 'Add'} Feed Type
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Supplier Modal */}
        {showAddSupplierModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-backdrop">
            <div className="page-card-xl max-w-md w-full">
              <div className="px-6 py-4 border-b border-foam-deep">
                <h3 className="text-lg font-medium text-chart-ink">Add New Supplier</h3>
              </div>
              <form onSubmit={handleSupplierSubmit} className="p-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-chart-ink">Company Name</label>
                    <input
                      type="text"
                      name="name"
                      value={supplierFormData.name}
                      onChange={handleSupplierChange}
                      className="mt-1 block w-full border border-input-border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-chart-ink">Contact Person</label>
                    <input
                      type="text"
                      name="contact_person"
                      value={supplierFormData.contact_person}
                      onChange={handleSupplierChange}
                      className="mt-1 block w-full border border-input-border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-chart-ink">Phone</label>
                    <input
                      type="tel"
                      name="phone"
                      value={supplierFormData.phone}
                      onChange={handleSupplierChange}
                      className="mt-1 block w-full border border-input-border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-chart-ink">Email</label>
                    <input
                      type="email"
                      name="email"
                      value={supplierFormData.email}
                      onChange={handleSupplierChange}
                      className="mt-1 block w-full border border-input-border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-chart-ink">Address</label>
                    <textarea
                      name="address"
                      value={supplierFormData.address}
                      onChange={handleSupplierChange}
                      rows="3"
                      className="mt-1 block w-full border border-input-border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowAddSupplierModal(false)}
                    className="px-4 py-2 border border-input-border rounded-md shadow-sm text-sm font-medium text-chart-ink bg-white hover:bg-foam-deep/40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-lagoon-800 hover:bg-lagoon-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800"
                  >
                    Add Supplier
                  </button>
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
          title="New Feed Purchase"
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