import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import Link from 'next/link'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import { ArrowLeft } from 'lucide-react'
import { Card, GradientButton, LoadingState } from '../../../components/ui'
import MovementDetailPanel from '../../../components/MovementDetailPanel'
import { formatDate, formatDateTime, formatNumber } from '../../../lib/format'
import { useT } from '../../../lib/i18n/context'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/Toast'
import { api } from '../../../convex/_generated/api'
import { usePermission } from '../../../hooks/usePermission'

function TopupDetails() {
  const t = useT()
  const router = useRouter()
  const { user, hasRole } = useAuth()
  const canOverride = usePermission('production.stocking.approve')
  const { showToast } = useToast()
  const id = typeof router.query.id === 'string' ? router.query.id : null

  const topup = useQuery(api.stocking.getTopup, user && id ? { id } : 'skip')
  const approveTopup = useMutation(api.stocking.approveTopup)
  const rejectTopup = useMutation(api.stocking.rejectTopup)

  const [processing, setProcessing] = useState(false)
  const back = (
    <GradientButton reverse icon={ArrowLeft} href="/stocking-management">
      {t('stocking.detail.back')}
    </GradientButton>
  )

  if (!id || topup === undefined) {
    return (
      <Layout title={t('stocking.type.topup')} eyebrow={t('stocking.detail.eyebrow')} actions={back}>
        <LoadingState label={t('stocking.detail.loading')} />
      </Layout>
    )
  }

  if (topup === null) {
    return (
      <Layout title={t('stocking.detail.notFound')} eyebrow={t('stocking.detail.eyebrow')} actions={back}>
        <Card>
          <p className="text-sm text-muted">{t('stocking.detail.notFoundBody')}</p>
        </Card>
      </Layout>
    )
  }

  // Transfer-linked top-ups are approved or rejected through the transfer.
  const linkedToTransfer = Boolean(topup.transfer_id)
  const canModerate =
    canOverride && topup.status === 'pending_approval' && !linkedToTransfer
  const biomass = (Number(topup.fish_count || 0) * Number(topup.abw || 0)) / 1000

  const onApprove = async () => {
    setProcessing(true)
    try {
      await approveTopup({ id: topup.id })
      showToast('success', 'Top-up approved')
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
      await rejectTopup({ id: topup.id, reason: reason.trim() })
      showToast('success', 'Top-up rejected')
    } catch (err) {
      showToast('error', err.message || 'Failed to reject')
    } finally {
      setProcessing(false)
    }
  }

  const cageName = topup.cage?.name || '—'
  const batch = topup.stocking?.batch_number || '—'
  return (
    <Layout title={t('stocking.detail.topupTitle', { batch })} eyebrow={t('stocking.detail.eyebrow')} actions={back}>
      <div className="flex w-full max-w-4xl flex-col gap-6">
        <MovementDetailPanel
          kind={t('stocking.detail.topupRequest')}
          kindTone="neutral"
          meta={topup.created_at ? t('stocking.detail.requestedOn', { when: formatDateTime(topup.created_at) }) : null}
          status={topup.status}
          title={t('stocking.detail.topupHeadline', { fish: formatNumber(topup.fish_count || 0), cage: cageName })}
          from={{
            label: t('stocking.detail.fromSource'),
            value: topup.source_location || '—',
            sub: topup.transfer_supervisor || null,
            subTone: 'text-muted',
          }}
          to={{
            label: t('stocking.detail.toCage', { cage: cageName }),
            value: `+${formatNumber(topup.fish_count || 0)}`,
            sub: `${formatNumber(topup.abw || 0, { decimals: 1 })} g · ${formatNumber(biomass, { decimals: 2 })} kg`,
          }}
          facts={[
            {
              label: t('stocking.detail.parentBatch'),
              value: topup.stocking?.id ? (
                <Link
                  href={`/stocking/${topup.stocking.id}/details`}
                  className="text-pearl-cyan underline-offset-2 hover:underline"
                >
                  {batch}
                </Link>
              ) : (
                '—'
              ),
            },
            { label: t('stocking.detail.topupDate'), value: formatDate(topup.topup_date) },
            { label: t('stocking.detail.supervisor'), value: topup.transfer_supervisor || '—' },
            { label: t('stocking.detail.notes'), value: topup.notes || '—', wrap: true },
          ]}
          notice={
            linkedToTransfer && topup.status === 'pending_approval' ? (
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
          approveLabel={t('stocking.detail.approveTopup')}
          onApprove={onApprove}
          onReject={onReject}
        />
      </div>
    </Layout>
  )
}

export default function TopupDetailsPage() {
  return (
    <ProtectedRoute>
      <TopupDetails />
    </ProtectedRoute>
  )
}
