import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { formatDate, formatDateTime } from '../lib/format'
import { usePermissions } from '../hooks/usePermission'
import { GhostButton, Pill } from './ui'
import { DangerRow, FIELD, InlineError, SettingsCard, SettingsField, SettingsRow } from './settings'
import { useT } from '../lib/i18n/context'

const EXPORT_TONE = { queued: 'neutral', running: 'cyan', ready: 'green', failed: 'red', expired: 'neutral' }

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
/**
 * Data and privacy for an organization (ENT-005): full export (zip of JSON
 * and CSV per table, kept 7 days) and the organization deletion request.
 */
export default function DataPrivacyCard() {
  const t = useT()
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
    <SettingsCard title={t('settingsUi.privacy.title')}>
      <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">{t('settingsUi.privacy.subtitle')}</p>
      {canExport && (
        <>
          <SettingsRow label={t('settingsUi.privacy.exportTitle')} helper={t('settingsUi.privacy.exportHelper')}>
            <GhostButton disabled={busy} onClick={() => run(() => requestExport({}))}>
              {t('settingsUi.privacy.prepare')}
            </GhostButton>
          </SettingsRow>
          {exports && exports.length > 0 && (
            <ul className="mb-2 flex flex-col rounded-input border border-line" aria-label={t('settingsUi.privacy.exportsList')}>
              {exports.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 first:border-t-0">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] leading-4 text-text">
                    <span className="font-data">{formatDateTime(e.createdAt)}</span>
                    <Pill tone={EXPORT_TONE[e.status] || 'neutral'}>{t.or(`settingsUi.privacy.exportStatus.${e.status}`, e.status)}</Pill>
                    {e.sizeBytes != null && <span className="font-data text-muted">{formatBytes(e.sizeBytes)}</span>}
                    {e.truncatedTables?.length > 0 && (
                      <span className="text-alert">{t('settingsUi.privacy.truncated', { tables: e.truncatedTables.join(', ') })}</span>
                    )}
                    {e.error && <span className="text-alert">{e.error}</span>}
                  </span>
                  {e.status === 'ready' && (
                    <GhostButton size="sm" disabled={busy} onClick={() => download(e.id)}>
                      {t('settingsUi.privacy.download')}
                    </GhostButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {canDelete &&
        (orgRequest ? (
          <SettingsRow
            label={t('settingsUi.privacy.deleteTitle')}
            helper={
              orgRequest.graceEndsAt
                ? t('settingsUi.privacy.graceEnds', { date: dayOf(orgRequest.graceEndsAt) })
                : null
            }
          >
            <div className="flex items-center gap-2">
              <Pill tone={orgRequest.status === 'requested' ? 'amber' : 'red'}>
                {t(`settingsUi.privacy.requestStatus.${orgRequest.status}`)}
              </Pill>
              {orgRequest.status === 'requested' && (
                <GhostButton disabled={busy} onClick={() => run(() => cancel({ requestId: orgRequest.id }))}>
                  {t('settingsUi.privacy.withdraw')}
                </GhostButton>
              )}
            </div>
          </SettingsRow>
        ) : confirming ? (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <SettingsField label={t('settingsUi.privacy.reason')} htmlFor="org-delete-reason">
              <textarea id="org-delete-reason" className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} />
            </SettingsField>
            <div className="flex flex-wrap gap-2">
              <GhostButton
                tone="danger"
                style={{ borderColor: 'var(--pill-red-border)' }}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await requestDeletion({ reason: reason || undefined })
                    setConfirming(false)
                  })
                }
              >
                {t('settingsUi.privacy.requestDeletion')}
              </GhostButton>
              <GhostButton onClick={() => setConfirming(false)}>{t('settingsUi.privacy.keep')}</GhostButton>
            </div>
          </div>
        ) : (
          <DangerRow label={t('settingsUi.privacy.deleteTitle')} helper={t('settingsUi.privacy.deleteHelper')}>
            <GhostButton tone="danger" style={{ borderColor: 'var(--pill-red-border)' }} onClick={() => setConfirming(true)}>
              {t('settingsUi.privacy.ask')}
            </GhostButton>
          </DangerRow>
        ))}

      {error && <InlineError className="mt-2">{error}</InlineError>}
    </SettingsCard>
  )
}
