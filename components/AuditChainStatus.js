import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { formatDateTime } from '../lib/format'
import { useT } from '../lib/i18n/context'
import { GhostButton } from './ui'

const TONE = { ok: 'text-good', broken: 'text-alert', running: 'text-sky-ink [html[data-theme=light]_&]:text-[#1562D6]' }
/** Ring colours from the Paper 47 banner: intact #2E5A3E (light #A7DDB8). */
const RING = {
  ok: 'border-[#2E5A3E] [html[data-theme=light]_&]:border-[#A7DDB8]',
  broken: 'border-[var(--pill-red-border)]',
  running: 'border-[#1F3E6E] [html[data-theme=light]_&]:border-[#B9D3F5]',
}

function shortHash(hash) {
  if (!hash) return null
  return hash.length > 10 ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : hash
}

/** Tamper-evidence status of the organization's audit log (TRACE-007, Paper 47 chain banner). */
export default function AuditChainStatus() {
  const t = useT()
  const status = useQuery(api.audit.chainStatus, {})
  const verify = useMutation(api.audit.verifyChain)
  const [error, setError] = useState('')
  if (!status) return null
  const latest = status.latest
  const Icon = latest?.status === 'broken' ? ShieldAlert : ShieldCheck
  const headline = !latest
    ? t('settingsUi.audit.chain.notChecked')
    : latest.status === 'running'
      ? t('settingsUi.audit.chain.running', { count: latest.checkedCount.toLocaleString() })
      : latest.status === 'ok'
        ? t('settingsUi.audit.chain.ok', { count: latest.checkedCount.toLocaleString() })
        : t('settingsUi.audit.chain.broken', { seq: latest.brokenAtSeq ?? '—' })
  const hash = shortHash(status.headHash)

  return (
    <section
      aria-label={t('settingsUi.audit.chain.label')}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface px-5 py-[22px] shadow-[var(--shadow-card)] sm:px-[26px]"
    >
      <div className="flex flex-wrap items-center gap-5">
        <span
          aria-hidden
          className={`flex size-11 shrink-0 items-center justify-center rounded-full border ${RING[latest?.status] || 'border-line-strong'} ${TONE[latest?.status] || 'text-muted'}`}
        >
          <Icon size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p role="status" className="text-[15px] font-semibold leading-[18px] text-text">
            {headline}
          </p>
          {/* Paper 47: the whole line is sky on dark; on light it is muted with a sky hash. */}
          <p className="text-[13px] leading-4 text-sky-ink [html[data-theme=light]_&]:text-muted">
            {latest?.finishedAt ? t('settingsUi.audit.chain.lastCheck', { time: formatDateTime(latest.finishedAt) }) : null}
            {latest?.finishedAt ? ' · ' : ''}
            {t('settingsUi.audit.chain.length', { count: status.chainLength.toLocaleString() })}
            {hash && (
              <>
                {' · '}
                {t('settingsUi.audit.chain.head')} <span className="font-geist [html[data-theme=light]_&]:text-[#1562D6]">{hash}</span>
              </>
            )}
          </p>
          {latest?.status === 'broken' && latest.reason && <p className="text-[13px] leading-4 text-alert">{latest.reason}</p>}
          {status.unchainedCount > 0 && (
            <p className="text-[13px] leading-4 text-faint">
              {t('settingsUi.audit.chain.unchained', {
                count: `${status.unchainedCount.toLocaleString()}${status.unchainedMore ? '+' : ''}`,
              })}
            </p>
          )}
        </div>
        <GhostButton
          disabled={latest?.status === 'running'}
          onClick={async () => {
            setError('')
            try {
              await verify({})
            } catch (err) {
              setError(errorMessage(err))
            }
          }}
        >
          {t('settingsUi.audit.chain.verify')}
        </GhostButton>
      </div>
      {error && (
        <p role="alert" className="text-[13px] leading-4 text-alert">
          {error}
        </p>
      )}
    </section>
  )
}
