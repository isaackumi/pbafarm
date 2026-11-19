// pages/feed-types.js
import React, { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import {
  Plus,
  Edit,
  Trash,
  AlertCircle,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Field, Input, Select, Modal, GradientButton, Pill, Table } from '../components/ui'
import NavTabs from '../components/ui/NavTabs'
import { feedTabs } from '../lib/sectionTabs'
import { useT } from '../lib/i18n/context'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { feedTypeCreateArgs, feedTypeUpdateArgs } from '../lib/feedData'
import {
  buildFeedTypeDescription,
  normalizeBagSizeKg,
} from '../lib/feedTypeMeta'
import { useCurrency } from '../hooks/useCurrency'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from '../hooks/usePermission'
import { errorMessage } from '../lib/errorMessage'

export default function FeedTypesPage() {
  return (
    <ProtectedRoute>
      <FeedTypes />
    </ProtectedRoute>
  )
}

function FeedTypes() {
  const t = useT()
  const router = useRouter()
  const { showToast } = useToast()
  const { hasRole } = useAuth()
  const isAdmin = usePermission('inventory.prices.manage')
  const { pricePerKgLabel: priceLabel, formatCurrency: fmt } = useCurrency()
  const feedTypesResult = useQuery(api.feed.listFeedTypes, {})
  const suppliersResult = useQuery(api.feed.listSuppliers, {})
  const createFeedType = useMutation(api.feed.createFeedType)
  const updateFeedType = useMutation(api.feed.updateFeedType)
  const deleteFeedType = useMutation(api.feed.softDeleteFeedType)
  const loading = feedTypesResult === undefined
  const feedTypes = feedTypesResult ?? []
  const suppliers = suppliersResult ?? []

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
      await createFeedType(feedTypeCreateArgs(payload))
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
      showToast('error', errorMessage(err, 'Failed to create feed type'))
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
      await updateFeedType(feedTypeUpdateArgs(editingType.id, updates))
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
      showToast('error', errorMessage(err, 'Failed to update feed type'))
    }
  }

  const handleDelete = async () => {
    const id = deleteConfirm?.id || deleteConfirm?._id
    if (!id) return
    try {
      await deleteFeedType({ id })
    } catch (err) {
      showToast('error', errorMessage(err, 'Failed to delete feed type'))
    }
    setDeleteConfirm(null)
  }

  return (
    <Layout
      title={t('ops.feed.feedTypes')}
      eyebrow={t('ops.feedTypes.eyebrow')}
      actions={
        <GradientButton icon={Plus} onClick={() => setShowAddModal(true)}>
          {t('ops.feed.addFeedType')}
        </GradientButton>
      }
    >
      <div data-tour="page-feed-types" className="flex flex-col gap-[28px]">
        <NavTabs tabs={feedTabs(t)} label={t('ops.tabs.feed')} />
        <Table
          title={t('ops.feed.feedTypes')}
          columns={[
            { key: 'name', header: t('ops.col.name') },
            { key: 'price', header: t('ops.col.pricePerKg'), width: 140, align: 'right', render: (type) => fmt(type.price_per_kg || 0) },
            {
              key: 'supplier',
              header: t('ops.col.supplier'),
              render: (type) => <span className="text-muted">{suppliers.find((sp) => sp.id === type.supplier_id)?.name || '—'}</span>,
            },
            {
              key: 'status',
              header: t('ops.col.status'),
              width: 120,
              render: (type) => <Pill tone={type.active ? 'green' : 'neutral'}>{type.active ? t('ops.common.active') : t('ops.common.inactive')}</Pill>,
            },
            {
              key: 'actions',
              header: <span className="sr-only">{t('ops.col.actions')}</span>,
              width: 100,
              align: 'right',
              render: (type) => (
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => handleEdit(type)}
                    title={t('ops.feedTypes.edit')}
                    aria-label={t('ops.feedTypes.edit')}
                    className="rounded-sm p-1 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                  >
                    <Edit className="h-4 w-4" aria-hidden />
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(type)}
                      title={t('ops.feedTypes.delete')}
                      aria-label={t('ops.feedTypes.delete')}
                      className="rounded-sm p-1 text-alert hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                    >
                      <Trash className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              ),
            },
          ]}
          rows={loading ? [] : feedTypes}
          empty={loading ? t('ops.common.loading') : t('ops.feedTypes.empty')}
        />
      </div>

      {/* Add Feed Type Modal */}
      {showAddModal && (
        <Modal
          onClose={() => setShowAddModal(false)}
          as="form"
          onSubmit={handleAdd}
          title="Add feed type"
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
                Save feed type
              </Button>
            </>
          }
        >
          <Field label="Name" htmlFor="ft-add-name" required>
            <Input
              id="ft-add-name"
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </Field>

          <Field label={priceLabel} htmlFor="ft-add-price-per-kg">
            <Input
              id="ft-add-price-per-kg"
              type="number"
              name="price_per_kg"
              value={formData.price_per_kg}
              onChange={handleChange}
              step="0.01"
              min="0"
            />
          </Field>

          <Field label="Protein percentage (%)" htmlFor="ft-add-protein-percentage">
            <Input
              id="ft-add-protein-percentage"
              type="number"
              name="protein_percentage"
              value={formData.protein_percentage}
              onChange={handleChange}
              step="0.1"
              min="0"
              max="100"
            />
          </Field>
          <Field label="Pellet size" htmlFor="ft-add-pellet-size">
            <Input
              id="ft-add-pellet-size"
              type="text"
              name="pellet_size"
              value={formData.pellet_size}
              onChange={handleChange}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Minimum stock (kg)" htmlFor="ft-add-minimum-stock">
              <Input
                id="ft-add-minimum-stock"
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
                Alert when stock falls to or below this.
              </p>
            </Field>
            <Field label="Bag size (kg)" htmlFor="ft-add-bag-size-kg">
              <Input
                id="ft-add-bag-size-kg"
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Supplier" htmlFor="ft-add-supplier-id">
              <Select
                id="ft-add-supplier-id"
                name="supplier_id"
                value={formData.supplier_id}
                onChange={handleChange}
              >
                <option value="">Select supplier (optional)</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
              {suppliers.length === 0 && (
                <p className="mt-1 text-xs text-muted">
                  No suppliers yet — you can save without one.
                </p>
              )}
            </Field>
          </div>

          <div className="flex items-center min-h-11">
            <input
              type="checkbox"
              id="active"
              name="active"
              checked={formData.active}
              onChange={handleChange}
              className="h-4 w-4 rounded border-input-border accent-lake focus-visible:ring-2 focus-visible:ring-lake"
            />
            <label
              htmlFor="active"
              className="ml-2 block text-sm text-chart-ink"
            >
              Active
            </label>
          </div>
        </Modal>
      )}

      {/* Edit Feed Type Modal */}
      {showEditModal && editingType && (
        <Modal
          onClose={() => setShowEditModal(false)}
          as="form"
          onSubmit={handleUpdate}
          title="Edit feed type"
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
          <Field label="Name" htmlFor="ft-edit-name" required>
            <Input
              id="ft-edit-name"
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </Field>

          <Field
            label={priceLabel}
            htmlFor="ft-edit-price-per-kg"
            hint={isAdmin ? undefined : 'Only an admin can change the price'}
          >
            <Input
              id="ft-edit-price-per-kg"
              type="number"
              name="price_per_kg"
              value={formData.price_per_kg}
              disabled={!isAdmin}
              onChange={handleChange}
              step="0.01"
              min="0"
            />
          </Field>

          <Field label="Protein percentage (%)" htmlFor="ft-edit-protein-percentage">
            <Input
              id="ft-edit-protein-percentage"
              type="number"
              name="protein_percentage"
              value={formData.protein_percentage}
              onChange={handleChange}
              step="0.1"
              min="0"
              max="100"
            />
          </Field>
          <Field label="Pellet size" htmlFor="ft-edit-pellet-size">
            <Input
              id="ft-edit-pellet-size"
              type="text"
              name="pellet_size"
              value={formData.pellet_size}
              onChange={handleChange}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Minimum stock (kg)" htmlFor="ft-edit-minimum-stock">
              <Input
                id="ft-edit-minimum-stock"
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
                Alert when stock falls to or below this.
              </p>
            </Field>
            <Field label="Bag size (kg)" htmlFor="ft-edit-bag-size-kg">
              <Input
                id="ft-edit-bag-size-kg"
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Supplier" htmlFor="ft-edit-supplier-id">
              <Select
                id="ft-edit-supplier-id"
                name="supplier_id"
                value={formData.supplier_id}
                onChange={handleChange}
              >
                <option value="">Select supplier (optional)</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex items-center min-h-11">
            <input
              type="checkbox"
              id="edit-active"
              name="active"
              checked={formData.active}
              onChange={handleChange}
              className="h-4 w-4 rounded border-input-border accent-lake focus-visible:ring-2 focus-visible:ring-lake"
            />
            <label
              htmlFor="edit-active"
              className="ml-2 block text-sm text-chart-ink"
            >
              Active
            </label>
          </div>
        </Modal>
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
    </Layout>
  )
}
