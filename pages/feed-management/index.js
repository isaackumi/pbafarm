import React, { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import { formatCurrency } from '../../lib/currencyUtils'
import Layout from '../../components/Layout'
import {
  Button,
  Field,
  Input,
  Textarea,
  LoadingState,
  Modal,
  GradientButton,
  GhostButton,
  KpiStrip,
  Pill,
  Table,
} from '../../components/ui'
import NavTabs from '../../components/ui/NavTabs'
import { Panel, ListRow } from '../../components/ui/Panel'
import { feedTabs } from '../../lib/sectionTabs'
import { buildFeedOverview, COVER_SCALE_DAYS, feedMoney, formatMass, movementKind, shortDate, signedMass } from '../../lib/feedOverview'
import { useCurrency } from '../../hooks/useCurrency'
import { useT } from '../../lib/i18n/context'
import { feedTypeCreateArgs, feedTypeUpdateArgs } from '../../lib/feedData'
import { supplierCreateArgs } from '../../lib/supplierArgs'
import { useFeedUsageStats } from '../../hooks/useFeedData'
import { errorMessage } from '../../lib/errorMessage'
import { useLocation } from '../../contexts/LocationContext'
import { buildFeedTypeDescription } from '../../lib/feedTypeMeta'
import { api } from '../../convex/_generated/api'
import { useToast } from '../../components/Toast'
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal'
import FeedPurchaseModal from '../../components/FeedPurchaseModal'
import { Plus, ArrowDownToLine, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { usePermission } from '../../hooks/usePermission'

const FeedManagement = () => {
  const t = useT()
  const { currency } = useCurrency()
  const isAdmin = usePermission('inventory.adjust')
  const canIssue = usePermission('inventory.issue')
  const canPurchase = usePermission('inventory.purchase.record')
  const { locationArgs, activeLocation } = useLocation()
  const movements = useQuery(api.inventory.listTransactions, { ...locationArgs, limit: 8 })
  const feedTypesResult = useQuery(api.feed.listFeedTypes, {})
  const suppliersResult = useQuery(api.feed.listSuppliers, {})
  const stockLevels = useQuery(api.inventory.listStockLevels, locationArgs)
  const usageStats = useFeedUsageStats('30d')
  const feedTypes = feedTypesResult || []
  const suppliers = suppliersResult || []
  const loading = feedTypesResult === undefined
  const statsLoading = loading || stockLevels === undefined || usageStats === undefined
  const createFeedType = useMutation(api.feed.createFeedType)
  const updateFeedType = useMutation(api.feed.updateFeedType)
  const softDeleteFeedType = useMutation(api.feed.softDeleteFeedType)
  const createSupplier = useMutation(api.feed.createSupplier)
  const [searchTerm, setSearchTerm] = useState('')
  const [movementSearch, setMovementSearch] = useState('')
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
      await softDeleteFeedType({ id })
      showToast('Feed type deleted successfully', 'success')
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Error deleting feed type:', error)
      showToast(errorMessage(error, 'Failed to delete feed type'), 'error')
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
        await updateFeedType(feedTypeUpdateArgs(editingType.id || editingType._id, payload))
        showToast('Feed type updated successfully', 'success')
      } else {
        await createFeedType(feedTypeCreateArgs(payload))
        showToast('Feed type created successfully', 'success')
      }
      closeFeedModal()
    } catch (error) {
      console.error('Error saving feed type:', error)
      showToast(errorMessage(error, 'Failed to save feed type'), 'error')
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
      await updateFeedType({ id, patch: { active: newStatus } })
      showToast(`Feed type ${newStatus ? 'activated' : 'deactivated'} successfully`, 'success')
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
      await createSupplier(supplierCreateArgs(supplierFormData))
      showToast('Supplier added successfully', 'success')
      setShowAddSupplierModal(false)
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

  const overview = buildFeedOverview(stockLevels, usageStats?.rows, 30)
  const priceById = Object.fromEntries((stockLevels || []).map((r) => [r.feed_type_id, Number(r.price_per_kg || 0)]))
  const nameById = Object.fromEntries((stockLevels || []).map((r) => [r.feed_type_id, r.feed_type_name]))
  const proteinById = Object.fromEntries(
    feedTypes.map((f) => [f.id || f._id, f.protein_percentage ?? f.protein_content ?? null]),
  )
  const coverText = (days) => (days == null ? '—' : t('ops.feed.days', { count: Math.round(days) }))
  const movementItem = (r) => [nameById[r.feed_type_id] || '—', r.notes || r.batch_number].filter(Boolean).join(' · ')
  const movementQuery = movementSearch.trim().toLowerCase()
  const movementRows = (movements || []).filter((r) => !movementQuery || movementItem(r).toLowerCase().includes(movementQuery))

  return (
    <ProtectedRoute>
      <Layout
        title={t('ops.feed.title')}
        eyebrow={activeLocation?.name ? t('ops.feed.eyebrowAt', { site: activeLocation.name }) : t('ops.feed.title')}
        actions={
          <>
            {canIssue && (
              <GradientButton variant="lime" href="/feed-issue" icon={ArrowDownToLine}>
                {t('ops.feed.issueFeed')}
              </GradientButton>
            )}
            {canPurchase && (
              <GradientButton ring="sky" icon={Plus} onClick={() => setShowPurchaseModal(true)}>
                {t('ops.feed.newPurchase')}
              </GradientButton>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-[28px]" data-tour="page-feed-management">
          <NavTabs tabs={feedTabs(t)} label={t('ops.tabs.feed')} />

          <KpiStrip
            items={[
              {
                label: t('ops.feed.inStore'),
                value: statsLoading ? '—' : formatMass(overview.totalKg),
                suffix: statsLoading || overview.coverDays == null ? undefined : t('ops.feed.daysCover', { count: Math.round(overview.coverDays) }),
              },
              {
                label: t('ops.feed.used30d'),
                value: statsLoading ? '—' : formatMass(overview.usedKg),
                suffix: statsLoading ? undefined : t('ops.feed.perDay', { amount: formatMass(overview.dailyKg) }),
              },
              {
                label: t('ops.feed.cost30d'),
                value: statsLoading ? '—' : feedMoney(overview.costValue, currency, { compact: true }),
                suffix: statsLoading || !overview.usedKg ? undefined : t('ops.feed.perKg', { amount: feedMoney(overview.costPerKg, currency, { decimals: 1 }) }),
              },
              {
                label: t('ops.feed.lowStock'),
                value: statsLoading ? '—' : t('ops.feed.items', { count: overview.reorder.length }),
                suffix: overview.reorder.length ? t('ops.feed.reorderNow') : undefined,
              },
            ]}
          />

          <div className="flex flex-col gap-[20px] xl:flex-row">
            <Panel
              className="xl:grow-[1.4] xl:basis-0"
              title={t('ops.feed.stockByFeed')}
              titleId="fm-stock-by-feed"
              meta={t('ops.feed.barIsCover')}
            >
              {statsLoading ? (
                <LoadingState label={t('ops.common.loading')} />
              ) : overview.rows.length === 0 ? (
                <p className="border-t border-line py-3 text-sm text-muted">{t('ops.feed.noStock')}</p>
              ) : (
                overview.rows.map((row) => {
                  const protein = proteinById[row.id]
                  const cover = Math.min(row.coverDays ?? 0, COVER_SCALE_DAYS)
                  return (
                  <div key={row.id} className="flex items-center gap-4 border-t border-line py-3">
                    <div className="flex w-[170px] shrink-0 flex-col gap-[2px]">
                      <span className="truncate text-[14px] leading-[18px] text-text">{row.name}</span>
                      <span className="truncate text-xs leading-4 text-muted">
                        {protein != null && protein !== '' ? t('ops.feed.protein', { pct: protein }) : row.supplier || t('ops.feed.minKg', { amount: formatMass(row.minimumKg) })}
                      </span>
                    </div>
                    {/* Paper 09: 8px track; healthy cover is the sky gradient, low is warn, critical is alert. */}
                    <div
                      role="progressbar"
                      aria-label={t('ops.feed.coverOf', { name: row.name })}
                      aria-valuemin={0}
                      aria-valuemax={COVER_SCALE_DAYS}
                      aria-valuenow={Math.round(cover)}
                      className="h-2 grow basis-0 overflow-hidden rounded-pill bg-line"
                    >
                      <div
                        className={`h-2 rounded-pill ${row.tone === 'alert' ? 'bg-alert' : row.tone === 'warn' ? 'bg-warn' : ''}`}
                        style={{
                          width: `${(cover / COVER_SCALE_DAYS) * 100}%`,
                          ...(row.tone === 'good' ? { backgroundImage: 'linear-gradient(in oklab 90deg, #1562D6 0%, #8EC2F7 100%)' } : {}),
                        }}
                      />
                    </div>
                    <span className="w-[70px] shrink-0 text-right text-[13px] leading-4 text-muted">
                      {coverText(row.coverDays)}
                    </span>
                    <span className="w-[70px] shrink-0 text-right text-sm font-medium leading-[18px] tabular-nums text-text">
                      {formatMass(row.stockKg)}
                    </span>
                  </div>
                  )
                })
              )}
            </Panel>

            <Panel
              className="xl:grow xl:basis-0"
              title={t('ops.feed.reorder')}
              titleId="fm-reorder"
              action={canPurchase ? { label: t('ops.feed.createPo'), href: '/procurement' } : undefined}
            >
              {statsLoading ? (
                <LoadingState label={t('ops.common.loading')} />
              ) : overview.reorder.length === 0 ? (
                <p className="border-t border-line py-3 text-sm text-muted">{t('ops.feed.nothingToReorder')}</p>
              ) : (
                overview.reorder.map((row) => (
                  <ListRow
                    key={row.id}
                    dot={row.tone === 'alert' ? 'alert' : 'warn'}
                    dotLabel={t('ops.feed.lowStockShort')}
                    title={row.name}
                    sub={[row.supplier, t('ops.feed.minKg', { amount: formatMass(row.minimumKg) })].filter(Boolean).join(' · ')}
                    value={formatMass(row.stockKg)}
                    valueSub={coverText(row.coverDays)}
                  />
                ))
              )}
            </Panel>
          </div>

          <Table
            title={t('ops.feed.recentMovements')}
            search={movementSearch}
            onSearchChange={setMovementSearch}
            searchPlaceholder={t('ops.feed.searchMovements')}
            actions={
              <Link href="/inventory-transactions" className="rounded-sm text-sm text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                {t('ops.common.viewAll')}
              </Link>
            }
            columns={[
              { key: 'date', header: t('ops.col.date'), width: 110, render: (r) => shortDate(r.transaction_date) },
              {
                key: 'type',
                header: t('ops.col.type'),
                width: 130,
                render: (r) => {
                  const kind = movementKind(r.transaction_type)
                  return <Pill tone={kind.tone}>{t(`ops.movement.${kind.key}`)}</Pill>
                },
              },
              {
                key: 'item',
                header: t('ops.col.item'),
                render: movementItem,
              },
              { key: 'qty', header: t('ops.col.qty'), width: 110, align: 'right', render: (r) => signedMass(r.quantity_kg) },
              {
                key: 'value',
                header: t('ops.col.value'),
                width: 130,
                align: 'right',
                render: (r) => feedMoney(Number(r.quantity_kg || 0) * (priceById[r.feed_type_id] || 0), currency),
              },
            ]}
            rows={movementRows}
            empty={movements === undefined ? t('ops.common.loading') : t('ops.feed.noMovements')}
          />

          <Table
            title={t('ops.feed.feedTypes')}
            tabs={[
              { value: 'all', label: t('ops.common.all') },
              { value: 'active', label: t('ops.common.active') },
              { value: 'inactive', label: t('ops.common.inactive') },
            ]}
            tab={statusFilter}
            onTabChange={(v) => { setStatusFilter(v); setCurrentPage(1) }}
            search={searchTerm}
            onSearchChange={(v) => { setSearchTerm(v); setCurrentPage(1) }}
            searchPlaceholder={t('ops.feed.searchFeedTypes')}
            actions={
              <>
                <GhostButton size="sm" icon={Plus} onClick={handleAddFeedType}>
                  {t('ops.feed.addFeedType')}
                </GhostButton>
                <GhostButton size="sm" icon={Plus} onClick={handleAddSupplier}>
                  {t('ops.feed.addSupplier')}
                </GhostButton>
              </>
            }
            columns={[
              { key: 'name', header: t('ops.col.name'), sub: (type) => (type.protein_percentage != null && type.protein_percentage !== '' ? t('ops.feed.protein', { pct: type.protein_percentage }) : null) },
              { key: 'price', header: t('ops.col.pricePerKg'), width: 140, align: 'right', render: (type) => formatCurrency(type.price_per_kg) },
              {
                key: 'status',
                header: t('ops.col.status'),
                width: 130,
                render: (type) => (
                  <button
                    type="button"
                    onClick={() => handleStatusChange(type.id, !type.active)}
                    aria-label={t(type.active ? 'ops.feed.deactivate' : 'ops.feed.activate', { name: type.name })}
                    className="rounded-pill focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                  >
                    <Pill tone={type.active ? 'green' : 'neutral'}>{type.active ? t('ops.common.active') : t('ops.common.inactive')}</Pill>
                  </button>
                ),
              },
              {
                key: 'actions',
                header: <span className="sr-only">{t('ops.col.actions')}</span>,
                width: 150,
                align: 'right',
                render: (type) => (
                  <div className="flex justify-end gap-3 text-sm">
                    <button type="button" onClick={() => handleEditFeedType(type)} className="rounded-sm text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                      {t('ops.common.edit')}
                    </button>
                    {isAdmin && (
                      <button type="button" onClick={() => setDeleteConfirm(type)} className="rounded-sm text-alert hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                        {t('ops.common.delete')}
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            rows={loading ? [] : currentItems}
            empty={loading ? t('ops.common.loading') : t('ops.feed.noFeedTypes')}
          />
          {totalPages > 1 && (
            <nav aria-label={t('ops.common.pagination')} className="-mt-4 flex items-center justify-end gap-3 text-sm text-muted tabular-nums">
              <span>{t('ops.common.pageOf', { page: currentPage, total: totalPages })}</span>
              <GhostButton size="sm" icon={ChevronLeft} onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} aria-label={t('ops.common.previous')} />
              <GhostButton size="sm" icon={ChevronRight} onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} aria-label={t('ops.common.next')} />
            </nav>
          )}
        </div>

        {/* Add/Edit Feed Type Modal */}
        {showAddModal && (
          <Modal
            onClose={closeFeedModal}
            closeOnBackdrop={false}
            as="form"
            onSubmit={handleSubmit}
            title={editingType ? 'Edit feed type' : 'Add feed type'}
            footer={
              <>
                <Button variant="secondary" onClick={closeFeedModal}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingType ? 'Save changes' : 'Add feed type'}
                </Button>
              </>
            }
          >
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
              <Field
                label="Price per kg (₵)"
                htmlFor="fm-type-price-per-kg"
                hint={editingType && !isAdmin ? 'Only an admin can change the price' : undefined}
              >
                <Input
                  id="fm-type-price-per-kg"
                  type="number"
                  name="price_per_kg"
                  value={formData.price_per_kg}
                  disabled={Boolean(editingType) && !isAdmin}
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
          </Modal>
        )}

        {/* Add Supplier Modal */}
        {showAddSupplierModal && (
          <Modal
            onClose={() => setShowAddSupplierModal(false)}
            closeOnBackdrop={false}
            as="form"
            onSubmit={handleSupplierSubmit}
            title="Add supplier"
            footer={
              <>
                <Button variant="secondary" onClick={() => setShowAddSupplierModal(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  Add supplier
                </Button>
              </>
            }
          >
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
          </Modal>
        )}

        <FeedPurchaseModal
          open={showPurchaseModal}
          onClose={() => setShowPurchaseModal(false)}
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