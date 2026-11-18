import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { formatDate } from '../lib/format'
import { Button, Field, FormCard, Textarea } from './ui'

function dayOf(ms) {
  return ms ? formatDate(new Date(ms).toISOString().slice(0, 10)) : ''
}

/** Ask for my own account to be deleted (ENT-005). */
export default function AccountDeletionCard() {
  const requests = useQuery(api.governance.myRequests, {})
  const request = useMutation(api.governance.requestAccountDeletion)
  const cancel = useMutation(api.governance.cancelRequest)
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const open = (requests || []).find(
    (r) => r.kind === 'account_deletion' && ['requested', 'approved', 'in_progress'].includes(r.status),
  )

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormCard title="Delete my account" subtitle="Your name, email and phone are removed; records you entered stay with the farm.">
      <div className="space-y-3 text-sm">
        {open ? (
          <>
            <p>
              {open.status === 'requested' && 'Your request is waiting for review.'}
              {open.status === 'approved' &&
                `Approved. Your account will be deleted after ${dayOf(open.graceEndsAt)}; you can still cancel until then.`}
              {open.status === 'in_progress' && 'Your account is being deleted.'}
            </p>
            {open.status !== 'in_progress' && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => cancel({ requestId: open.id }))}>
                Cancel the request
              </Button>
            )}
          </>
        ) : confirming ? (
          <>
            <Field label="Reason (optional)" htmlFor="account-delete-reason">
              <Textarea id="account-delete-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await request({ reason: reason || undefined })
                    setConfirming(false)
                  })
                }
              >
                Request deletion
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep my account
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted">After approval there is a 30-day grace period before anything is removed.</p>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
              Ask to delete my account
            </Button>
          </>
        )}
        {error && <p className="text-signal">{error}</p>}
      </div>
    </FormCard>
  )
}
