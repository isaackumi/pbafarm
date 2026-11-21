import { useState } from 'react'
import { ErrorGlyph, GradientButton } from '../ui'
import { useT } from '../../lib/i18n/context'
import { monitoringEnabled } from '../../lib/monitoring'
import { SystemCard, SystemPage } from './StateCard'

/** Paper 62 error-id chip: 6/12 padding, Geist Mono 12/16 on surface-2, 12px copy glyph. */
function ErrorCode({ code }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(code).then(
      () => setCopied(true),
      () => {},
    )
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? t('system.error.codeCopied') : t('system.error.copyCode', { code })}
      title={copied ? t('system.error.codeCopied') : undefined}
      className="inline-flex items-center gap-2 rounded-pill bg-surface-2 px-3 py-1.5 text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
    >
      <span className="font-geist text-xs leading-4">{code}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0" aria-hidden>
        {copied ? (
          <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />
          </>
        )}
      </svg>
    </button>
  )
}

/**
 * Paper 62 _error card (HMM-0 / KRK-0): 64px alert glyph, "Something went
 * wrong", "Your entries are safe offline. We've been notified.", the error
 * id chip and a sky-ring "Try again". "We've been notified" only shows when
 * error reporting is on.
 */
export function ErrorCard({ title, description, errorId, onRetry, className = '' }) {
  const t = useT()
  const body =
    description || (monitoringEnabled() ? `${t('system.error.body')} ${t('system.error.notified')}` : t('system.error.body'))
  return (
    <SystemCard className={`min-h-[400px] ${className}`}>
      <ErrorGlyph />
      <div role="alert" className="flex flex-col items-center gap-2">
        <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-text">{title || t('system.error.title')}</h1>
        <p className="max-w-sm text-[14px] leading-5 text-muted">{body}</p>
      </div>
      {errorId && <ErrorCode code={errorId} />}
      <GradientButton ring="sky" size="cta" onClick={onRetry || (() => window.location.reload())}>
        {t('ui.tryAgain')}
      </GradientButton>
    </SystemCard>
  )
}

/** The error card centred on the page (pages/_error.js and the app's ErrorBoundary). */
export default function ErrorState({ className = 'min-h-[60vh]', ...props }) {
  return (
    <SystemPage className={className}>
      <ErrorCard {...props} />
    </SystemPage>
  )
}
