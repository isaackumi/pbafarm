import Link from 'next/link'

/** Full-height centring for a system card (Paper 62 / P-SYSTEM). */
export function SystemPage({ children, className = 'min-h-screen' }) {
  return <div className={`flex items-center justify-center bg-bg px-4 py-10 ${className}`}>{children}</div>
}

/** Paper 62 card: 20px radius, 32px padding, 18px gap, centred; light-theme shadow. */
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

/** Paper 62 ghost pill ("Search ⌘K", "Status page"): 11/22, 14/18, line-strong border. */
export const STATE_GHOST =
  'inline-flex items-center rounded-pill border border-line-strong px-[22px] py-[11px] text-[14px] leading-[18px] text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

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
