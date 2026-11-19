import React, { useMemo, useState } from 'react'
import { useMutation, usePaginatedQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import FishTransferForm from '../components/FishTransferForm'
import MultiTransferForm from '../components/MultiTransferForm'
import { useRouter } from 'next/router'
import { GhostButton, GradientButton, LoadingState, Table, Tabs } from '../components/ui'
import MovementStatus from '../components/MovementStatus'
import { formatDate, formatNumber } from '../lib/format'
import { useT } from '../lib/i18n/context'
import { List } from 'lucide-react'
import { errorMessage } from '../lib/errorMessage'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { usePermission } from '../hooks/usePermission'

function FishTransfersContent() {
  const t = useT()
  const { user, hasRole } = useAuth()
  const { showToast } = useToast()
  const [statusFilter, setStatusFilter] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  // Paginated (PLAT-001): newest first, 50 at a time, "Load more" below.
  const {
    results: transfers,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    api.fishTransfers.listFishTransfersPage,
    user ? (statusFilter ? { status: statusFilter } : {}) : 'skip',
    { initialNumItems: 50 },
  )
  const approveTransfer = useMutation(api.fishTransfers.approveFishTransfer)
  const rejectTransfer = useMutation(api.fishTransfers.rejectFishTransfer)
  const reverseTransfer = useMutation(api.fishTransfers.reverseFishTransfer)
  const router = useRouter()
  const sourceParam = typeof router.query.source === 'string' ? router.query.source : ''
  const [mode, setMode] = useState('single')
  const [busyId, setBusyId] = useState(null)

  const rows = useMemo(() => transfers || [], [transfers, refreshKey])
  const isAdmin = usePermission('production.transfer.approve')

  const onApprove = async (id) => {
    setBusyId(id)
    try {
      await approveTransfer({ id })
      showToast('success', 'Transfer approved')
      setRefreshKey((k) => k + 1)
    } catch (e) {
      showToast('error', e?.message || 'Approve failed')
    } finally {
      setBusyId(null)
    }
  }

  const onReject = async (id) => {
    const reason = window.prompt('Rejection reason (optional):') ?? ''
    setBusyId(id)
    try {
      await rejectTransfer({ id, reason: reason || undefined })
      showToast('success', 'Transfer rejected')
      setRefreshKey((k) => k + 1)
    } catch (e) {
      showToast('error', e?.message || 'Reject failed')
    } finally {
      setBusyId(null)
    }
  }

  const onReverse = async (row) => {
    const reason = window.prompt(
      `Reverse the transfer of ${(row.quantity || 0).toLocaleString()} fish from ${row.sourceCageName} to ${row.destinationCageName}? Give a reason:`,
    )
    if (!reason || !reason.trim()) return
    setBusyId(row.id)
    try {
      await reverseTransfer({ id: row.id, reason: reason.trim() })
      showToast('success', 'Transfer reversed')
      setRefreshKey((k) => k + 1)
    } catch (e) {
      showToast('error', errorMessage(e, 'Reverse failed'))
    } finally {
      setBusyId(null)
    }
  }

  const columns = [
    {
      key: 'date',
      header: t('stocking.col.date'),
      width: 110,
      render: (row) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.transferDate)}</span>,
    },
    {
      key: 'route',
      header: t('stocking.col.fromTo'),
      render: (row) => (
        <span className="whitespace-nowrap">
          <span className="font-semibold">{row.sourceCageName || '—'}</span>
          <span className="px-1.5 text-faint" aria-hidden>
            →
          </span>
          <span className="sr-only">{t('stocking.to')}</span>
          <span className="font-semibold">{row.destinationCageName || '—'}</span>
        </span>
      ),
    },
    { key: 'qty', header: t('stocking.col.fish'), align: 'right', render: (row) => formatNumber(row.quantity || 0) },
    {
      key: 'abw',
      header: t('stocking.col.abw'),
      align: 'right',
      render: (row) => `${formatNumber(row.abw || 0, { decimals: 1 })} g`,
    },
    {
      key: 'type',
      header: t('stocking.col.type'),
      render: (row) => <span className="capitalize text-muted">{row.transferType}</span>,
    },
    {
      key: 'status',
      header: t('stocking.col.status'),
      render: (row) => <MovementStatus status={row.status} reversed={Boolean(row.reversedAt)} />,
    },
  ]
  if (isAdmin) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">{t('stocking.col.actions')}</span>,
      align: 'right',
      render: (row) =>
        row.status === 'pending_approval' ? (
          <div className="inline-flex gap-2">
            <GhostButton size="sm" disabled={busyId === row.id} onClick={() => onReject(row.id)}>
              {t('stocking.reject')}
            </GhostButton>
            <GradientButton
              variant="solid"
              size="sm"
              disabled={busyId === row.id}
              onClick={() => onApprove(row.id)}
            >
              {t('stocking.approve')}
            </GradientButton>
          </div>
        ) : row.status === 'approved' && !row.reversedAt ? (
          <GhostButton size="sm" disabled={busyId === row.id} onClick={() => onReverse(row)}>
            {t('stocking.reverse')}
          </GhostButton>
        ) : (
          <span className="text-faint">—</span>
        ),
    })
  }

  return (
    <Layout
      title={t('stocking.transfers.title')}
      eyebrow={t('stocking.transfers.eyebrow')}
      actions={
        <GradientButton reverse icon={List} href="/stocking-management">
          {t('stocking.transfers.allMovements')}
        </GradientButton>
      }
    >
      <div className="flex w-full max-w-5xl flex-col gap-6 sm:gap-7" data-tour="page-fish-transfers">
        <p className="max-w-2xl text-sm text-muted">{t('stocking.transfers.description')}</p>
        {isAdmin && (
          <div className="inline-flex w-fit rounded-pill border border-line bg-bg p-1">
            <Tabs
              variant="chip"
              label={t('stocking.transfers.modeLabel')}
              tabs={[
                { value: 'single', label: t('stocking.transfers.single') },
                { value: 'multi', label: t('stocking.transfers.multi') },
              ]}
              value={mode}
              onChange={setMode}
            />
          </div>
        )}
        {isAdmin && mode === 'multi' ? (
          <MultiTransferForm initialSourceId={sourceParam} onCreated={() => setRefreshKey((k) => k + 1)} />
        ) : (
          <FishTransferForm onCreated={() => setRefreshKey((k) => k + 1)} />
        )}

        {pageStatus === 'LoadingFirstPage' ? (
          <LoadingState />
        ) : (
          <div className="flex flex-col gap-3">
            <Table
              title={t('stocking.transfers.history')}
              tabsLabel={t('stocking.transfers.filterStatus')}
              tabs={[
                { value: '', label: t('stocking.filter.all') },
                { value: 'pending_approval', label: t('stocking.status.pending_approval') },
                { value: 'approved', label: t('stocking.status.approved') },
                { value: 'rejected', label: t('stocking.status.rejected') },
              ]}
              tab={statusFilter}
              onTabChange={setStatusFilter}
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              empty={t('stocking.transfers.empty')}
            />
            {pageStatus === 'CanLoadMore' || pageStatus === 'LoadingMore' ? (
              <div className="flex justify-center">
                <GhostButton disabled={pageStatus === 'LoadingMore'} onClick={() => loadMore(50)}>
                  {pageStatus === 'LoadingMore' ? t('common.loading') : t('stocking.loadMore')}
                </GhostButton>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Layout>
  )
}

export default function FishTransfersPage() {
  return (
    <ProtectedRoute>
      <FishTransfersContent />
    </ProtectedRoute>
  )
}
