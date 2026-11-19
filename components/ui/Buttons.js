import Link from 'next/link'

/**
 * Pill buttons from the Paper shell (7Z-0 page header, 24 Sales, 31 Account).
 * GradientButton: a 1.5px pink→cyan ring (120deg) around a surface or solid
 * fill. `reverse` flips the ring to cyan→pink (second header button).
 * Sizes (inner height; the ring adds 3px):
 *   md  45px, 15/18 — page header actions (7Z-0)
 *   cta 40px, 14/18 — empty-state and card actions (62 "Stock a new cage")
 *   row 38px, 14/18 — Approve next to a 41px GhostButton row (06 Stocking)
 *   sm  34px, 13/16 — card footers, dialogs (25 Approvals)
 *   xs  30px, 13/16 — inline table-row actions
 * `block` stretches the button and centres its label.
 */
const SIZE = {
  md: 'h-[45px] px-[22px] gap-2.5 text-[15px] leading-[18px]',
  cta: 'py-[11px] px-[22px] gap-2 text-[14px] leading-[18px]',
  row: 'h-[38px] px-5 gap-2 text-[14px] leading-[18px]',
  sm: 'py-[9px] px-[18px] gap-2 text-[13px] leading-4',
  xs: 'py-[7px] px-[14px] gap-1.5 text-[13px] leading-4',
}
const FILL = {
  outline: 'bg-surface text-text font-medium',
  solid: 'bg-button text-button-text font-semibold',
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
      style={{ backgroundImage: reverse ? 'var(--gradient-brand-rev)' : 'var(--gradient-brand)' }}
      {...props}
    >
      <span
        className={`flex items-center whitespace-nowrap rounded-pill transition-opacity group-hover:opacity-90 ${inner}`}
      >
        {Icon && <Icon size={16} strokeWidth={2} aria-hidden className="shrink-0" />}
        {children}
      </span>
    </Base>
  )
}

/**
 * Ghost sizes: xl 45px 15/18 medium (52 Grading "Save draft"), row 41px 14/18
 * (06 Stocking "Reject"), lg 40px 14/18, md 34px 13/16, sm 30px 12/16.
 */
const GHOST_SIZE = {
  xl: 'h-[45px] gap-2.5 px-[22px] text-[15px] font-medium leading-[18px]',
  row: 'h-[41px] gap-2 px-5 text-[14px] leading-[18px]',
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
