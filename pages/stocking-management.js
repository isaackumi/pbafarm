// pages/stocking-management.js
import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import { ArrowLeftRight, ChevronDown, Edit, Trash2, Plus, AlertTriangle } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  Button,
  Card,
  Field,
  Input,
  Textarea,
  EmptyState,
  LoadingState,
  Modal,
  GradientButton,
  GhostButton,
  Pill,
  Table,
  Tabs,
} from '../components/ui'
import { HeaderAction } from '../components/ui/HeaderAction'
import MovementStatus, { MovementTypePill } from '../components/MovementStatus'
import { formatDate, formatDateTime, formatNumber } from '../lib/format'
import { useT } from '../lib/i18n/context'
import FarmLocationSelect from '../components/FarmLocationSelect'
import { api } from '../convex/_generated/api'
import { stockingPatchArgs } from '../lib/recordArgs'
import { useLocation } from '../contexts/LocationContext'
import { errorMessage } from '../lib/errorMessage'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from '../hooks/usePermission'

const ICON_BTN =
  'inline-flex items-center justify-center size-9 rounded-pill text-muted hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

/** One pending stocking, top-up or transfer (Paper 06 approval card). */
function ApprovalCard({ record, canAct, busy, onApprove, onReject }) {
  const t = useT()
  const typeLabel = t(`stocking.type.${record.type === 'fish_transfer' ? 'transfer' : record.type}`)
  const heading = record.type === 'fish_transfer' ? record.batchNumber : record.cageName
  const details =
    record.type === 'stocking'
      ? `/stocking/${record.id}/details`
      : record.type === 'topup'
        ? `/topup/${record.id}/details`
        : '/fish-transfers'
  const stats = [
    { label: t('stocking.col.fish'), value: formatNumber(record.count) },
    { label: t('stocking.mgmt.avgWeight'), value: `${formatNumber(record.abw, { decimals: 1 })} g` },
    { label: t('stocking.mgmt.biomass'), value: `${formatNumber(record.biomass, { decimals: 1 })} kg` },
  ]
  if (record.type !== 'fish_transfer') stats.push({ label: t('stocking.col.batch'), value: record.batchNumber })
  return (
    <article className="flex flex-col gap-[18px] rounded-card border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-[17px] font-semibold leading-[22px] text-text">
            {typeLabel} · {heading}
          </h2>
          <p className="text-[13px] leading-4 text-muted">
            {t('stocking.mgmt.requested', { date: formatDate(record.date), when: formatDateTime(record.createdAt) })}
          </p>
        </div>
        <Pill tone="amber">{t('stocking.status.pending_approval')}</Pill>
      </header>
      <dl className="grid grid-cols-2 gap-y-4 sm:grid-cols-4">
        {stats.map((st, i) => (
          <div key={st.label} className={`flex min-w-0 flex-col gap-1 ${i ? 'sm:border-l sm:border-line sm:pl-4' : ''}`}>
            <dt className="text-xs leading-4 text-faint">{st.label}</dt>
            <dd className="truncate text-base font-medium leading-5 text-text tabular-nums">{st.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2.5">
        {canAct && (
          <>
            <GradientButton
              disabled={busy}
              onClick={onApprove}
              className="[&>span]:h-[38px] [&>span]:px-5 [&>span]:text-[14px]"
            >
              {t('stocking.approve')}
            </GradientButton>
            <GhostButton size="lg" disabled={busy} onClick={onReject} className="!h-[41px] !px-5">
              {t('stocking.reject')}
            </GhostButton>
          </>
        )}
        <a
          href={details}
          className="inline-flex h-[41px] items-center rounded-pill px-3.5 text-[14px] leading-[18px] text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          {t('stocking.mgmt.viewDetails')}
        </a>
      </div>
    </article>
  )
}

export default function StockingManagementPage() {
  return (
    <ProtectedRoute>
      <StockingManagement />
    </ProtectedRoute>
  )
}

function StockingManagement() {
  const t = useT()
  const router = useRouter()
  const { showToast } = useToast()
  const { user } = useAuth()
  const isAdmin = usePermission('production.stocking.approve')
  const canApprove = isAdmin
  const canApproveTransfer = usePermission('production.transfer.approve')
  const { locationArgs } = useLocation()
  const stockingsResult = useQuery(api.stocking.listStockingHistory, locationArgs)
  const topupsResult = useQuery(api.stocking.listTopupHistory, user ? {} : 'skip')
  const transfersResult = useQuery(api.fishTransfers.listFishTransfers, user ? locationArgs : 'skip')
  const approvals = useQuery(api.stocking.listPendingApprovals, user && canApprove ? {} : 'skip')
  const approveStocking = useMutation(api.stocking.approveStocking)
  const approveTopup = useMutation(api.stocking.approveTopup)
  const approveFishTransfer = useMutation(api.fishTransfers.approveFishTransfer)
  const rejectStocking = useMutation(api.stocking.rejectStocking)
  const rejectTopup = useMutation(api.stocking.rejectTopup)
  const rejectFishTransfer = useMutation(api.fishTransfers.rejectFishTransfer)
  const [tab, setTab] = useState(typeof router.query.tab === 'string' ? router.query.tab : 'approvals')
  const [historySearch, setHistorySearch] = useState('')
  const [busyKey, setBusyKey] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState('')
  const [rejectBusy, setRejectBusy] = useState(false)
  const updateStockingMutation = useMutation(api.stocking.updateStocking)
  const removeStocking = useMutation(api.stocking.removeStocking)
  const stockings = useMemo(() => stockingsResult || [], [stockingsResult])
  const loading = stockingsResult === undefined
  const [filteredStockings, setFilteredStockings] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [yearFilter, setYearFilter] = useState('all')
  const [cageFilter, setCageFilter] = useState('all')
  const [sortField, setSortField] = useState('stocking_date')
  const [sortDirection, setSortDirection] = useState('desc')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingStocking, setEditingStocking] = useState(null)
  const [deleteStocking, setDeleteStocking] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [formData, setFormData] = useState({
    stocking_date: '',
    fish_count: '',
    initial_abw: '',
    source_location: '',
    notes: '',
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    filterStockings()
  }, [stockings, searchQuery, yearFilter, cageFilter, sortField, sortDirection])

  const uniqueCages = useMemo(
    () =>
      [...new Set(stockings.map((s) => s.cage?.name || s.cage_name).filter(Boolean))]
        .map((name) => ({
          name,
          id: stockings.find((s) => (s.cage?.name || s.cage_name) === name)?.cage_id,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stockings],
  )
  const availableYears = useMemo(
    () =>
      [...new Set(stockings.map((s) => new Date(s.stocking_date).getFullYear()))].sort(
        (a, b) => b - a,
      ),
    [stockings],
  )

  const filterStockings = () => {
    let result = [...stockings]

    // Apply search filter
    if (searchQuery) {
      result = result.filter(
        (stocking) =>
          stocking.batch_number
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          stocking.cage?.name
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          stocking.cage_name
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          stocking.source_location
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()),
      )
    }

    // Apply year filter
    if (yearFilter !== 'all') {
      const year = parseInt(yearFilter)
      result = result.filter(
        (stocking) => new Date(stocking.stocking_date).getFullYear() === year,
      )
    }

    // Apply cage filter
    if (cageFilter !== 'all') {
      result = result.filter((stocking) => stocking.cage_id === cageFilter)
    }

    // Apply sorting
    result.sort((a, b) => {
      let valueA = a[sortField]
      let valueB = b[sortField]

      // Handle special case for dates
      if (sortField === 'stocking_date') {
        valueA = new Date(valueA)
        valueB = new Date(valueB)
      }

      // Handle cage name sorting
      if (sortField === 'cage_name') {
        valueA = a.cage?.name || a.cage_name || ''
        valueB = b.cage?.name || b.cage_name || ''
      }

      if (valueA < valueB) {
        return sortDirection === 'asc' ? -1 : 1
      }
      if (valueA > valueB) {
        return sortDirection === 'asc' ? 1 : -1
      }
      return 0
    })

    setFilteredStockings(result)
  }

  const approveRecord = async (rec) => {
    setBusyKey(`${rec.type}-${rec.id}`)
    try {
      if (rec.type === 'topup') await approveTopup({ id: rec.id })
      else if (rec.type === 'fish_transfer') await approveFishTransfer({ id: rec.id })
      else await approveStocking({ id: rec.id })
      showToast(t('stocking.mgmt.approved'), 'success')
    } catch (err) {
      showToast(errorMessage(err, t('stocking.mgmt.approveFailed')), 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const rejectRecord = async () => {
    if (!rejecting) return
    const reason = rejectReason.trim()
    if (!reason) {
      setRejectError(t('stocking.mgmt.reasonRequired'))
      return
    }
    setRejectBusy(true)
    setRejectError('')
    try {
      if (rejecting.type === 'topup') await rejectTopup({ id: rejecting.id, reason })
      else if (rejecting.type === 'fish_transfer') await rejectFishTransfer({ id: rejecting.id, reason })
      else await rejectStocking({ id: rejecting.id, reason })
      showToast(t('stocking.mgmt.rejected'), 'success')
      setRejecting(null)
    } catch (err) {
      setRejectError(errorMessage(err, t('stocking.mgmt.rejectFailed')))
    } finally {
      setRejectBusy(false)
    }
  }

  const handleSort = (field) => {
    const actualField = field === 'cage_name' ? 'cage_name' : field

    if (sortField === actualField) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // New field, start with appropriate direction
      setSortField(actualField)
      setSortDirection(field === 'stocking_date' ? 'desc' : 'asc')
    }
  }

  const handleEditStocking = (stocking) => {
    setEditingStocking(stocking)
    setFormData({
      stocking_date: stocking.stocking_date,
      fish_count: stocking.fish_count,
      initial_abw: stocking.initial_abw,
      source_location: stocking.source_location || '',
      notes: stocking.notes || '',
    })
    setError('')
    setSuccess('')
    setShowEditModal(true)
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const calculateBiomass = () => {
    if (!formData.fish_count || !formData.initial_abw) return 0

    const count = parseFloat(formData.fish_count)
    const abw = parseFloat(formData.initial_abw)

    if (isNaN(count) || isNaN(abw)) return 0

    // Calculate biomass in kg (ABW in g / 1000 * count)
    return (abw / 1000) * count
  }

  const handleSubmitEdit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    try {
      if (!editingStocking) return

      // Validate input
      if (!formData.stocking_date) {
        throw new Error('Stocking date is required')
      }

      if (!formData.fish_count || parseFloat(formData.fish_count) <= 0) {
        throw new Error('Valid fish count is required')
      }

      if (!formData.initial_abw || parseFloat(formData.initial_abw) <= 0) {
        throw new Error('Valid average body weight is required')
      }

      // Calculate initial biomass
      const initial_biomass = calculateBiomass()

      // Prepare update data
      const updateData = {
        stocking_date: formData.stocking_date,
        fish_count: parseInt(formData.fish_count),
        initial_abw: parseFloat(formData.initial_abw),
        initial_biomass,
        source_location: formData.source_location || null,
        notes: formData.notes || null,
      }

      console.log('Updating stocking with data:', updateData)

      // Update stocking
      await updateStockingMutation(stockingPatchArgs(editingStocking.id, updateData))

      setSuccess('Stocking updated successfully')
      showToast('Stocking updated successfully', 'success')

      setTimeout(() => {
        setShowEditModal(false)
      }, 800)
    } catch (error) {
      console.error('Error updating stocking:', error)
      setError(errorMessage(error))
      showToast(errorMessage(error, 'Update failed'), 'error')
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteStocking) return
    setDeleting(true)
    try {
      await removeStocking({ id: deleteStocking.id || deleteStocking._id })
      showToast('Stocking deleted', 'success')
      setDeleteStocking(null)
    } catch (err) {
      showToast(errorMessage(err, 'Delete failed'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const idOf = (r) => r.id || r._id
  const stockingById = useMemo(() => new Map(stockings.map((st) => [String(idOf(st)), st])), [stockings])

  // Combined movement history (Paper 06): stockings, transfers and top-ups, newest first.
  const movements = useMemo(() => {
    const out = []
    for (const st of stockings) {
      out.push({
        key: `s-${idOf(st)}`,
        type: 'stocking',
        date: st.stocking_date,
        from: st.source_location || '',
        to: st.cage?.name || st.cage_name || '—',
        batch: st.batch_number,
        fish: st.fish_count,
        abw: st.initial_abw,
        status: st.status,
        href: `/stocking/${idOf(st)}/details`,
      })
    }
    for (const tp of topupsResult || []) {
      const parent = stockingById.get(String(tp.stocking_id))
      out.push({
        key: `t-${idOf(tp)}`,
        type: 'topup',
        date: tp.topup_date,
        from: tp.source_location || '',
        to: parent?.cage?.name || parent?.cage_name || '—',
        batch: parent?.batch_number || '—',
        fish: tp.fish_count,
        abw: tp.abw,
        status: tp.status,
        href: `/topup/${idOf(tp)}/details`,
      })
    }
    for (const tr of transfersResult || []) {
      out.push({
        key: `f-${tr.id}`,
        type: 'fish_transfer',
        date: tr.transferDate,
        from: tr.sourceCageName || '—',
        to: tr.destinationCageName || '—',
        batch: stockingById.get(String(tr.sourceStockingId))?.batch_number || '—',
        fish: tr.quantity,
        abw: tr.abw,
        status: tr.status,
        reversed: Boolean(tr.reversedAt),
      })
    }
    return out.sort((x, y) => String(y.date).localeCompare(String(x.date)))
  }, [stockings, topupsResult, transfersResult, stockingById])

  const pending = approvals?.all ?? []
  const tabs = [
    ...(canApprove
      ? [{ value: 'approvals', label: pending.length ? t('stocking.mgmt.tabApprovalsN', { count: pending.length }) : t('stocking.mgmt.tabApprovals') }]
      : []),
    { value: 'stockings', label: t('stocking.mgmt.tabStockings') },
    { value: 'transfers', label: t('stocking.mgmt.tabTransfers') },
    { value: 'topups', label: t('stocking.mgmt.tabTopups') },
  ]
  const activeTab = tabs.some((x) => x.value === tab) ? tab : tabs[0].value

  const routeCell = (m) => (
    <span className="whitespace-nowrap">
      {m.from ? (
        <>
          {m.from}
          <span className="px-1.5 text-faint" aria-hidden>
            →
          </span>
          <span className="sr-only">{t('stocking.to')}</span>
        </>
      ) : null}
      {m.to}
    </span>
  )
  const movementColumns = (withType) => [
    {
      key: 'date',
      header: t('stocking.col.date'),
      width: 110,
      render: (m) => <span className="whitespace-nowrap tabular-nums">{formatDate(m.date)}</span>,
    },
    ...(withType
      ? [{ key: 'type', header: t('stocking.col.type'), width: 120, render: (m) => <MovementTypePill type={m.type} /> }]
      : []),
    { key: 'route', header: t('stocking.col.fromTo'), render: routeCell },
    { key: 'batch', header: t('stocking.col.batch'), render: (m) => <span className="whitespace-nowrap">{m.batch}</span> },
    { key: 'fish', header: t('stocking.col.fish'), align: 'right', render: (m) => formatNumber(m.fish) },
    { key: 'abw', header: t('stocking.col.abw'), align: 'right', render: (m) => `${formatNumber(m.abw, { decimals: 1 })} g` },
    { key: 'status', header: t('stocking.col.status'), render: (m) => <MovementStatus status={m.status} reversed={m.reversed} /> },
  ]
  const historyRows = (type) => {
    const q = historySearch.trim().toLowerCase()
    return movements.filter(
      (m) =>
        (!type || m.type === type) &&
        (!q || [m.from, m.to, m.batch].some((v) => String(v || '').toLowerCase().includes(q))),
    )
  }
  const onMovementClick = (m) => {
    if (m.href) router.push(m.href)
    else if (m.type === 'fish_transfer') router.push('/fish-transfers')
  }

  const sortHeader = (field, label) => (
    <button
      type="button"
      onClick={() => handleSort(field)}
      className="inline-flex items-center gap-1 uppercase tracking-[inherit] hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan rounded-sm"
      aria-sort={sortField === field ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {label}
      {sortField === field && (
        <ChevronDown className={`h-3.5 w-3.5 ${sortDirection === 'desc' ? 'rotate-180' : ''}`} aria-hidden />
      )}
    </button>
  )
  const stockingColumns = [
    {
      key: 'batch',
      header: sortHeader('batch_number', t('stocking.col.batch')),
      render: (st) => (
        <span className="whitespace-nowrap">
          <span className="font-semibold">{st.batch_number}</span>
          {st.species ? <span className="block text-xs text-muted">{st.species.replace(/_/g, ' ')}</span> : null}
        </span>
      ),
    },
    { key: 'cage', header: sortHeader('cage_name', t('stocking.col.cage')), render: (st) => st.cage?.name || st.cage_name || '—' },
    {
      key: 'date',
      header: sortHeader('stocking_date', t('stocking.col.date')),
      render: (st) => <span className="whitespace-nowrap tabular-nums">{formatDate(st.stocking_date)}</span>,
    },
    { key: 'fish', header: sortHeader('fish_count', t('stocking.col.fish')), align: 'right', render: (st) => formatNumber(st.fish_count) },
    {
      key: 'abw',
      header: sortHeader('initial_abw', t('stocking.col.abw')),
      align: 'right',
      render: (st) => `${formatNumber(st.initial_abw, { decimals: 1 })} g`,
    },
    {
      key: 'biomass',
      header: sortHeader('initial_biomass', t('stocking.col.biomass')),
      align: 'right',
      render: (st) => `${formatNumber(st.initial_biomass, { decimals: 1 })} kg`,
    },
    { key: 'source', header: t('stocking.col.source'), render: (st) => <span className="text-muted">{st.source_location || '—'}</span> },
    { key: 'status', header: t('stocking.col.status'), render: (st) => <MovementStatus status={st.status} /> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('stocking.col.actions')}</span>,
      align: 'right',
      render: (stocking) => (
        <div className="flex justify-end gap-1">
          {/* Approved stockings: admin only (backend). */}
          {(isAdmin || stocking.status !== 'approved') && (
            <button
              type="button"
              onClick={() => handleEditStocking(stocking)}
              className={ICON_BTN}
              title={t('stocking.mgmt.edit')}
              aria-label={t('stocking.mgmt.edit')}
            >
              <Edit className="w-4 h-4" aria-hidden />
            </button>
          )}
          {isAdmin && stocking.status !== 'approved' && (
            <button
              type="button"
              onClick={() => setDeleteStocking(stocking)}
              className={`${ICON_BTN} hover:text-alert`}
              title={t('stocking.mgmt.delete')}
              aria-label={t('stocking.mgmt.delete')}
            >
              <Trash2 className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>
      ),
    },
  ]
  const selectClass =
    'h-8 rounded-pill border border-line bg-surface px-3 text-[13px] leading-4 text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

  return (
    <Layout
      title={t('stocking.mgmt.title')}
      eyebrow={t('stocking.mgmt.eyebrow')}
      actions={
        <>
          <HeaderAction icon={Plus} href="/stocking">
            {t('stocking.mgmt.newStocking')}
          </HeaderAction>
          <HeaderAction reverse icon={ArrowLeftRight} href="/fish-transfers" permission="production.transfer.request">
            {t('stocking.mgmt.newTransfer')}
          </HeaderAction>
        </>
      }
    >
      <div className="flex flex-col gap-6 sm:gap-7">
        <Tabs variant="page" label={t('stocking.mgmt.tabsLabel')} tabs={tabs} value={activeTab} onChange={setTab} />

        {activeTab === 'approvals' && (
          <>
            {approvals === undefined ? (
              <LoadingState />
            ) : pending.length === 0 ? (
              <Card>
                <EmptyState title={t('stocking.mgmt.noPending')} description={t('stocking.mgmt.noPendingBody')} />
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                {pending.map((rec) => (
                  <ApprovalCard
                    key={`${rec.type}-${rec.id}`}
                    record={rec}
                    canAct={rec.type === 'fish_transfer' ? canApproveTransfer : true}
                    busy={busyKey === `${rec.type}-${rec.id}`}
                    onApprove={() => approveRecord(rec)}
                    onReject={() => {
                      setRejecting(rec)
                      setRejectReason('')
                      setRejectError('')
                    }}
                  />
                ))}
              </div>
            )}
            <Table
              title={t('stocking.mgmt.history')}
              search={historySearch}
              onSearchChange={setHistorySearch}
              searchPlaceholder={t('stocking.mgmt.searchHistory')}
              columns={movementColumns(true)}
              rows={historyRows(null)}
              rowKey={(m) => m.key}
              onRowClick={onMovementClick}
              empty={t('stocking.mgmt.noMovements')}
            />
          </>
        )}

        {activeTab === 'stockings' &&
          (loading ? (
            <LoadingState label={t('stocking.mgmt.loading')} />
          ) : stockings.length === 0 ? (
            <Card>
              <EmptyState
                title={t('stocking.mgmt.emptyTitle')}
                description={t('stocking.mgmt.emptyBody')}
                action={
                  <Button href="/stocking">
                    <Plus className="w-4 h-4" aria-hidden />
                    {t('stocking.mgmt.newStocking')}
                  </Button>
                }
              />
            </Card>
          ) : (
            <Table
              title={t('stocking.mgmt.tabStockings')}
              search={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder={t('stocking.mgmt.searchStockings')}
              actions={
                <>
                  <label htmlFor="stocking-year" className="sr-only">
                    {t('stocking.mgmt.year')}
                  </label>
                  <select id="stocking-year" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className={selectClass}>
                    <option value="all">{t('stocking.mgmt.allYears')}</option>
                    {availableYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="stocking-cage" className="sr-only">
                    {t('stocking.col.cage')}
                  </label>
                  <select id="stocking-cage" value={cageFilter} onChange={(e) => setCageFilter(e.target.value)} className={selectClass}>
                    <option value="all">{t('stocking.mgmt.allCages')}</option>
                    {uniqueCages.map((cage) => (
                      <option key={cage.id} value={cage.id}>
                        {cage.name}
                      </option>
                    ))}
                  </select>
                </>
              }
              columns={stockingColumns}
              rows={filteredStockings}
              rowKey={(st) => idOf(st)}
              empty={t('stocking.mgmt.noMatch')}
            />
          ))}

        {(activeTab === 'transfers' || activeTab === 'topups') && (
          <Table
            title={activeTab === 'transfers' ? t('stocking.mgmt.tabTransfers') : t('stocking.mgmt.tabTopups')}
            search={historySearch}
            onSearchChange={setHistorySearch}
            searchPlaceholder={t('stocking.mgmt.searchHistory')}
            actions={
              activeTab === 'transfers' ? (
                <GhostButton size="sm" href="/fish-transfers">
                  {t('stocking.mgmt.openTransfers')}
                </GhostButton>
              ) : (
                <HeaderAction size="sm" icon={Plus} href="/topup" permission="production.stocking.request">
                  {t('stocking.mgmt.newTopup')}
                </HeaderAction>
              )
            }
            columns={movementColumns(false)}
            rows={historyRows(activeTab === 'transfers' ? 'fish_transfer' : 'topup')}
            rowKey={(m) => m.key}
            onRowClick={onMovementClick}
            empty={t('stocking.mgmt.noMovements')}
          />
        )}
      </div>

      {rejecting && (
        <Modal
          onClose={() => !rejectBusy && setRejecting(null)}
          dismissible={!rejectBusy}
          as="form"
          onSubmit={(e) => {
            e.preventDefault()
            rejectRecord()
          }}
          title={t('stocking.mgmt.rejectTitle', { batch: rejecting.batchNumber })}
          bodyClassName="space-y-4"
          footer={
            <>
              <Button type="button" variant="secondary" disabled={rejectBusy} onClick={() => setRejecting(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="danger" disabled={rejectBusy}>
                {t('stocking.reject')}
              </Button>
            </>
          }
        >
          {rejectError && (
            <p role="alert" className="text-sm text-alert">
              {rejectError}
            </p>
          )}
          <Field label={t('stocking.mgmt.rejectReason')} htmlFor="reject-reason" required>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              required
            />
          </Field>
        </Modal>
      )}

      {/* Edit Stocking Modal */}
      {showEditModal && editingStocking && (
        <Modal
          onClose={() => setShowEditModal(false)}
          as="form"
          onSubmit={handleSubmitEdit}
          title={`Edit stocking ${editingStocking.batch_number}`}
          bodyClassName="space-y-4"
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowEditModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save changes</Button>
            </>
          }
        >
          {error && (
            <div className="rounded-input border border-[var(--pill-red-border)] bg-[color-mix(in_oklab,var(--alert)_8%,transparent)] p-3 text-sm text-alert">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-input border border-[var(--pill-green-border)] bg-[color-mix(in_oklab,var(--good)_8%,transparent)] p-3 text-sm text-good">
              {success}
            </div>
          )}

          <Field label="Stocking date" htmlFor="stocking-stocking-date" required>
            <Input
              id="stocking-stocking-date"
              type="date"
              name="stocking_date"
              value={formData.stocking_date}
              onChange={handleChange}
              required
            />
          </Field>

          <Field label="Fish count" htmlFor="stocking-fish-count" required>
            <Input
              id="stocking-fish-count"
              type="number"
              name="fish_count"
              value={formData.fish_count}
              onChange={handleChange}
              min="1"
              required
            />
          </Field>

          <Field label="Initial ABW (g)" htmlFor="stocking-initial-abw-g" required>
            <Input
              id="stocking-initial-abw-g"
              type="number"
              name="initial_abw"
              value={formData.initial_abw}
              onChange={handleChange}
              step="0.1"
              min="0.1"
              required
            />
          </Field>

          <Field
            label="Initial biomass (kg)"
            htmlFor="stocking-biomass"
            hint="Worked out as (ABW / 1000) × fish count"
          >
            <Input
              id="stocking-biomass"
              type="text"
              value={calculateBiomass().toFixed(2)}
              className="bg-surface-2 tabular-nums"
              readOnly
            />
          </Field>

          <div className="space-y-1.5">
            <p className="block text-[13px] font-medium text-muted">
              Source location
            </p>
            <FarmLocationSelect
              name="source_location"
              value={formData.source_location}
              onChange={handleChange}
              valueKind="name"
              syncWithHeader={false}
            />
          </div>

          <Field label="Notes" htmlFor="stocking-notes">
            <Textarea
              id="stocking-notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={3}
              placeholder="Optional notes"
            />
          </Field>
        </Modal>
      )}

      {deleteStocking && (
        <Modal
          onClose={() => setDeleteStocking(null)}
          dismissible={!deleting}
          role="alertdialog"
          title="Delete stocking"
          icon={<AlertTriangle className="w-6 h-6 text-alert" />}
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={deleting}
                onClick={() => setDeleteStocking(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={deleting}
                onClick={handleConfirmDelete}
              >
                {deleting ? 'Deleting…' : 'Delete stocking'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted mb-5">
            Delete batch{' '}
            <span className="font-semibold text-text">
              {deleteStocking.batch_number || deleteStocking.batchNumber}
            </span>
            ? Only pending or rejected stockings can be deleted.
          </p>
        </Modal>
      )}
    </Layout>
  )
}
