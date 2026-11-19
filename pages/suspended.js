import { useEffect } from 'react'
import { useRouter } from 'next/router'
import BareShell from '../components/billing/BareShell'
import Link from 'next/link'
import { Card } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'

/** Where members of a suspended organization land (PLAT-104). */
export default function SuspendedPage() {
  const { accessState, user } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (user && accessState === 'ok') router.replace('/dashboard')
  }, [user, accessState, router])
  return (
    <BareShell title="Access suspended">
      <Card className="max-w-xl">
        <p className="text-chart-ink">
          Your organization&apos;s access to PBA Farm is suspended, so its farm data is unavailable for now. Nothing has been
          deleted.
        </p>
        <p className="text-sm text-muted mt-3">
          If you are the owner, open Billing to see what is owed and how to pay. Access returns as soon as payment is recorded.
          Otherwise, contact your organization&apos;s owner or our support team.
        </p>
        <div className="mt-5">
          {/* Plain link: permission-aware buttons hide while the app's permission query is paused. */}
          <Link
            href="/billing"
            className="inline-flex items-center rounded-lg bg-chart-ink text-white px-4 min-h-11 text-sm font-medium"
          >
            Open billing
          </Link>
        </div>
      </Card>
    </BareShell>
  )
}
