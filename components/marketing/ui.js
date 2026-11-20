/**
 * Shared pieces of the marketing site, translated from Paper landing v4
 * ("Sky", file 01M7RD5Z2VX87M2KSRH9YKX8XA, artboard "Landing v4 — Sky (1440)").
 * The marketing site is light-only and uses Paper's literal brand colours
 * (lime #D7F75B, ink #0B0D10, sky #2F86EA), not the app's theme tokens.
 */
import Link from 'next/link'

/** The page frame: white, 12px gutter, sections up to 1416px wide (Paper `Page`). */
export function MarketingPage({ children, className = '' }) {
  return <div className={`min-h-dvh bg-white p-2 font-sans text-ink antialiased sm:p-3 ${className}`}>{children}</div>
}

/** A full-width section column; Paper sections are 1416px with 120px side padding. */
export function Section({ as: Tag = 'section', className = '', inner = '', children, ...rest }) {
  return (
    <Tag className={`mx-auto w-full max-w-[1416px] ${className}`} {...rest}>
      <div className={`px-5 sm:px-10 xl:px-[120px] ${inner}`}>{children}</div>
    </Tag>
  )
}

/** "• Label" in DM Mono, uppercase, 0.08em tracking. */
export function Eyebrow({ children, tone = 'ink', className = '' }) {
  const color = tone === 'lime' ? 'text-lime' : tone === 'white' ? 'text-white' : tone === 'muted' ? 'text-[#9CA3AF]' : 'text-ink'
  return (
    <p className={`font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] ${color} ${className}`}>
      <span aria-hidden>• </span>
      {children}
    </p>
  )
}

/**
 * Paper's two-voice headline: Inter Tight, then an Instrument Serif italic
 * accent. `size`: 'xl' (hero 72), 'lg' (48), 'md' (40), 'sm' (30).
 */
export function Heading({ as: Tag = 'h2', lead, accent, tone = 'ink', size = 'lg', className = '' }) {
  const sizes = {
    xl: 'text-[44px] leading-[104%] sm:text-[60px] lg:text-[72px] lg:leading-[102%]',
    lg: 'text-[34px] leading-[110%] sm:text-[42px] lg:text-[48px]',
    md: 'text-[30px] leading-[112%] sm:text-[36px] lg:text-[40px]',
    sm: 'text-[26px] leading-[115%] lg:text-[30px]',
  }
  const accentSizes = {
    xl: 'text-[1.14em]',
    lg: 'text-[1.17em]',
    md: 'text-[1.15em]',
    sm: 'text-[1.12em]',
  }
  const color = tone === 'white' ? 'text-white' : 'text-ink'
  const accentColor = tone === 'white' ? 'text-[#9CA3AF]' : tone === 'sky' ? 'text-white/90' : 'text-[#6B7280]'
  return (
    <Tag className={`font-tight font-normal tracking-[-0.045em] ${sizes[size]} ${color} ${className}`}>
      {lead}
      {accent && (
        <>
          {' '}
          <span className={`font-serif italic tracking-[-0.01em] ${accentSizes[size]} ${accentColor}`}>{accent}</span>
        </>
      )}
    </Tag>
  )
}

function Arrow({ dark = true }) {
  return (
    <span className={`mk-arrow flex size-[30px] shrink-0 items-center justify-center rounded-pill ${dark ? 'bg-ink' : 'bg-lime'}`} aria-hidden>
      <svg width="14" height="14" viewBox="0 0 24 24">
        <path d="M7 17L17 7M8 7h9v9" fill="none" stroke={dark ? '#FFFFFF' : '#0B0D10'} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2'

/** Lime pill with the round ink arrow (Paper "Start free trial"). `variant="ink"` inverts it. */
export function PillButton({ href, children, variant = 'lime', className = '', ...rest }) {
  const cls =
    variant === 'ink'
      ? `bg-ink text-white`
      : `bg-lime text-ink`
  return (
    <Link
      href={href}
      className={`mk-press inline-flex items-center gap-3 rounded-pill py-1.5 pl-[22px] pr-1.5 font-mono-dm text-[13px] uppercase leading-4 tracking-[0.08em] ${cls} ${FOCUS} ${className}`}
      {...rest}
    >
      <span className="whitespace-nowrap">{children}</span>
      <Arrow dark={variant !== 'ink'} />
    </Link>
  )
}

/** Outlined pill (Paper "Watch demo"); `tone="light"` for sky/dark backgrounds. */
export function GhostButton({ href, children, tone = 'light', className = '', ...rest }) {
  const cls =
    tone === 'light'
      ? 'border-white/20 bg-[#0B3A7A80] text-white hover:bg-[#0B3A7A]'
      : 'border-[#E5E7EB] text-ink hover:bg-mist'
  return (
    <Link
      href={href}
      className={`mk-press inline-flex items-center rounded-pill border px-[22px] py-3 font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] transition-colors ${cls} ${FOCUS} ${className}`}
      {...rest}
    >
      {children}
    </Link>
  )
}

/** Pulse mark + "anowa" in Geist Mono (Paper nav brand). */
export function Brand({ tone = 'white', className = '' }) {
  const stroke = tone === 'white' ? '#F4F0E8' : '#0B0D10'
  return (
    <Link href="/" className={`inline-flex items-center gap-2.5 rounded-sm ${FOCUS} ${className}`} aria-label="Anowa home">
      <svg width="37" height="22" viewBox="0.5 16.25 60.25 35.5" aria-hidden className="shrink-0">
        <path d="M14.5 34 H18 L23 19 L30 49 L36 27 L40 34 H46 L58 22 L58 46 L46 34" fill="none" stroke={stroke} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="4.5" cy="34" r="4" fill="#F2A07B" />
      </svg>
      <span className={`font-geist text-[20px] font-medium leading-6 tracking-[-0.02em] ${tone === 'white' ? 'text-white' : 'text-ink'}`}>anowa</span>
    </Link>
  )
}

export const MK_FOCUS = FOCUS
