// pages/feed-types.js
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import {
  Plus,
  Edit,
  Trash,
  Save,
  AlertCircle,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader } from '../components/ui'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { useToast } from '../components/Toast'
import { useSelector, useDispatch } from 'react-redux'
import { supplierService } from '../lib/supplierService'
import {
  buildFeedTypeDescription,
  normalizeBagSizeKg,
} from '../lib/feedTypeMeta'
import {
  fetchFeedTypes,
  createFeedType,
  updateFeedType,
  deleteFeedType,
  clearFeedError
} from '../store/slices/feedSlice'
import { useCurrency } from '../hooks/useCurrency'

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
  const dispatch = useDispatch()
  const { pricePerKgLabel: priceLabel, formatCurrency: fmt } = useCurrency()
  const { feedTypes, loading, error } = useSelector(state => state.feed)

  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingType, setEditingType] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    price_per_kg: '0.00',
    protein_percentage: '',
    pellet_size: '',
    minimum_stock: '',
    bag_size_kg: '20',
    supplier_id: '',
    active: true,
  })
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [suppliers, setSuppliers] = useState([])

  // Fetch feed types and suppliers on mount
  useEffect(() => {
    dispatch(fetchFeedTypes())
    fetchSuppliers()
  }, [dispatch])

  useEffect(() => {
    if (error) {
      showToast('error', error)
      dispatch(clearFeedError())
    }
  }, [error, showToast, dispatch])

  const fetchSuppliers = async () => {
    try {
      const { data, error } = await supplierService.getAllSuppliers()
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

  const handleAdd = async (e) => {
    e?.preventDefault?.()
    try {
      if (!formData.name.trim()) {
        showToast('error', 'Name is required')
        return
      }
      const bag_size_kg = normalizeBagSizeKg(formData.bag_size_kg)
      const payload = {
        name: formData.name.trim(),
        description: buildFeedTypeDescription({
          protein_percentage: formData.protein_percentage,
          pellet_size: formData.pellet_size,
          bag_size_kg,
        }),
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
      const result = await dispatch(createFeedType(payload))
      if (createFeedType.rejected.match(result)) {
        showToast('error', result.payload || 'Failed to create feed type')
        return
      }
      showToast('success', 'Feed type created')
      setShowAddModal(false)
      setFormData({
        name: '',
        price_per_kg: '0.00',
        protein_percentage: '',
        pellet_size: '',
        minimum_stock: '',
        bag_size_kg: '20',
        supplier_id: '',
        active: true,
      })
    } catch (err) {
      showToast('error', err.message || 'Failed to create feed type')
    }
  }

  const handleEdit = (type) => {
    setEditingType(type)
    setFormData({
      name: type.name,
      price_per_kg: type.price_per_kg?.toString() || '0.00',
      protein_percentage: type.protein_percentage?.toString() || '',
      pellet_size: type.pellet_size || '',
      minimum_stock:
        type.minimum_stock != null && type.minimum_stock !== ''
          ? String(type.minimum_stock)
          : '',
      bag_size_kg: String(
        type.bag_size_kg || type.bagSizeKg || 20,
      ),
      supplier_id: type.supplier_id || '',
      active: type.active,
    })
    setShowEditModal(true)
  }

  const handleUpdate = async (e) => {
    e?.preventDefault?.()
    try {
      if (!formData.name.trim()) {
        showToast('error', 'Name is required')
        return
      }
      const bag_size_kg = normalizeBagSizeKg(formData.bag_size_kg)
      const updates = {
        name: formData.name.trim(),
        description: buildFeedTypeDescription({
          protein_percentage: formData.protein_percentage,
          pellet_size: formData.pellet_size,
          bag_size_kg,
        }),
        price_per_kg: formData.price_per_kg,
        minimum_stock:
          formData.minimum_stock !== ''
            ? Number(formData.minimum_stock)
            : 0,
        bag_size_kg,
        supplier_id: formData.supplier_id || undefined,
        active: formData.active !== false,
      }
      const result = await dispatch(
        updateFeedType({ id: editingType.id, updates }),
      )
      if (updateFeedType.rejected.match(result)) {
        showToast('error', result.payload || 'Failed to update feed type')
        return
      }
      showToast('success', 'Feed type updated')
      setShowEditModal(false)
      setEditingType(null)
      setFormData({
        name: '',
        price_per_kg: '0.00',
        protein_percentage: '',
        pellet_size: '',
        minimum_stock: '',
        bag_size_kg: '20',
        supplier_id: '',
        active: true,
      })
    } catch (err) {
      showToast('error', err.message || 'Failed to update feed type')
    }
  }

  const handleDelete = async () => {
    const id = deleteConfirm?.id || deleteConfirm?._id
    if (!id) return
    await dispatch(deleteFeedType(id))
    setDeleteConfirm(null)
  }

  return (
    <Layout title="Feed Types">
      <div data-tour="page-feed-types">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Feed', href: '/feed-management/overview' },
          { label: 'Feed types' },
        ]}
        description="Manage feed types used on your farm. Create, edit, or deactivate as needed."
        related={[
          { label: 'Feed suppliers', href: '/feed-suppliers' },
          { label: 'Feed purchases', href: '/feed-purchases' },
          { label: 'Stock levels', href: '/stock-levels' },
        ]}
        actions={
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center px-3 py-2 text-sm font-semibold rounded-xl text-white bg-lagoon-950 hover:bg-lagoon-800 min-h-10"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Feed Type
          </button>
        }
      />

        {/* Feed Types Table */}
        <div className="page-card overflow-hidden">
          <div className="px-6 py-4 border-b border-foam-deep">
            <h2 className="font-medium text-chart-ink">Feed Types</h2>
          </div>

          {loading ? (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lagoon-800 mx-auto"></div>
              <p className="mt-3 text-muted">Loading feed types...</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-foam-deep">
              <thead className="bg-foam-deep/40">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                  >
                    Price / kg
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                  >
                    Supplier
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                  >
                    Status
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
                {feedTypes.length > 0 ? (
                  feedTypes.map((type) => (
                    <tr key={type.id} className="hover:bg-foam-deep/40">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-chart-ink">
                          {type.name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {fmt(type.price_per_kg || 0)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {(() => {
                          const supplier = suppliers.find(s => s.id === type.supplier_id)
                          return supplier ? supplier.name : '-'
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            type.active
                              ? 'bg-kelp/15 text-kelp'
                              : 'bg-signal/15 text-signal'
                          }`}
                        >
                          {type.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex space-x-3 justify-end">
                          <button
                            onClick={() => handleEdit(type)}
                            className="text-lagoon-800 hover:text-lagoon-950"
                            title="Edit Feed Type"
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeleteConfirm(type)}
                            className="text-red-600 hover:text-red-800"
                            title="Delete Feed Type"
                          >
                            <Trash className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan="6"
                      className="px-6 py-12 text-center text-muted"
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

      {/* Add Feed Type Modal */}
      {showAddModal && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 modal-backdrop"
            onClick={() => setShowAddModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">
              Add New Feed Type
            </h3>

            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Name <span className="text-red-500">*</span>
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
                  {priceLabel}
                </label>
                <input
                  type="number"
                  name="price_per_kg"
                  value={formData.price_per_kg}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
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
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Pellet Size
                </label>
                <input
                  type="text"
                  name="pellet_size"
                  value={formData.pellet_size}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-1">
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
                    className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm font-data"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Alert when stock falls to or below this.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-1">
                    Bag size (kg)
                  </label>
                  <input
                    type="number"
                    name="bag_size_kg"
                    value={formData.bag_size_kg}
                    onChange={handleChange}
                    step="0.1"
                    min="0.1"
                    className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm font-data"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-1">
                    Supplier
                  </label>
                  <select
                    name="supplier_id"
                    value={formData.supplier_id}
                    onChange={handleChange}
                    className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  >
                    <option value="">Select supplier (optional)</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                  {suppliers.length === 0 && (
                    <p className="mt-1 text-xs text-muted">
                      No suppliers yet — you can save without one.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="active"
                  name="active"
                  checked={formData.active}
                  onChange={handleChange}
                  className="h-4 w-4 text-lagoon-800 focus:ring-lagoon-800 border-input-border rounded"
                />
                <label
                  htmlFor="active"
                  className="ml-2 block text-sm text-chart-ink"
                >
                  Active
                </label>
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

      {/* Edit Feed Type Modal */}
      {showEditModal && editingType && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 modal-backdrop"
            onClick={() => setShowEditModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">
              Edit Feed Type
            </h3>

            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Name <span className="text-red-500">*</span>
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
                  {priceLabel}
                </label>
                <input
                  type="number"
                  name="price_per_kg"
                  value={formData.price_per_kg}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
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
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Pellet Size
                </label>
                <input
                  type="text"
                  name="pellet_size"
                  value={formData.pellet_size}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-1">
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
                    className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm font-data"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Alert when stock falls to or below this.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-1">
                    Bag size (kg)
                  </label>
                  <input
                    type="number"
                    name="bag_size_kg"
                    value={formData.bag_size_kg}
                    onChange={handleChange}
                    step="0.1"
                    min="0.1"
                    className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm font-data"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-1">
                    Supplier
                  </label>
                  <select
                    name="supplier_id"
                    value={formData.supplier_id}
                    onChange={handleChange}
                    className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  >
                    <option value="">Select supplier (optional)</option>
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
                  className="h-4 w-4 text-lagoon-800 focus:ring-lagoon-800 border-input-border rounded"
                />
                <label
                  htmlFor="edit-active"
                  className="ml-2 block text-sm text-chart-ink"
                >
                  Active
                </label>
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

      <ConfirmDeleteModal
        open={Boolean(deleteConfirm)}
        title="Delete feed type"
        message={
          <>
            Delete{' '}
            <span className="font-semibold text-chart-ink">
              {deleteConfirm?.name || 'this feed type'}
            </span>
            ?
          </>
        }
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
      />
      </div>
    </Layout>
  )
}
