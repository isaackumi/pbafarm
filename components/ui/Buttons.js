import Link from 'next/link'

/**
 * Pill buttons from the Paper shell (7Z-0 page header, 24 Sales, 31 Account).
 * GradientButton: a 1.5px sky ring (120deg #1562D6 → #B9DDF9, light
 * → #7DB6F2) around a surface or solid fill; `variant="lime"` is the lime
 * primary (7Z-0 "Log daily entry"). `reverse` is kept for old callers and
 * draws the same ring (Paper has no reversed ring).
 * Sizes (inner height; the ring adds 3px):
 *   md  45px, 15/18 — page header actions (7Z-0)
 *   bar 42px, 15/18 — 53 Bulk import "Download template" and "Import N rows"
 *   cta 40px, 14/18 — empty-state and card actions (62 "Stock a new cage")
 *   row 38px, 14/18 — Approve next to a 41px GhostButton row (06 Stocking)
 *   sm  34px, 13/16 — card footers, dialogs (25 Approvals)
 *   xs  30px, 13/16 — inline table-row actions
 * `block` stretches the button and centres its label. Icons are 16px on md
 * (7Z-0) and 14px on the smaller sizes (62 "Stock a new cage").
 */
const SIZE = {
  md: 'h-[45px] px-[22px] gap-2.5 text-[15px] leading-[18px]',
  bar: 'h-[42px] px-[22px] gap-2.5 text-[15px] leading-[18px]',
  cta: 'py-[11px] px-[22px] gap-2 text-[14px] leading-[18px]',
  row: 'h-[38px] px-5 gap-2 text-[14px] leading-[18px]',
  sm: 'py-[9px] px-[18px] gap-2 text-[13px] leading-4',
  xs: 'py-[7px] px-[14px] gap-1.5 text-[13px] leading-4',
}
const FILL = {
  outline: 'bg-surface text-text font-medium',
  solid: 'bg-button text-button-text font-semibold',
  /** Paper 50 "Save plan": lime fill and ring, ink text (the same on both themes). */
  lime: 'bg-lime text-ink font-semibold',
}
/** The 1.5px ring: lime for the lime variant, else the sky gradient (`--gradient-brand` = `--gradient-sky`). */
function ringStyle(variant, reverse, ring) {
  if (variant === 'lime') return { backgroundColor: 'var(--color-lime)' }
  if (ring === 'sky') return { backgroundImage: 'var(--gradient-sky)' }
  return { backgroundImage: reverse ? 'var(--gradient-brand-rev)' : 'var(--gradient-brand)' }
}

function Base({ href, className, children, type = 'button', style, ...props }) {
  if (href) {
    return (
      <Link href={href} className={className} style={style} {...props}>
        {children}
      </Link>
    )
  }
  return (
    <button type={type} className={className} style={style} {...props}>
      {children}
    </button>
  )
}

export function GradientButton({
  variant = 'outline',
  size = 'md',
  reverse = false,
  ring = 'brand',
  icon: Icon,
  block = false,
  children,
  className = '',
  ...props
}) {
  const inner = `${SIZE[size] || SIZE.md} ${FILL[variant] || FILL.outline}${block ? ' grow justify-center' : ''}`
  return (
    <Base
      className={`group ${block ? 'flex w-full' : 'inline-flex shrink-0'} rounded-pill p-[1.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      style={ringStyle(variant, reverse, ring)}
      {...props}
    >
      <span
        className={`flex items-center whitespace-nowrap rounded-pill transition-opacity group-hover:opacity-90 ${inner}`}
      >
        {Icon && <Icon size={size === 'md' || size === 'bar' ? 16 : 14} strokeWidth={2} aria-hidden className="shrink-0" />}
        {children}
      </span>
    </Base>
  )
}

/**
 * Ghost sizes: xl 45px 15/18 medium (52 Grading "Save draft"), row 41px 14/18
 * (06 Stocking "Reject"), dialog 42px 14/18 (63 "Cancel"), lg 40px 14/18,
 * md 34px 13/16, sm 30px 12/16.
 */
const GHOST_SIZE = {
  xl: 'h-[45px] gap-2.5 px-[22px] text-[15px] font-medium leading-[18px]',
  row: 'h-[41px] gap-2 px-5 text-[14px] leading-[18px]',
  /** Paper 63 dialog "Cancel": 11/20 padding + 1px border = 42px. */
  dialog: 'gap-2 px-5 py-[11px] text-[14px] leading-[18px]',
  md: 'gap-2 px-[18px] py-[9px] text-[13px] leading-4',
  lg: 'h-10 gap-2 px-[18px] text-[14px] leading-[18px]',
  sm: 'gap-2 px-3 py-[7px] text-xs leading-4',
}

/** Outlined pill. `tone="danger"` for destructive actions (red text, still outlined). */
export function GhostButton({ icon: Icon, children, size = 'md', tone = 'default', className = '', ...props }) {
  return (
    <Base
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-pill border border-line-strong ${GHOST_SIZE[size] || GHOST_SIZE.md} ${
        tone === 'danger' ? 'text-alert' : 'text-text'
      } hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {Icon && <Icon size={size === 'xl' ? 16 : 14} strokeWidth={2} aria-hidden className="shrink-0" />}
      {children}
    </Base>
  )
}

/** Solid light pill, no ring: the platform console's primary action (Paper 40/44). */
export function SolidButton({ icon: Icon, children, size = 'lg', className = '', ...props }) {
  return (
    <Base
      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-pill bg-text font-medium text-bg ${GHOST_SIZE[size] || GHOST_SIZE.lg} hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {Icon && <Icon size={14} strokeWidth={2} aria-hidden className="shrink-0" />}
      {children}
    </Base>
  )
}

/**
 * Filled destructive pill (Paper 63 "Delete sale"): 11/20 padding, 14/18
 * semibold; alert fill with page-colour text on dark, white text on light.
 * Phones keep a 48px target.
 */
export function DangerButton({ children, className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-12 shrink-0 items-center justify-center whitespace-nowrap rounded-pill bg-alert px-5 py-[11px] text-[14px] font-semibold leading-[18px] text-bg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 [[data-theme=light]_&]:text-white ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
