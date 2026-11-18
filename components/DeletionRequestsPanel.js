import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { formatDate, formatDateTime } from '../lib/format'
import { Button, Card, CardHeader, EmptyState } from './ui'

const KIND = { org_deletion: 'Organization', account_deletion: 'Account' }
const STATUS = { requested: 'Waiting', approved: 'Approved, in grace period', in_progress: 'Deleting' }

/** Platform admins: decide organization and account deletion requests (ENT-005). */
export default function DeletionRequestsPanel() {
  const rows = useQuery(api.governance.platformListRequests, {})
  const decide = useMutation(api.governance.decideRequest)
  const cancel = useMutation(api.governance.platformCancelRequest)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const run = async (id, fn) => {
    setBusy(id)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader
        title="Deletion requests"
        subtitle="Approval starts a 30-day grace period; an approved organization is locked straight away."
      />
      {rows === undefined ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No open requests" />
      ) : (
        <ul className="divide-y divide-foam-deep">
          {rows.map((r) => (
            <li key={r.id} className="py-3 flex flex-wrap items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-chart-ink">
                  {KIND[r.kind]} · {r.kind === 'org_deletion' ? r.companyName : r.requesterLabel}
                </p>
                <p className="text-muted">
                  {r.requesterLabel} · {formatDateTime(r.requestedAt)} · {STATUS[r.status] || r.status}
                  {r.graceEndsAt && ` until ${formatDate(new Date(r.graceEndsAt).toISOString().slice(0, 10))}`}
                </p>
                {r.reason && <p className="text-muted mt-1">“{r.reason}”</p>}
              </div>
              <div className="flex gap-2">
                {r.status === 'requested' && (
                  <>
                    <Button size="sm" variant="danger" disabled={busy === r.id} onClick={() => run(r.id, () => decide({ requestId: r.id, approve: true }))}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => run(r.id, () => decide({ requestId: r.id, approve: false }))}>
                      Decline
                    </Button>
                  </>
                )}
                {r.status === 'approved' && (
                  <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => run(r.id, () => cancel({ requestId: r.id }))}>
                    Cancel and restore
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-signal mt-2">{error}</p>}
    </Card>
  )
}
