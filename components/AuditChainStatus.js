import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { formatDateTime } from '../lib/format'
import { useT } from '../lib/i18n/context'
import { GhostButton } from './ui'

const TONE = { ok: 'var(--good)', broken: 'var(--alert)', running: 'var(--cyan)' }

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
  const color = TONE[latest?.status] || 'var(--muted)'
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
      className="flex flex-col gap-3 rounded-card border border-line bg-surface px-5 py-5 shadow-[var(--shadow-card)] sm:px-[26px]"
    >
      <div className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-full border"
          style={{ borderColor: `color-mix(in oklab, ${color} 45%, transparent)`, color }}
        >
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p role="status" className="text-[17px] font-medium leading-[22px] text-text">
            {headline}
          </p>
          <p className="mt-1 text-[14px] leading-[18px] text-muted">
            {latest?.finishedAt ? t('settingsUi.audit.chain.lastCheck', { time: formatDateTime(latest.finishedAt) }) : null}
            {latest?.finishedAt ? ' · ' : ''}
            {t('settingsUi.audit.chain.length', { count: status.chainLength.toLocaleString() })}
            {hash && (
              <>
                {' · '}
                {t('settingsUi.audit.chain.head')} <span className="font-mono text-[13px] text-pearl-cyan">{hash}</span>
              </>
            )}
          </p>
          {latest?.status === 'broken' && latest.reason && <p className="mt-1 text-[13px] leading-4 text-alert">{latest.reason}</p>}
          {status.unchainedCount > 0 && (
            <p className="mt-1 text-[13px] leading-4 text-faint">
              {t('settingsUi.audit.chain.unchained', {
                count: `${status.unchainedCount.toLocaleString()}${status.unchainedMore ? '+' : ''}`,
              })}
            </p>
          )}
        </div>
        <GhostButton
          size="lg"
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
