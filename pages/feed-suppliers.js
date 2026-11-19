// pages/feed-suppliers.js
import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  Plus,
  Edit,
  Trash,
  AlertCircle,
  Mail,
  Phone,
  MapPin,
  Globe,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button, Field, Input, LoadingState, Modal } from '../components/ui'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../convex/_generated/api'
import { supplierCreateArgs, supplierUpdateArgs } from '../lib/supplierArgs'
import { errorMessage } from '../lib/errorMessage'
import { usePermission } from '../hooks/usePermission'

export default function FeedSuppliersPage() {
  return (
    <ProtectedRoute>
      <FeedSuppliers />
    </ProtectedRoute>
  )
}


function FeedSuppliers() {
  const { showToast } = useToast()
  const { hasRole } = useAuth()
  const isAdmin = usePermission('inventory.prices.manage')

  const suppliersResult = useQuery(api.feed.listSuppliers, {})
  const loading = suppliersResult === undefined
  const suppliers = suppliersResult || []
  const createSupplier = useMutation(api.feed.createSupplier)
  const updateSupplier = useMutation(api.feed.updateSupplier)
  const softDeleteSupplier = useMutation(api.feed.softDeleteSupplier)
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

  const handleDeleteSupplier = async () => {
    const id = deleteConfirm?.id || deleteConfirm?._id
    if (!id) return
    try {
      await softDeleteSupplier({ id })
      showToast('success', 'Supplier deleted successfully')
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Error deleting supplier:', error)
      showToast('error', errorMessage(error, 'Failed to delete supplier'))
      setError(errorMessage(error, 'Failed to delete supplier. It may be in use in feed types.'))
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
        website: formData.website.trim() || undefined,
      }
      await createSupplier(supplierCreateArgs(supplierData))
      setSuccess('Supplier created successfully')
      showToast('success', 'Supplier created successfully')
      setTimeout(() => {
        setShowAddModal(false)
      }, 1500)
    } catch (error) {
      setError(errorMessage(error))
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
        website: formData.website.trim() || undefined,
      }
      await updateSupplier(supplierUpdateArgs(editingSupplier.id, supplierData))
      setSuccess('Supplier updated successfully')
      showToast('success', 'Supplier updated successfully')
      setTimeout(() => {
        setShowEditModal(false)
      }, 1500)
    } catch (error) {
      setError(errorMessage(error))
    }
  }

  return (
    <Layout title="Feed Suppliers">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Feed', href: '/feed-management/overview' },
          { label: 'Suppliers' },
        ]}
        description="Manage feed suppliers and contact information in one place."
        related={[
          { label: 'Feed types', href: '/feed-types' },
          { label: 'Feed purchases', href: '/feed-purchases' },
          { label: 'Stock levels', href: '/stock-levels' },
        ]}
        actions={
          <Button onClick={handleAddSupplier}>
            <Plus className="w-4 h-4" aria-hidden />
            Add supplier
          </Button>
        }
      />

        {/* Suppliers Grid */}
        <div className="page-card overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-foam-deep">
            <h2 className="font-medium text-chart-ink">Suppliers directory</h2>
          </div>

          {loading ? (
            <LoadingState label="Loading suppliers..." />
          ) : suppliers.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 p-4 sm:p-6">
              {suppliers.map((supplier) => (
                <div
                  key={supplier.id}
                  className="border border-foam-deep rounded-lg shadow-sm hover:border-lake transition-colors overflow-hidden"
                >
                  <div className="px-4 py-5 sm:px-6 bg-foam border-b border-foam-deep">
                    <h3 className="text-lg font-medium text-chart-ink truncate">
                      {supplier.name}
                    </h3>
                  </div>
                  <div className="px-4 py-4 sm:px-6">
                    <div className="space-y-2">
                      {supplier.website && (
                        <div className="flex items-start">
                          <Globe className="h-4 w-4 text-muted mr-2 mt-0.5 shrink-0" aria-hidden />
                          <a
                            href={supplier.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-lake hover:underline break-all"
                          >
                            {supplier.website.replace(/^https?:\/\//, '')}
                          </a>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 flex gap-1 justify-end border-t border-foam-deep pt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditSupplier(supplier)}
                        className="text-lake"
                        title="Edit supplier"
                        aria-label="Edit supplier"
                      >
                        <Edit className="w-4 h-4" aria-hidden />
                      </Button>

                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirm(supplier)}
                          className="text-signal"
                          title="Delete supplier"
                          aria-label="Delete supplier"
                        >
                          <Trash className="w-4 h-4" aria-hidden />
                        </Button>
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

      {/* Add Supplier Modal */}
      {showAddModal && (
        <Modal
          onClose={() => setShowAddModal(false)}
          as="form"
          onSubmit={handleSubmitAdd}
          title="Add supplier"
          bodyClassName="space-y-4"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                Save supplier
              </Button>
            </>
          }
        >
          {error && (
            <div className="rounded-lg border border-signal/20 bg-signal/10 text-signal p-3 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-kelp/20 bg-kelp/10 text-kelp p-3 text-sm">
              {success}
            </div>
          )}

          <Field label="Company name" htmlFor="supplier-name" required>
            <Input
              id="supplier-name"
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </Field>

          <Field label="Website" htmlFor="supplier-website">
            <Input
              id="supplier-website"
              type="url"
              name="website"
              value={formData.website}
              onChange={handleChange}
              placeholder="https://example.com"
            />
          </Field>
        </Modal>
      )}

      {/* Edit Supplier Modal */}
      {showEditModal && editingSupplier && (
        <Modal
          onClose={() => setShowEditModal(false)}
          as="form"
          onSubmit={handleSubmitEdit}
          title="Edit supplier"
          bodyClassName="space-y-4"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setShowEditModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                Save changes
              </Button>
            </>
          }
        >
          {error && (
            <div className="rounded-lg border border-signal/20 bg-signal/10 text-signal p-3 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-kelp/20 bg-kelp/10 text-kelp p-3 text-sm">
              {success}
            </div>
          )}

          <Field label="Company name" htmlFor="supplier-name" required>
            <Input
              id="supplier-name"
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </Field>

          <Field label="Website" htmlFor="supplier-website">
            <Input
              id="supplier-website"
              type="url"
              name="website"
              value={formData.website}
              onChange={handleChange}
              placeholder="https://example.com"
            />
          </Field>
        </Modal>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteConfirm)}
        title="Delete supplier"
        message={
          <>
            Delete{' '}
            <span className="font-semibold text-chart-ink">
              {deleteConfirm?.name || 'this supplier'}
            </span>
            ? Feed types linked to it may need a new supplier.
          </>
        }
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={handleDeleteSupplier}
      />
    </Layout>
  )
}
