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
import { Button, Field, GradientButton, Input, Modal, Table } from '../components/ui'
import NavTabs from '../components/ui/NavTabs'
import { feedTabs } from '../lib/sectionTabs'
import { useT } from '../lib/i18n/context'
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
  const t = useT()
  const isAdmin = usePermission('inventory.prices.manage')
  const canRecord = usePermission('inventory.purchase.record')
  const [search, setSearch] = useState('')

  const suppliersResult = useQuery(api.feed.listSuppliers, {})
  const loading = suppliersResult === undefined
  const suppliers = suppliersResult || []
  const q = search.trim().toLowerCase()
  const shownSuppliers = q
    ? suppliers.filter((sup) => [sup.name, sup.contact_person, sup.email, sup.phone].some((v) => String(v || '').toLowerCase().includes(q)))
    : suppliers
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
    <Layout
      title={t('ops.suppliers.title')}
      eyebrow={t('ops.suppliers.eyebrow')}
      actions={
        canRecord ? (
          <GradientButton icon={Plus} onClick={handleAddSupplier}>
            {t('ops.feed.addSupplier')}
          </GradientButton>
        ) : null
      }
    >
      <div className="flex flex-col gap-[28px]">
        <NavTabs tabs={feedTabs(t)} label={t('ops.tabs.feed')} />
        <Table
          title={t('ops.suppliers.directory')}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('ops.suppliers.search')}
          columns={[
            {
              key: 'name',
              header: t('ops.col.supplier'),
              render: (sup) => sup.name,
              sub: (sup) => sup.contact_person || undefined,
            },
            { key: 'phone', header: t('ops.suppliers.phone'), width: 160, render: (sup) => sup.phone || '—' },
            {
              key: 'email',
              header: t('ops.suppliers.email'),
              width: 220,
              render: (sup) => <span className="break-all">{sup.email || '—'}</span>,
            },
            {
              key: 'web',
              header: t('ops.suppliers.website'),
              width: 200,
              render: (sup) =>
                sup.website ? (
                  <a
                    href={sup.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-sm break-all text-pearl-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                  >
                    {sup.website.replace(/^https?:\/\//, '')}
                  </a>
                ) : (
                  '—'
                ),
            },
            {
              key: 'actions',
              header: <span className="sr-only">{t('ops.col.actions')}</span>,
              width: 110,
              align: 'right',
              render: (sup) => (
                <span className="inline-flex gap-1">
                  {canRecord && (
                    <button
                      type="button"
                      onClick={() => handleEditSupplier(sup)}
                      title={t('ops.suppliers.edit', { name: sup.name })}
                      aria-label={t('ops.suppliers.edit', { name: sup.name })}
                      className="rounded-pill p-2 text-muted hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                    >
                      <Edit className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(sup)}
                      title={t('ops.suppliers.delete', { name: sup.name })}
                      aria-label={t('ops.suppliers.delete', { name: sup.name })}
                      className="rounded-pill p-2 text-muted hover:bg-surface-2 hover:text-alert focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                    >
                      <Trash className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </span>
              ),
            },
          ]}
          rows={shownSuppliers}
          empty={loading ? t('ops.common.loading') : t('ops.suppliers.empty')}
        />
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
            <div className="rounded-lg border border-signal/20 bg-signal/10 text-signal p-3 text-[13px] leading-5">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-kelp/20 bg-kelp/10 text-kelp p-3 text-[13px] leading-5">
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
            <div className="rounded-lg border border-signal/20 bg-signal/10 text-signal p-3 text-[13px] leading-5">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-kelp/20 bg-kelp/10 text-kelp p-3 text-[13px] leading-5">
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
