import { useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'

/** Legacy route — stocking approvals live at /approvals */
function RedirectToApprovals() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/approvals')
  }, [router])
  return (
    <div className="flex min-h-screen items-center justify-center bg-foam text-muted text-sm">
      Redirecting to approvals…
    </div>
  )
}

export default function PendingApprovalPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <RedirectToApprovals />
    </ProtectedRoute>
  )
}
