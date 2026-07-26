import { useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../../components/ProtectedRoute'

function RedirectFeedTypes() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/feed-types')
  }, [router])
  return (
    <div className="flex min-h-screen items-center justify-center bg-foam text-muted text-sm">
      Redirecting to feed types…
    </div>
  )
}

export default function CageFeedTypesPage() {
  return (
    <ProtectedRoute>
      <RedirectFeedTypes />
    </ProtectedRoute>
  )
}
