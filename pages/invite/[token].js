import { useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { Button } from '../../components/ui'
import { errorMessage } from '../../lib/errorMessage'

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  field_staff: 'Field staff',
  viewer: 'Viewer',
}

/** Accept an organization invite from its emailed link (ORG-003). */
export default function AcceptInvite() {
  const router = useRouter()
  const token = typeof router.query.token === 'string' ? router.query.token : ''
  const { user } = useAuth()
  const info = useQuery(api.memberships.inviteInfo, token ? { token } : 'skip')
  const verification = useQuery(api.emailVerification.status, user ? {} : 'skip')
  const accept = useMutation(api.memberships.acceptInvite)
  const decline = useMutation(api.memberships.declineInvite)
  const switchActive = useMutation(api.memberships.switchActive)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const here = `/invite/${token}`

  const onAccept = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await accept({ token })
      setDone(r)
    } catch (err) {
      setError(errorMessage(err, 'Could not accept the invite'))
    } finally {
      setBusy(false)
    }
  }

  const onDecline = async () => {
    setBusy(true)
    try {
      await decline({ token })
      router.push('/dashboard')
    } catch (err) {
      setError(errorMessage(err, 'Could not decline the invite'))
      setBusy(false)
    }
  }

  const openOrg = async () => {
    if (!done) return
    if (!done.activated) await switchActive({ companyId: done.companyId })
    router.push('/dashboard')
  }

  let body
  if (!token || info === undefined) {
    body = <p className="text-sm text-muted">Loading invite…</p>
  } else if (info === null) {
    body = <p className="text-sm text-chart-ink">This invite link is not valid. Ask for a new one.</p>
  } else if (done) {
    body = (
      <>
        <p className="text-sm text-chart-ink">You joined {info.companyName}.</p>
        <Button size="lg" className="w-full" onClick={openOrg}>
          Open {info.companyName}
        </Button>
      </>
    )
  } else if (info.state === 'expired') {
    body = <p className="text-sm text-chart-ink">This invite has expired. Ask {info.companyName} to send a new one.</p>
  } else if (info.state !== 'pending') {
    body = <p className="text-sm text-chart-ink">This invite has already been used or withdrawn.</p>
  } else if (!user) {
    const next = encodeURIComponent(here)
    body = (
      <>
        <p className="text-sm text-muted">
          Sign in as <span className="font-medium text-chart-ink">{info.email}</span> to accept.
          New here? Create an account with that email first.
        </p>
        <Button href={`/login?next=${next}`} size="lg" className="w-full">
          Sign in
        </Button>
        <Button href={`/signup?next=${next}`} size="lg" variant="secondary" className="w-full">
          Create account
        </Button>
      </>
    )
  } else if ((user.email || '').toLowerCase() !== info.email) {
    body = (
      <p className="text-sm text-chart-ink">
        This invite is for {info.email}, but you are signed in as {user.email}. Sign out and
        sign in with the invited email.
      </p>
    )
  } else if (verification && !verification.verified) {
    body = (
      <>
        <p className="text-sm text-muted">Confirm your email address before joining.</p>
        <Button href={`/verify-email?next=${encodeURIComponent(here)}`} size="lg" className="w-full">
          Verify email
        </Button>
      </>
    )
  } else {
    body = (
      <>
        <Button size="lg" className="w-full" disabled={busy} onClick={onAccept}>
          {busy ? 'Joining…' : `Join ${info.companyName}`}
        </Button>
        <Button size="lg" variant="ghost" className="w-full" disabled={busy} onClick={onDecline}>
          Decline
        </Button>
      </>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-foam px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <p className="font-display text-4xl font-medium text-chart-ink mb-2">PBA Farm</p>
          <h1 className="text-xl font-semibold text-chart-ink">
            {info ? `Join ${info.companyName}` : 'Organization invite'}
          </h1>
          {info && (
            <p className="mt-1 text-sm text-muted">
              Role: {ROLE_LABELS[info.roleKey] || info.roleKey}
            </p>
          )}
        </div>
        <div className="bg-surface border border-foam-deep rounded-xl px-6 py-8 shadow-sm space-y-4">
          {error && (
            <div role="alert" className="bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}
          {body}
        </div>
      </div>
    </div>
  )
}
