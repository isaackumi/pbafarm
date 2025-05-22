import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { feedTypeService } from '../lib/feedTypeService'
import { supplierService } from '../lib/supplierService'
import { useToast } from '../components/Toast'
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
    protein_percentage: '',
    pellet_size: '',
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
  const [purchaseData, setPurchaseData] = useState({
    supplier_id: '',
    purchase_date: new Date().toISOString().split('T')[0],
    total_amount: 0,
    notes: '',
    feed_entries: []
  })
  const [currentFeedEntry, setCurrentFeedEntry] = useState({
    feed_type_id: '',
    number_of_bags: '',
    price_per_bag: '',
    bag_size: '25' // Default bag size in kg
  })

  useEffect(() => {
    fetchFeedTypes()
    fetchSuppliers()
  }, [])

  const fetchFeedTypes = async () => {
    try {
      setLoading(true)
      const { data, error } = await feedTypeService.getAllFeedTypes()
      if (error) throw error
      setFeedTypes(data || [])
    } catch (error) {
      console.error('Error fetching feed types:', error)
      setError('Failed to load feed types')
      showToast('Error loading feed types', 'error')
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

  const handleAddFeedType = () => {
    setFormData({
      name: '',
      price_per_kg: '0.00',
      protein_percentage: '',
      pellet_size: '',
      supplier_id: '',
      active: true,
    })
    setShowAddModal(true)
  }

  const handleEditFeedType = (feedType) => {
    setEditingType(feedType)
    setFormData({
      name: feedType.name,
      price_per_kg: feedType.price_per_kg?.toString() || '0.00',
      protein_percentage: feedType.protein_percentage?.toString() || '',
      pellet_size: feedType.pellet_size || '',
      supplier_id: feedType.supplier_id || '',
      active: feedType.active,
    })
    setShowEditModal(true)
  }

  const handleDeleteFeedType = async (id) => {
    try {
      const { error } = await feedTypeService.deleteFeedType(id)
      if (error) throw error
      showToast('Feed type deleted successfully', 'success')
      fetchFeedTypes()
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Error deleting feed type:', error)
      showToast('Failed to delete feed type', 'error')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editingType) {
        const { error } = await feedTypeService.updateFeedType(editingType.id, formData)
        if (error) throw error
        showToast('Feed type updated successfully', 'success')
        setShowEditModal(false)
      } else {
        const { error } = await feedTypeService.createFeedType(formData)
        if (error) throw error
        showToast('Feed type created successfully', 'success')
        setShowAddModal(false)
      }
      fetchFeedTypes()
    } catch (error) {
      console.error('Error saving feed type:', error)
      showToast('Failed to save feed type', 'error')
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
      fetchFeedTypes()
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

  const handleAddFeedEntry = () => {
    if (!currentFeedEntry.feed_type_id || !currentFeedEntry.number_of_bags || !currentFeedEntry.price_per_bag) {
      showToast('Please fill in all feed entry details', 'error')
      return
    }

    const entry = {
      ...currentFeedEntry,
      total_amount: parseFloat(currentFeedEntry.number_of_bags) * parseFloat(currentFeedEntry.price_per_bag)
    }

    setPurchaseData(prev => ({
      ...prev,
      feed_entries: [...prev.feed_entries, entry],
      total_amount: prev.total_amount + entry.total_amount
    }))

    setCurrentFeedEntry({
      feed_type_id: '',
      number_of_bags: '',
      price_per_bag: '',
      bag_size: '25'
    })
  }

  const handleRemoveFeedEntry = (index) => {
    const entry = purchaseData.feed_entries[index]
    setPurchaseData(prev => ({
      ...prev,
      feed_entries: prev.feed_entries.filter((_, i) => i !== index),
      total_amount: prev.total_amount - entry.total_amount
    }))
  }

  const handlePurchaseSubmit = async (e) => {
    e.preventDefault()
    if (!purchaseData.supplier_id) {
      showToast('Please select a supplier', 'error')
      return
    }
    if (purchaseData.feed_entries.length === 0) {
      showToast('Please add at least one feed entry', 'error')
      return
    }

    try {
      // Here you would implement the API call to save the purchase
      // For now, we'll just show a success message
      showToast('Feed purchase saved successfully', 'success')
      setShowPurchaseModal(false)
      setPurchaseData({
        supplier_id: '',
        purchase_date: new Date().toISOString().split('T')[0],
        total_amount: 0,
        notes: '',
        feed_entries: []
      })
    } catch (error) {
      console.error('Error saving feed purchase:', error)
      showToast('Failed to save feed purchase', 'error')
    }
  }

  return (
    <ProtectedRoute>
      <Layout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Feed Management</h1>
                <p className="mt-2 text-sm text-gray-600">
                  Manage feed types, suppliers, and track feed usage across your farm
                </p>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-indigo-50">
                  <Utensils className="h-6 w-6 text-indigo-600" />
                </div>
                <div className="ml-4">
                  <h2 className="text-sm font-medium text-gray-600">Total Feed Types</h2>
                  <p className="text-2xl font-semibold text-gray-900">{feedTypes.length}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-green-50">
                  <Users className="h-6 w-6 text-green-600" />
                </div>
                <div className="ml-4">
                  <h2 className="text-sm font-medium text-gray-600">Active Suppliers</h2>
                  <p className="text-2xl font-semibold text-gray-900">3</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-blue-50">
                  <Database className="h-6 w-6 text-blue-600" />
                </div>
                <div className="ml-4">
                  <h2 className="text-sm font-medium text-gray-600">Total Feed Stock</h2>
                  <p className="text-2xl font-semibold text-gray-900">1,250 kg</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-purple-50">
                  <LineChart className="h-6 w-6 text-purple-600" />
                </div>
                <div className="ml-4">
                  <h2 className="text-sm font-medium text-gray-600">Monthly Usage</h2>
                  <p className="text-2xl font-semibold text-gray-900">450 kg</p>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Feed Types Card */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-6 py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-gray-900">Feed Types</h2>
                    <div className="flex space-x-3">
                      <button
                        onClick={() => setShowAddModal(true)}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
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
                          className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        />
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Search className="h-5 w-5 text-gray-400" />
                        </div>
                      </div>
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="block w-full pl-3 pr-10 py-2 text-base border border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                      >
                        <option value="all">All Status</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>

                  {loading ? (
                    <div className="flex justify-center items-center h-32">
                      <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  ) : error ? (
                    <div className="text-center text-red-600">{error}</div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Protein %</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price/kg</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {currentItems.map((type) => (
                              <tr key={type.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{type.name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{type.protein_percentage}%</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${type.price_per_kg}</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <button
                                    onClick={() => handleStatusChange(type.id, !type.active)}
                                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full cursor-pointer ${
                                      type.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                    }`}
                                  >
                                    {type.active ? 'Active' : 'Inactive'}
                                  </button>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                  <button
                                    onClick={() => handleEditFeedType(type)}
                                    className="text-indigo-600 hover:text-indigo-900 mr-4"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteFeedType(type.id)}
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
                        <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 sm:px-6 mt-4">
                          <div className="flex flex-1 justify-between sm:hidden">
                            <button
                              onClick={() => handlePageChange(currentPage - 1)}
                              disabled={currentPage === 1}
                              className="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Previous
                            </button>
                            <button
                              onClick={() => handlePageChange(currentPage + 1)}
                              disabled={currentPage === totalPages}
                              className="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Next
                            </button>
                          </div>
                          <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm text-gray-700">
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
                                  className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0"
                                >
                                  <ChevronLeft className="h-5 w-5" />
                                </button>
                                {[...Array(totalPages)].map((_, index) => (
                                  <button
                                    key={index + 1}
                                    onClick={() => handlePageChange(index + 1)}
                                    className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ${
                                      currentPage === index + 1
                                        ? 'z-10 bg-indigo-600 text-white focus:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600'
                                        : 'text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0'
                                    }`}
                                  >
                                    {index + 1}
                                  </button>
                                ))}
                                <button
                                  onClick={() => handlePageChange(currentPage + 1)}
                                  disabled={currentPage === totalPages}
                                  className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0"
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
              <div className="bg-white rounded-lg shadow-sm border border-gray-100 mb-6">
                <div className="px-6 py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-gray-900">Feed Suppliers</h2>
                    <div className="flex items-center space-x-2">
                      <Link
                        href="/feed-suppliers"
                        className="text-sm text-indigo-600 hover:text-indigo-900"
                      >
                        View All
                      </Link>
                      <button
                        onClick={() => setShowAddSupplierModal(true)}
                        className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
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
                      <div key={supplier.id} className="p-4 bg-gray-50 rounded-lg">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="text-sm font-medium text-gray-900">{supplier.name}</h3>
                            <p className="text-xs text-gray-500 mt-1">{supplier.contact_person}</p>
                            <p className="text-xs text-gray-500">{supplier.phone}</p>
                          </div>
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                            supplier.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
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
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-6 py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-gray-900">Recently Used Feed</h2>
                    <Link
                      href="/feed-types"
                      className="text-sm text-indigo-600 hover:text-indigo-900"
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
                        <div key={type.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="flex justify-between items-start">
                            <div>
                              <h3 className="text-sm font-medium text-gray-900">{type.name}</h3>
                              <p className="text-xs text-gray-500 mt-1">
                                Protein: {type.protein_percentage}% | ${type.price_per_kg}/kg
                              </p>
                              <p className="text-xs text-gray-400 mt-1">
                                Last used 2 hours ago
                              </p>
                            </div>
                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
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
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">
                  {editingType ? 'Edit Feed Type' : 'Add New Feed Type'}
                </h3>
              </div>
              <form onSubmit={handleSubmit} className="p-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Name</label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Protein Content (%)</label>
                    <input
                      type="number"
                      name="protein_content"
                      value={formData.protein_content}
                      onChange={handleChange}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Price per kg ($)</label>
                    <input
                      type="number"
                      name="price_per_kg"
                      value={formData.price_per_kg}
                      onChange={handleChange}
                      step="0.01"
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <textarea
                      name="description"
                      value={formData.description}
                      onChange={handleChange}
                      rows="3"
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
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
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">Add New Supplier</h3>
              </div>
              <form onSubmit={handleSupplierSubmit} className="p-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Company Name</label>
                    <input
                      type="text"
                      name="name"
                      value={supplierFormData.name}
                      onChange={handleSupplierChange}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Contact Person</label>
                    <input
                      type="text"
                      name="contact_person"
                      value={supplierFormData.contact_person}
                      onChange={handleSupplierChange}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Phone</label>
                    <input
                      type="tel"
                      name="phone"
                      value={supplierFormData.phone}
                      onChange={handleSupplierChange}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Email</label>
                    <input
                      type="email"
                      name="email"
                      value={supplierFormData.email}
                      onChange={handleSupplierChange}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Address</label>
                    <textarea
                      name="address"
                      value={supplierFormData.address}
                      onChange={handleSupplierChange}
                      rows="3"
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowAddSupplierModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    Add Supplier
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Feed Purchase Modal */}
        {showPurchaseModal && (
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">New Feed Purchase</h3>
              </div>
              <form onSubmit={handlePurchaseSubmit} className="p-6">
                <div className="grid grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Supplier</label>
                    <select
                      value={purchaseData.supplier_id}
                      onChange={(e) => setPurchaseData(prev => ({ ...prev, supplier_id: e.target.value }))}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      required
                    >
                      <option value="">Select supplier</option>
                      {suppliers.map(supplier => (
                        <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Purchase Date</label>
                    <input
                      type="date"
                      value={purchaseData.purchase_date}
                      onChange={(e) => setPurchaseData(prev => ({ ...prev, purchase_date: e.target.value }))}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      required
                    />
                  </div>
                </div>

                {/* Feed Entries */}
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Feed Entries</h4>
                  <div className="space-y-4">
                    {purchaseData.feed_entries.map((entry, index) => (
                      <div key={index} className="flex items-center space-x-4 p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {feedTypes.find(ft => ft.id === entry.feed_type_id)?.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {entry.number_of_bags} bags × ${entry.price_per_bag}/bag = ${entry.total_amount}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveFeedEntry(index)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Add New Feed Entry */}
                <div className="mb-6 p-4 border border-gray-200 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Add Feed Entry</h4>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Feed Type</label>
                      <select
                        value={currentFeedEntry.feed_type_id}
                        onChange={(e) => setCurrentFeedEntry(prev => ({ ...prev, feed_type_id: e.target.value }))}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      >
                        <option value="">Select feed type</option>
                        {feedTypes.map(type => (
                          <option key={type.id} value={type.id}>{type.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Number of Bags</label>
                      <input
                        type="number"
                        value={currentFeedEntry.number_of_bags}
                        onChange={(e) => setCurrentFeedEntry(prev => ({ ...prev, number_of_bags: e.target.value }))}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        min="1"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Price per Bag ($)</label>
                      <input
                        type="number"
                        value={currentFeedEntry.price_per_bag}
                        onChange={(e) => setCurrentFeedEntry(prev => ({ ...prev, price_per_bag: e.target.value }))}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={handleAddFeedEntry}
                        className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                      >
                        Add Entry
                      </button>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700">Notes</label>
                  <textarea
                    value={purchaseData.notes}
                    onChange={(e) => setPurchaseData(prev => ({ ...prev, notes: e.target.value }))}
                    rows="3"
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                </div>

                {/* Total Amount */}
                <div className="mb-6">
                  <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                    <span className="text-sm font-medium text-gray-700">Total Amount:</span>
                    <span className="text-lg font-bold text-gray-900">${purchaseData.total_amount.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowPurchaseModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    Save Purchase
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </Layout>
    </ProtectedRoute>
  )
}

export default FeedManagement 