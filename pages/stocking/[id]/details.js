import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import Link from 'next/link'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import { ArrowLeft } from 'lucide-react'
import { Card, GradientButton, LoadingState } from '../../../components/ui'
import MovementDetailPanel from '../../../components/MovementDetailPanel'
import MovementStatus from '../../../components/MovementStatus'
import { formatDate, formatDateTime, formatNumber } from '../../../lib/format'
import { useT } from '../../../lib/i18n/context'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/Toast'
import { api } from '../../../convex/_generated/api'
import { usePermission } from '../../../hooks/usePermission'
import { CustomFieldsCard } from '../../../components/CustomFields'

function StockingDetails() {
  const t = useT()
  const router = useRouter()
  const { user, hasRole } = useAuth()
  const canOverride = usePermission('production.stocking.approve')
  const { showToast } = useToast()
  const id = typeof router.query.id === 'string' ? router.query.id : null

  const stocking = useQuery(
    api.stocking.getStocking,
    user && id ? { id } : 'skip',
  )
  const approveStocking = useMutation(api.stocking.approveStocking)
  const rejectStocking = useMutation(api.stocking.rejectStocking)

  const [processing, setProcessing] = useState(false)
  const back = (
    <GradientButton reverse icon={ArrowLeft} href="/stocking-management">
      {t('stocking.detail.back')}
    </GradientButton>
  )

  if (!id || stocking === undefined) {
    return (
      <Layout title={t('stocking.type.stocking')} eyebrow={t('stocking.detail.eyebrow')} actions={back}>
        <LoadingState label={t('stocking.detail.loading')} />
      </Layout>
    )
  }

  if (stocking === null) {
    return (
      <Layout title={t('stocking.detail.notFound')} eyebrow={t('stocking.detail.eyebrow')} actions={back}>
        <Card>
          <p className="text-sm text-muted">{t('stocking.detail.notFoundBody')}</p>
        </Card>
      </Layout>
    )
  }

  // Transfer-linked stockings are approved or rejected through the transfer.
  const linkedToTransfer = Boolean(stocking.transfer_id)
  const canModerate =
    canOverride &&
    stocking.status === 'pending_approval' &&
    !linkedToTransfer

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

  const onReject = async (reason) => {
    if (!reason.trim()) {
      showToast('error', 'Provide a rejection reason')
      return
    }
    setProcessing(true)
    try {
      await rejectStocking({ id: stocking.id, reason: reason.trim() })
      showToast('success', 'Stocking rejected')
    } catch (err) {
      showToast('error', err.message || 'Failed to reject')
    } finally {
      setProcessing(false)
    }
  }

  const cageName = stocking.cage?.name || '—'
  return (
    <Layout
      title={t('stocking.detail.stockingTitle', { batch: stocking.batch_number || '—' })}
      eyebrow={t('stocking.detail.eyebrow')}
      actions={back}
    >
      <div className="flex w-full max-w-4xl flex-col gap-6">
        <MovementDetailPanel
          kind={t('stocking.detail.stockingRequest')}
          kindTone="cyan"
          meta={t('stocking.detail.requestedOn', { when: formatDateTime(stocking.created_at) })}
          status={stocking.status}
          title={t('stocking.detail.stockingHeadline', {
            fish: formatNumber(stocking.fish_count || 0),
            cage: cageName,
          })}
          from={{
            label: t('stocking.detail.fromSource'),
            value: stocking.source_location || '—',
            sub: stocking.transfer_supervisor || null,
            subTone: 'text-muted',
          }}
          to={{
            label: t('stocking.detail.toCage', { cage: cageName }),
            value: `${formatNumber(stocking.fish_count || 0)}`,
            sub: `${formatNumber(stocking.initial_abw || 0, { decimals: 1 })} g · ${formatNumber(stocking.initial_biomass || 0, { decimals: 2 })} kg`,
          }}
          facts={[
            { label: t('stocking.col.batch'), value: stocking.batch_number },
            { label: t('stocking.detail.stockingDate'), value: formatDate(stocking.stocking_date) },
            {
              label: t('stocking.col.cage'),
              value: stocking.cage?.id ? (
                <Link href={`/cages/${stocking.cage.id}`} className="text-pearl-cyan hover:underline underline-offset-2">
                  {cageName}
                  {stocking.cage?.status ? ` (${stocking.cage.status})` : ''}
                </Link>
              ) : (
                cageName
              ),
            },
            { label: t('stocking.detail.supervisor'), value: stocking.transfer_supervisor || '—' },
            { label: t('stocking.detail.notes'), value: stocking.notes || '—', wrap: true },
          ]}
          notice={
            linkedToTransfer && stocking.status === 'pending_approval' ? (
              <p className="rounded-input border border-[var(--pill-amber-border)] bg-[color-mix(in_oklab,var(--warn)_8%,transparent)] p-4 text-sm text-text">
                {t('stocking.detail.linkedTransfer')}{' '}
                <Link href="/approvals" className="text-pearl-cyan underline-offset-2 hover:underline">
                  {t('stocking.detail.approvalsLink')}
                </Link>
              </p>
            ) : null
          }
          canModerate={canModerate}
          processing={processing}
          approveLabel={t('stocking.detail.approveStocking')}
          onApprove={onApprove}
          onReject={onReject}
        />

        {(stocking.topups || []).length > 0 && (
          <Card>
            <h3 className="mb-3 text-[17px] font-semibold leading-[22px] text-text">{t('stocking.detail.relatedTopups')}</h3>
            <ul className="flex flex-col text-sm">
              {stocking.topups.map((tp) => (
                <li
                  key={tp.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3 last:border-b-0"
                >
                  <a href={`/topup/${tp.id}/details`} className="text-text hover:text-pearl-cyan tabular-nums">
                    {formatDate(tp.topup_date)} · {t('stocking.detail.fishAbw', { fish: formatNumber(tp.fish_count || 0), abw: formatNumber(tp.abw || 0, { decimals: 1 }) })}
                  </a>
                  <MovementStatus status={tp.status} />
                </li>
              ))}
            </ul>
          </Card>
        )}

        <CustomFieldsCard
          entity="stockingHistory"
          recordId={stocking.id}
          values={stocking.custom}
          locationId={stocking.location_id}
          core={{ species: stocking.species, fishCount: stocking.fish_count }}
          editPermission="production.stocking.approve"
        />
      </div>
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
