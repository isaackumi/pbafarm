import Link from 'next/link'
import { ErrorGlyph, GradientButton } from '../ui'
import { useT } from '../../lib/i18n/context'

/** Full-height centring for a system card (Paper 62 / P-SYSTEM). */
export function SystemPage({ children, className = 'min-h-screen' }) {
  return <div className={`flex items-center justify-center bg-bg px-4 py-10 ${className}`}>{children}</div>
}

/** Bordered surface card that holds one system state. */
export function SystemCard({ eyebrow, children, className = '' }) {
  return (
    <section
      className={`relative flex w-full max-w-[560px] flex-col items-center justify-center gap-[18px] overflow-hidden rounded-card border border-line bg-surface p-8 text-center ${className}`}
    >
      {eyebrow && <p className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">{eyebrow}</p>}
      {children}
    </section>
  )
}

const GHOST =
  'inline-flex items-center rounded-pill border border-line-strong px-[22px] py-[11px] text-sm leading-[18px] text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

/** Gradient-ring pill with a solid light fill (Paper "Go home" / "Continue"). */
export function GradientSolidLink({ href, onClick, children, className = '' }) {
  const inner = (
    <span className="block rounded-pill bg-button px-[22px] py-[11px] text-sm font-semibold leading-[18px] text-button-text transition-opacity group-hover:opacity-90">
      {children}
    </span>
  )
  const ring = `group inline-flex rounded-pill p-[1.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${className}`
  const style = { backgroundImage: 'var(--gradient-brand)' }
  if (href) {
    return (
      <Link href={href} className={ring} style={style}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={ring} style={style}>
      {inner}
    </button>
  )
}

function Waves() {
  return (
    <svg viewBox="0 0 640 60" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-[60px] w-full" aria-hidden>
      <path d="M0 34c80-14 160 14 240 0s160-14 240 0 120 10 160 4" fill="none" className="stroke-line" strokeWidth="1.5" />
      <path d="M0 48c80-12 160 12 240 0s160-12 240 0 120 8 160 3" fill="none" className="stroke-surface-2" strokeWidth="1.5" />
    </svg>
  )
}

/** 404 card: gradient numerals, copy, home action and a wave line. */
export function NotFoundCard({ homeHref = '/' }) {
  const t = useT()
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
        <h1 className="text-2xl font-semibold leading-[30px] tracking-tight text-text">{t('system.notFound.title')}</h1>
        <p className="text-sm leading-5 text-muted">{t('system.notFound.body')}</p>
      </div>
      <GradientSolidLink href={homeHref}>{t('system.notFound.home')}</GradientSolidLink>
      <Waves />
    </SystemCard>
  )
}

/** Something-went-wrong card: alert glyph, copy, retry and a way out. */
export function ErrorCard({ title, description, onRetry, homeHref = '/dashboard', eyebrow }) {
  const t = useT()
  return (
    <SystemCard eyebrow={eyebrow} className="min-h-[400px]">
      <ErrorGlyph />
      <div role="alert" className="flex flex-col items-center gap-2">
        <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-text">{title || t('system.error.title')}</h1>
        <p className="max-w-sm text-sm leading-5 text-muted">{description || t('system.error.body')}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2.5">
        <GradientButton onClick={onRetry || (() => window.location.reload())}>{t('ui.tryAgain')}</GradientButton>
        {homeHref && (
          <Link href={homeHref} className={GHOST}>
            {t('system.error.home')}
          </Link>
        )}
      </div>
    </SystemCard>
  )
}
