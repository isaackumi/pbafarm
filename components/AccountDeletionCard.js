import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { formatDate } from '../lib/format'
import { useT } from '../lib/i18n/context'
import { GhostButton } from './ui'
import { DangerRow, InlineError, FIELD, FIELD_LABEL } from './settings'

function dayOf(ms) {
  return ms ? formatDate(new Date(ms).toISOString().slice(0, 10)) : ''
}

/** Ask for my own account to be deleted (ENT-005); Paper 31 "Delete account" row. */
export default function AccountDeletionCard() {
  const t = useT()
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

  const helper = open
    ? open.status === 'requested'
      ? t('settingsUi.deletion.waiting')
      : open.status === 'approved'
        ? t('settingsUi.deletion.approved', { date: dayOf(open.graceEndsAt) })
        : t('settingsUi.deletion.inProgress')
    : t('settingsUi.deletion.helper')

  return (
    <>
      <DangerRow label={t('settingsUi.deletion.title')} helper={helper}>
        {open ? (
          open.status !== 'in_progress' && (
            <GhostButton disabled={busy} onClick={() => run(() => cancel({ requestId: open.id }))}>
              {t('settingsUi.deletion.cancelRequest')}
            </GhostButton>
          )
        ) : (
          !confirming && (
            <GhostButton tone="danger" style={{ borderColor: 'var(--pill-red-border)' }} onClick={() => setConfirming(true)}>
              {t('settingsUi.deletion.start')}
            </GhostButton>
          )
        )}
      </DangerRow>
      {!open && confirming && (
        <div className="flex flex-col gap-3 pt-4">
          <p className="text-[12px] leading-4 text-muted">{t('settingsUi.deletion.grace')}</p>
          <div>
            <label htmlFor="account-delete-reason" className={FIELD_LABEL}>
              {t('settingsUi.reasonOptional')}
            </label>
            <textarea
              id="account-delete-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`${FIELD} resize-y`}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <GhostButton onClick={() => setConfirming(false)}>{t('settingsUi.deletion.keep')}</GhostButton>
            <GhostButton
              tone="danger"
              style={{ borderColor: 'var(--pill-red-border)' }}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await request({ reason: reason || undefined })
                  setConfirming(false)
                })
              }
            >
              {t('settingsUi.deletion.request')}
            </GhostButton>
          </div>
        </div>
      )}
      <InlineError className="mt-3">{error}</InlineError>
    </>
  )
}
