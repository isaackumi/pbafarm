// pages/feed-suppliers.js
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
  Mail,
  Phone,
  MapPin,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { useToast } from '../components/Toast'
import { supplierService } from '../lib/supplierService'

export default function FeedSuppliersPage() {
  return (
    <ProtectedRoute>
      <FeedSuppliers />
    </ProtectedRoute>
  )
}


function FeedSuppliers() {
  const router = useRouter()
  const { showToast } = useToast()

  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    website: '',
  })
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Fetch suppliers on mount
  useEffect(() => {
    fetchSuppliers()
  }, [])

  const fetchSuppliers = async () => {
    setLoading(true)
    try {
      const { data, error } = await supplierService.getAllSuppliers()

      if (error) throw error

      setSuppliers(data || [])
    } catch (error) {
      console.error('Error fetching suppliers:', error)
      showToast('error', 'Failed to load suppliers')
      setError('Failed to load suppliers. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleAddSupplier = () => {
    setFormData({
      name: '',
      website: '',
    })
    setError('')
    setSuccess('')
    setShowAddModal(true)
  }

  const handleEditSupplier = (supplier) => {
    setEditingSupplier(supplier)
    setFormData({
      name: supplier.name,
      website: supplier.website || '',
    })
    setError('')
    setSuccess('')
    setShowEditModal(true)
  }

  const handleDeleteSupplier = async (id) => {
    try {
      const { success, error } = await supplierService.deleteSupplier(id)

      if (error) throw error

      showToast('success', 'Supplier deleted successfully')
      fetchSuppliers()
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Error deleting supplier:', error)
      showToast('error', error.message || 'Failed to delete supplier')
      setError(
        error.message ||
          'Failed to delete supplier. It may be in use in feed types.',
      )
    }
  }

  const handleSubmitAdd = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    try {
      if (!formData.name.trim()) {
        throw new Error('Supplier name is required')
      }
      const supplierData = {
        name: formData.name.trim(),
        website: formData.website.trim() || null,
      }
      const { data, error } = await supplierService.createSupplier(supplierData)
      if (error) throw error
      setSuccess('Supplier created successfully')
      showToast('success', 'Supplier created successfully')
      setTimeout(() => {
        setShowAddModal(false)
        fetchSuppliers()
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
      if (!editingSupplier) return
      if (!formData.name.trim()) {
        throw new Error('Supplier name is required')
      }
      const supplierData = {
        name: formData.name.trim(),
        website: formData.website.trim() || null,
      }
      const { data, error } = await supplierService.updateSupplier(
        editingSupplier.id,
        supplierData,
      )
      if (error) throw error
      setSuccess('Supplier updated successfully')
      showToast('success', 'Supplier updated successfully')
      setTimeout(() => {
        setShowEditModal(false)
        fetchSuppliers()
      }, 1500)
    } catch (error) {
      setError(error.message)
    }
  }

  return (
    <div className="min-h-screen bg-foam font-sans">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Link
              href="/dashboard"
              className="text-lagoon-800 hover:text-lagoon-950 flex items-center mr-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-chart-ink">Feed Suppliers</h1>
          </div>

          <button
            onClick={handleAddSupplier}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-lagoon-800 hover:bg-lagoon-950"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Supplier
          </button>
        </div>

        <div className="mb-6">
          <p className="text-muted">
            Manage feed suppliers for your farm. Add contact information and
            track all your feed vendors in one place.
          </p>
        </div>

        {/* Links to related pages */}
        <div className="mb-6 flex flex-wrap gap-2">
          <Link href="/feed-types">
            <button className="inline-flex items-center px-3 py-1.5 border border-input-border shadow-sm text-sm font-medium rounded-md text-chart-ink bg-white hover:bg-foam-deep/40">
              Manage Feed Types
            </button>
          </Link>
        </div>

        {/* Suppliers Grid */}
        <div className="page-card overflow-hidden">
          <div className="px-6 py-4 border-b border-foam-deep">
            <h2 className="font-medium text-chart-ink">Suppliers Directory</h2>
          </div>

          {loading ? (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lagoon-800 mx-auto"></div>
              <p className="mt-3 text-muted">Loading suppliers...</p>
            </div>
          ) : suppliers.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
              {suppliers.map((supplier) => (
                <div
                  key={supplier.id}
                  className="border border-foam-deep rounded-lg shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden"
                >
                  <div className="px-4 py-5 sm:px-6 bg-foam-deep/40 border-b border-foam-deep">
                    <h3 className="text-lg font-medium text-chart-ink truncate">
                      {supplier.name}
                    </h3>
                  </div>
                  <div className="px-4 py-4 sm:px-6">
                    <div className="space-y-2">
                      {supplier.website && (
                        <div className="flex items-start">
                          <Globe className="h-5 w-5 text-muted mr-2 mt-0.5" />
                          <a
                            href={supplier.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-lagoon-800 hover:text-lagoon-800"
                          >
                            {supplier.website.replace(/^https?:\/\//, '')}
                          </a>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 flex space-x-3 justify-end border-t border-foam-deep pt-3">
                      <button
                        onClick={() => handleEditSupplier(supplier)}
                        className="text-lagoon-800 hover:text-lagoon-950"
                        title="Edit Supplier"
                      >
                        <Edit className="w-4 h-4" />
                      </button>

                      {deleteConfirm === supplier.id ? (
                        <>
                          <button
                            onClick={() => handleDeleteSupplier(supplier.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Confirm Delete"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-muted hover:text-gray-800"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(supplier.id)}
                          className="text-red-600 hover:text-red-800"
                          title="Delete Supplier"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <AlertCircle className="h-12 w-12 text-muted mx-auto" />
              <p className="mt-3 text-muted">
                No suppliers found. Add your first supplier to get started.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add Supplier Modal */}
      {showAddModal && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowAddModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">
              Add New Supplier
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
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Company Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Website
                </label>
                <input
                  type="url"
                  name="website"
                  value={formData.website}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  placeholder="https://example.com"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-input-border rounded-md shadow-sm text-sm font-medium text-chart-ink bg-white hover:bg-foam-deep/40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-lagoon-800 hover:bg-lagoon-950"
                >
                  <Save className="w-4 h-4 mr-2 inline-block" />
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Supplier Modal */}
      {showEditModal && editingSupplier && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowEditModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">
              Edit Supplier
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
                  Company Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Website
                </label>
                <input
                  type="url"
                  name="website"
                  value={formData.website}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  placeholder="https://example.com"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
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
