import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { formatDate, formatDateTime } from '../lib/format'
import { usePermissions } from '../hooks/usePermission'
import { Button, Field, FormCard, Textarea } from './ui'

const EXPORT_STATUS = {
  queued: 'Queued',
  running: 'Preparing',
  ready: 'Ready',
  failed: 'Failed',
  expired: 'Expired',
}

const REQUEST_STATUS = {
  requested: 'Waiting for platform review',
  approved: 'Approved',
  in_progress: 'Deleting',
  completed: 'Deleted',
  rejected: 'Declined',
  cancelled: 'Cancelled',
}

function formatBytes(n) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function dayOf(ms) {
  return ms ? formatDate(new Date(ms).toISOString().slice(0, 10)) : ''
}

/**
 * Data and privacy for an organization (ENT-005): full export (zip of JSON
 * and CSV per table, kept 7 days) and the organization deletion request.
 */
export default function DataPrivacyCard() {
  const { can } = usePermissions()
  const canExport = can('org.data.export')
  const canDelete = can('org.data.delete')
  const exports = useQuery(api.governance.listExports, canExport ? {} : 'skip')
  const requests = useQuery(api.governance.myRequests, canDelete ? {} : 'skip')
  const requestExport = useMutation(api.governance.requestExport)
  const downloadUrl = useMutation(api.governance.exportDownloadUrl)
  const requestDeletion = useMutation(api.governance.requestOrgDeletion)
  const cancel = useMutation(api.governance.cancelRequest)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)

  if (!canExport && !canDelete) return null

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

  const download = (id) =>
    run(async () => {
      const url = await downloadUrl({ exportId: id })
      window.location.assign(url)
    })

  const orgRequest = (requests || []).find(
    (r) => r.kind === 'org_deletion' && ['requested', 'approved', 'in_progress'].includes(r.status),
  )

  return (
    <FormCard
      title="Data and privacy"
      subtitle="Download everything this organization has recorded, or ask for it to be deleted."
    >
      <div className="space-y-8">
        {canExport && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="font-medium text-chart-ink">Export all data</h4>
                <p className="text-sm text-muted">
                  A zip with a JSON and a CSV file per table. Passwords, keys and tokens are left out. Links work for 7 days.
                </p>
              </div>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => requestExport({}))}>
                Prepare export
              </Button>
            </div>
            {exports && exports.length > 0 && (
              <ul className="divide-y divide-foam-deep border border-foam-deep rounded-lg">
                {exports.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      {formatDateTime(e.createdAt)}
                      <span className="text-muted"> · {EXPORT_STATUS[e.status] || e.status}</span>
                      {e.sizeBytes != null && <span className="text-muted"> · {formatBytes(e.sizeBytes)}</span>}
                      {e.truncatedTables?.length > 0 && (
                        <span className="text-signal"> · cut short: {e.truncatedTables.join(', ')}</span>
                      )}
                      {e.error && <span className="text-signal"> · {e.error}</span>}
                    </span>
                    {e.status === 'ready' && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => download(e.id)}>
                        Download
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {canDelete && (
          <section className="space-y-3 border-t border-foam-deep pt-6">
            <h4 className="font-medium text-chart-ink">Delete this organization</h4>
            {orgRequest ? (
              <div className="space-y-2 text-sm">
                <p>
                  {REQUEST_STATUS[orgRequest.status]}
                  {orgRequest.graceEndsAt && ` · data will be deleted after ${dayOf(orgRequest.graceEndsAt)}`}
                </p>
                {orgRequest.status === 'requested' && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => cancel({ requestId: orgRequest.id }))}>
                    Withdraw request
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  The platform team reviews the request. Once approved, nobody can sign in to this organization, and after 30 days
                  its farm records are deleted. The audit log is kept for one more year, then deleted too. Export your data first.
                </p>
                {confirming ? (
                  <div className="space-y-3">
                    <Field label="Reason (optional)" htmlFor="org-delete-reason">
                      <Textarea id="org-delete-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await requestDeletion({ reason: reason || undefined })
                            setConfirming(false)
                          })
                        }
                      >
                        Request deletion
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                        Keep the organization
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
                    Ask to delete the organization
                  </Button>
                )}
              </div>
            )}
          </section>
        )}

        {error && <p className="text-sm text-signal">{error}</p>}
      </div>
    </FormCard>
  )
}
