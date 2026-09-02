import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import { PageHeader, Button } from '../../../components/ui'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/Toast'
import { api } from '../../../convex/_generated/api'

function statusClass(status) {
  if (status === 'approved') return 'bg-kelp/15 text-kelp'
  if (status === 'rejected') return 'bg-signal/15 text-signal'
  if (status === 'pending_approval') return 'bg-amber-100 text-amber-900'
  return 'bg-foam-deep text-chart-ink'
}

function formatDate(value) {
  if (value == null) return '—'
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString()
}

function StockingDetails() {
  const router = useRouter()
  const { user, hasRole } = useAuth()
  const { showToast } = useToast()
  const id = typeof router.query.id === 'string' ? router.query.id : null

  const stocking = useQuery(
    api.stocking.getStocking,
    user && id ? { id } : 'skip',
  )
  const approveStocking = useMutation(api.stocking.approveStocking)
  const rejectStocking = useMutation(api.stocking.rejectStocking)

  const [processing, setProcessing] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')

  if (!id || stocking === undefined) {
    return (
      <Layout title="Stocking">
        <div className="flex justify-center items-center h-64 text-muted">
          Loading stocking details…
        </div>
      </Layout>
    )
  }

  if (stocking === null) {
    return (
      <Layout title="Stocking">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Stocking management', href: '/stocking-management' },
            { label: 'Not found' },
          ]}
        />
        <div className="text-center py-10">
          <p className="text-signal font-semibold">Stocking not found</p>
          <Button href="/approvals" className="mt-4">
            Back to approvals
          </Button>
        </div>
      </Layout>
    )
  }

  const canModerate =
    hasRole('admin') && stocking.status === 'pending_approval'

  const onApprove = async () => {
    setProcessing(true)
    try {
      await approveStocking({ id: stocking.id })
      showToast('success', 'Stocking approved')
    } catch (err) {
      showToast('error', err.message || 'Failed to approve')
    } finally {
      setProcessing(false)
    }
  }

  const onReject = async () => {
    if (!reason.trim()) {
      showToast('error', 'Provide a rejection reason')
      return
    }
    setProcessing(true)
    try {
      await rejectStocking({ id: stocking.id, reason: reason.trim() })
      showToast('success', 'Stocking rejected')
      setRejectOpen(false)
      setReason('')
    } catch (err) {
      showToast('error', err.message || 'Failed to reject')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <Layout title={`Stocking ${stocking.batch_number}`}>
      <div className="max-w-3xl space-y-6">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Approvals', href: '/approvals' },
            { label: stocking.batch_number || 'Stocking' },
          ]}
          description="Stocking request details"
          related={[
            { label: 'Approvals', href: '/approvals' },
            { label: 'Stocking management', href: '/stocking-management' },
            stocking.cage?.id
              ? { label: 'Cage', href: `/cages/${stocking.cage.id}` }
              : null,
          ].filter(Boolean)}
          actions={
            <Button href="/approvals" variant="secondary" size="sm">
              Back
            </Button>
          }
        />

        <div className="page-card p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-xl font-bold text-chart-ink">
              {stocking.batch_number}
            </h2>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold ${statusClass(
                stocking.status,
              )}`}
            >
              {String(stocking.status || '').replace(/_/g, ' ')}
            </span>
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted">Cage</dt>
              <dd className="font-semibold text-chart-ink">
                {stocking.cage?.name || '—'}
                {stocking.cage?.status ? ` (${stocking.cage.status})` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Stocking date</dt>
              <dd className="font-data text-chart-ink">
                {formatDate(stocking.stocking_date)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Fish count</dt>
              <dd className="font-data text-chart-ink">
                {Number(stocking.fish_count || 0).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Initial ABW</dt>
              <dd className="font-data text-chart-ink">
                {Number(stocking.initial_abw || 0).toFixed(1)} g
              </dd>
            </div>
            <div>
              <dt className="text-muted">Initial biomass</dt>
              <dd className="font-data text-chart-ink">
                {Number(stocking.initial_biomass || 0).toFixed(2)} kg
              </dd>
            </div>
            <div>
              <dt className="text-muted">Requested</dt>
              <dd className="font-data text-chart-ink">
                {formatDate(stocking.created_at)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Source location</dt>
              <dd className="text-chart-ink">{stocking.source_location || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted">Transfer supervisor</dt>
              <dd className="text-chart-ink">
                {stocking.transfer_supervisor || '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted">Notes</dt>
              <dd className="text-chart-ink whitespace-pre-wrap">
                {stocking.notes || '—'}
              </dd>
            </div>
          </dl>

          {canModerate && (
            <div className="flex flex-wrap gap-3 pt-2 border-t border-foam-deep">
              <Button onClick={onApprove} disabled={processing}>
                {processing ? 'Working…' : 'Approve stocking'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setRejectOpen(true)}
                disabled={processing}
              >
                Reject
              </Button>
            </div>
          )}
        </div>

        {(stocking.topups || []).length > 0 && (
          <div className="page-card p-6">
            <h3 className="font-semibold text-chart-ink mb-3">Related top-ups</h3>
            <ul className="space-y-2 text-sm">
              {stocking.topups.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-foam-deep/60 pb-2"
                >
                  <span>
                    {formatDate(t.topup_date)} ·{' '}
                    {Number(t.fish_count || 0).toLocaleString()} fish ·{' '}
                    {Number(t.abw || 0).toFixed(1)} g
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${statusClass(t.status)}`}>
                    {String(t.status || '').replace(/_/g, ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-chart-ink/40"
            onClick={() => !processing && setRejectOpen(false)}
          />
          <div className="relative bg-white rounded-2xl border border-foam-deep p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-chart-ink">Reject stocking</h3>
            <textarea
              className="w-full border border-input-border rounded-xl px-3 py-2 text-sm min-h-24"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for rejection"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setRejectOpen(false)}
                disabled={processing}
              >
                Cancel
              </Button>
              <Button onClick={onReject} disabled={processing}>
                Confirm reject
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

export default function StockingDetailsPage() {
  return (
    <ProtectedRoute>
      <StockingDetails />
    </ProtectedRoute>
  )
}
