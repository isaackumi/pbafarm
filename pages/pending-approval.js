import { useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import { LoadingState } from '../components/ui'
import { useT } from '../lib/i18n/context'

/** Legacy route — stocking approvals live at /approvals */
function RedirectToApprovals() {
  const t = useT()
  const router = useRouter()
  useEffect(() => {
    router.replace('/approvals')
  }, [router])
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <LoadingState label={t('system.redirectApprovals')} />
    </div>
  )
}

export default function PendingApprovalPage() {
  return (
    <ProtectedRoute permission="production.stocking.approve">
      <RedirectToApprovals />
    </ProtectedRoute>
  )
}
