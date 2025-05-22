// pages/feed-types.js
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import {
  ArrowLeft,
  Plus,
  Edit,
  Trash,
  Check,
  X,
  Save,
  AlertCircle,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { useToast } from '../hooks/useToast'
import feedTypeService from '../lib/feedTypeService'
import { supabase } from '../lib/supabase'

export default function FeedTypesPage() {
  return (
    <ProtectedRoute>
      <FeedTypes />
    </ProtectedRoute>
  )
}

function FeedTypes() {
  const router = useRouter()
  const { showToast } = useToast()

  const [feedTypes, setFeedTypes] = useState([])
  const [loading, setLoading] = useState(true)
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
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [suppliers, setSuppliers] = useState([])

  // Fetch feed types on mount
  useEffect(() => {
    fetchFeedTypes()
    fetchSuppliers()
  }, [])

  const fetchFeedTypes = async () => {
    setLoading(true)
    try {
      const { data, error } = await feedTypeService.getAllFeedTypes()

      if (error) throw error

      setFeedTypes(data || [])
    } catch (error) {
      console.error('Error fetching feed types:', error)
      showToast('error', 'Failed to load feed types')
      setError('Failed to load feed types. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const fetchSuppliers = async () => {
    try {
      const { data, error } = await supabase
        .from('feed_suppliers')
        .select('id, name')
        .order('name')
      if (error) throw error
      setSuppliers(data || [])
    } catch (error) {
      showToast('error', 'Failed to load suppliers')
    }
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  const handleAddFeedType = () => {
    setFormData({
      name: '',
      price_per_kg: '0.00',
      protein_percentage: '',
      pellet_size: '',
      supplier_id: suppliers.length > 0 ? suppliers[0].id : '',
      active: true,
    })
    setError('')
    setSuccess('')
    setShowAddModal(true)
  }

  const handleEditFeedType = (feedType) => {
    setEditingType(feedType)
    setFormData({
      name: feedType.name,
      price_per_kg: feedType.price_per_kg
        ? feedType.price_per_kg.toString()
        : '0.00',
      protein_percentage: feedType.protein_percentage
        ? feedType.protein_percentage.toString()
        : '',
      pellet_size: feedType.pellet_size || '',
      supplier_id: feedType.supplier_id || (suppliers.length > 0 ? suppliers[0].id : ''),
      active: feedType.active,
    })
    setError('')
    setSuccess('')
    setShowEditModal(true)
  }

  const handleDeleteFeedType = async (id) => {
    try {
      const { error } = await feedTypeService.deleteFeedType(id)

      if (error) throw error

      showToast('success', 'Feed type deleted successfully')
      fetchFeedTypes()
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Error deleting feed type:', error)
      showToast('error', 'Failed to delete feed type')
      setError('Failed to delete feed type. It may be in use in records.')
    }
  }

  const handleSubmitAdd = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      if (!formData.name.trim()) {
        throw new Error('Feed type name is required')
      }
      if (!formData.supplier_id) {
        throw new Error('Supplier is required')
      }
      const feedTypeData = {
        name: formData.name.trim(),
        price_per_kg: parseFloat(formData.price_per_kg) || 0,
        protein_percentage: formData.protein_percentage
          ? parseFloat(formData.protein_percentage)
          : null,
        pellet_size: formData.pellet_size.trim() || null,
        supplier_id: formData.supplier_id,
        active: formData.active,
      }
      const { data, error } = await feedTypeService.createFeedType(feedTypeData)
      if (error) throw error
      setSuccess('Feed type created successfully')
      showToast('success', 'Feed type created successfully')
      setTimeout(() => {
        setShowAddModal(false)
        fetchFeedTypes()
      }, 1500)
    } catch (error) {
      setError(error.message)
    }
  }

  const handleSubmitEdit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      if (!editingType) return
      if (!formData.name.trim()) {
        throw new Error('Feed type name is required')
      }
      if (!formData.supplier_id) {
        throw new Error('Supplier is required')
      }
      const feedTypeData = {
        name: formData.name.trim(),
        price_per_kg: parseFloat(formData.price_per_kg) || 0,
        protein_percentage: formData.protein_percentage
          ? parseFloat(formData.protein_percentage)
          : null,
        pellet_size: formData.pellet_size.trim() || null,
        supplier_id: formData.supplier_id,
        active: formData.active,
      }
      const { data, error } = await feedTypeService.updateFeedType(
        editingType.id,
        feedTypeData,
      )
      if (error) throw error
      setSuccess('Feed type updated successfully')
      showToast('success', 'Feed type updated successfully')
      setTimeout(() => {
        setShowEditModal(false)
        fetchFeedTypes()
      }, 1500)
    } catch (error) {
      setError(error.message)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 font-montserrat">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Link
              href="/dashboard"
              className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              Feed Types Management
            </h1>
          </div>

          <button
            onClick={handleAddFeedType}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Feed Type
          </button>
        </div>

        <div className="mb-6">
          <p className="text-gray-600">
            Manage feed types used in your farm. Create, edit, or deactivate
            feed types as needed.
          </p>
        </div>

        {/* Feed Types Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="font-medium text-gray-700">Feed Types</h2>
          </div>

          {loading ? (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-3 text-gray-500">Loading feed types...</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Price / kg
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Supplier
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Status
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
                {feedTypes.length > 0 ? (
                  feedTypes.map((feedType) => (
                    <tr key={feedType.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {feedType.name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${feedType.price_per_kg?.toFixed(2) || '0.00'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {(() => {
                          const supplier = suppliers.find(s => s.id === feedType.supplier_id)
                          return supplier ? supplier.name : '-'
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            feedType.active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {feedType.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex space-x-3 justify-end">
                          <button
                            onClick={() => handleEditFeedType(feedType)}
                            className="text-indigo-600 hover:text-indigo-900"
                            title="Edit Feed Type"
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          {deleteConfirm === feedType.id ? (
                            <>
                              <button
                                onClick={() =>
                                  handleDeleteFeedType(feedType.id)
                                }
                                className="text-red-600 hover:text-red-800"
                                title="Confirm Delete"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="text-gray-600 hover:text-gray-800"
                                title="Cancel"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(feedType.id)}
                              className="text-red-600 hover:text-red-800"
                              title="Delete Feed Type"
                            >
                              <Trash className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan="6"
                      className="px-6 py-12 text-center text-gray-500"
                    >
                      No feed types found. Click "Add Feed Type" to create your
                      first feed type.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add Feed Type Modal */}
      {showAddModal && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowAddModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Add New Feed Type
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

            <form onSubmit={handleSubmitAdd} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Price per kg ($)
                </label>
                <input
                  type="number"
                  name="price_per_kg"
                  value={formData.price_per_kg}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Protein Percentage (%)
                </label>
                <input
                  type="number"
                  name="protein_percentage"
                  value={formData.protein_percentage}
                  onChange={handleChange}
                  step="0.1"
                  min="0"
                  max="100"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Pellet Size
                </label>
                <input
                  type="text"
                  name="pellet_size"
                  value={formData.pellet_size}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Supplier <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="supplier_id"
                    value={formData.supplier_id}
                    onChange={handleChange}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    required
                  >
                    <option value="">Select supplier</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="active"
                  name="active"
                  checked={formData.active}
                  onChange={handleChange}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label
                  htmlFor="active"
                  className="ml-2 block text-sm text-gray-900"
                >
                  Active
                </label>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  <Save className="w-4 h-4 mr-2 inline-block" />
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Feed Type Modal */}
      {showEditModal && editingType && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowEditModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Edit Feed Type
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Price per kg ($)
                </label>
                <input
                  type="number"
                  name="price_per_kg"
                  value={formData.price_per_kg}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Protein Percentage (%)
                </label>
                <input
                  type="number"
                  name="protein_percentage"
                  value={formData.protein_percentage}
                  onChange={handleChange}
                  step="0.1"
                  min="0"
                  max="100"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Pellet Size
                </label>
                <input
                  type="text"
                  name="pellet_size"
                  value={formData.pellet_size}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Supplier <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="supplier_id"
                    value={formData.supplier_id}
                    onChange={handleChange}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    required
                  >
                    <option value="">Select supplier</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="edit-active"
                  name="active"
                  checked={formData.active}
                  onChange={handleChange}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label
                  htmlFor="edit-active"
                  className="ml-2 block text-sm text-gray-900"
                >
                  Active
                </label>
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
                  <Save className="w-4 h-4 mr-2 inline-block" />
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
