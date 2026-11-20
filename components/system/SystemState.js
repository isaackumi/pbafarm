import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ErrorGlyph, GradientButton } from '../ui'
import { useT } from '../../lib/i18n/context'
import { monitoringEnabled } from '../../lib/monitoring'

/** Full-height centring for a system card (Paper 62 / P-SYSTEM). */
export function SystemPage({ children, className = 'min-h-screen' }) {
  return <div className={`flex items-center justify-center bg-bg px-4 py-10 ${className}`}>{children}</div>
}

/** Bordered surface card that holds one system state (20px radius, light-theme shadow). */
export function SystemCard({ eyebrow, children, className = '' }) {
  return (
    <section
      className={`relative flex w-full max-w-[560px] flex-col items-center justify-center gap-[18px] overflow-hidden rounded-card border border-line bg-surface p-8 text-center shadow-[var(--shadow-card)] ${className}`}
    >
      {eyebrow && <p className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">{eyebrow}</p>}
      {children}
    </section>
  )
}

const GHOST =
  'inline-flex items-center rounded-pill border border-line-strong px-[22px] py-[11px] text-sm leading-[18px] text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

/**
 * Paper 62 "Go home": on dark a lime pill (lime ring and fill, ink text); on
 * light the sky-gradient ring around a #0E1012 fill with white text. 11/22
 * padding, 14/18 semibold.
 */
export function GradientSolidLink({ href, onClick, children, className = '' }) {
  const inner = (
    <span className="block rounded-pill bg-lime px-[22px] py-[11px] text-[14px] font-semibold leading-[18px] text-ink transition-opacity group-hover:opacity-90 [[data-theme=light]_&]:bg-button [[data-theme=light]_&]:text-button-text">
      {children}
    </span>
  )
  const ring = `group inline-flex rounded-pill bg-lime p-[1.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-surface [[data-theme=light]_&]:[background-image:var(--gradient-sky)] ${className}`
  if (href) {
    return (
      <Link href={href} className={ring}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={ring}>
      {inner}
    </button>
  )
}

/** Wave lines along the 404 card's foot: line / surface-2 on dark, #D5D9DE on light. */
function Waves() {
  return (
    <svg viewBox="0 0 640 60" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-[60px] w-full" aria-hidden>
      <path d="M0 34c80-14 160 14 240 0s160-14 240 0 120 10 160 4" fill="none" className="stroke-line [[data-theme=light]_&]:stroke-[#D5D9DE]" strokeWidth="1.5" />
      <path d="M0 48c80-12 160 12 240 0s160-12 240 0 120 8 160 3" fill="none" className="stroke-surface-2 [[data-theme=light]_&]:stroke-[#D5D9DE]" strokeWidth="1.5" />
    </svg>
  )
}

/** Opens the header search (it listens for ⌘K / Ctrl+K). */
function openSearch() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }))
}

/** 404 card: gradient numerals, copy, home and search actions, wave lines. */
export function NotFoundCard({ homeHref = '/', showSearch = true }) {
  const t = useT()
  const [shortcut, setShortcut] = useState('⌘K')
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setShortcut('Ctrl K')
  }, [])
  return (
    <SystemCard eyebrow="404" className="min-h-[400px]">
      <p
        aria-hidden
        className="bg-clip-text text-[72px] font-semibold leading-[72px] tracking-[-0.05em] text-transparent sm:text-[96px] sm:leading-[96px]"
        style={{ backgroundImage: 'var(--gradient-brand)' }}
      >
        404
      </p>
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-[24px] font-semibold leading-[30px] tracking-[-0.02em] text-text">{t('system.notFound.title')}</h1>
        <p className="text-[14px] leading-5 text-muted">{t('system.notFound.body')}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2.5">
        <GradientSolidLink href={homeHref}>{t('system.notFound.home')}</GradientSolidLink>
        {showSearch && (
          <button type="button" onClick={openSearch} className={GHOST}>
            {t('system.notFound.search', { shortcut })}
          </button>
        )}
      </div>
      <Waves />
    </SystemCard>
  )
}

/** Paper 62 error-code chip: 12/16 Geist Mono on surface-2, copy glyph. */
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
      className="inline-flex items-center gap-2 rounded-pill bg-surface-2 px-3 py-1.5 text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
    >
      <span className="font-geist text-xs leading-4">{code}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0" aria-hidden>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />
      </svg>
    </button>
  )
}

/** Something-went-wrong card: alert glyph, copy, error code, retry and a way out. */
export function ErrorCard({ title, description, errorId, onRetry, homeHref = '/dashboard', eyebrow }) {
  const t = useT()
  const body =
    description || (monitoringEnabled() ? `${t('system.error.body')} ${t('system.error.notified')}` : t('system.error.body'))
  return (
    <SystemCard eyebrow={eyebrow} className="min-h-[400px]">
      <ErrorGlyph />
      <div role="alert" className="flex flex-col items-center gap-2">
        <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-text">{title || t('system.error.title')}</h1>
        <p className="max-w-sm text-[14px] leading-5 text-muted">{body}</p>
      </div>
      {errorId && <ErrorCode code={errorId} />}
      <div className="flex flex-wrap justify-center gap-2.5">
        <GradientButton size="cta" onClick={onRetry || (() => window.location.reload())}>
          {t('ui.tryAgain')}
        </GradientButton>
        {homeHref && (
          <Link href={homeHref} className={GHOST}>
            {t('system.error.home')}
          </Link>
        )}
      </div>
    </SystemCard>
  )
}
