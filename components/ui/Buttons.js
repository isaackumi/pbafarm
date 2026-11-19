import Link from 'next/link'

/**
 * Pill buttons from the Paper shell (7Z-0 page header, 24 Sales, 31 Account).
 * GradientButton: a 1.5px pink→cyan ring (120deg) around a surface or solid
 * fill. `reverse` flips the ring to cyan→pink (second header button).
 */
const INNER = {
  outline: {
    md: 'h-[45px] px-[22px] gap-2.5 bg-surface text-text text-[15px] leading-[18px] font-medium',
    sm: 'py-[9px] px-[18px] gap-2 bg-surface text-text text-[13px] leading-4 font-medium',
  },
  solid: {
    md: 'h-[45px] px-[22px] gap-2.5 bg-button text-button-text text-[15px] leading-[18px] font-semibold',
    sm: 'py-[9px] px-[18px] gap-2 bg-button text-button-text text-[13px] leading-4 font-semibold',
  },
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
  children,
  className = '',
  ...props
}) {
  const inner = (INNER[variant] || INNER.outline)[size] || INNER.outline.md
  return (
    <Base
      className={`group inline-flex shrink-0 rounded-pill p-[1.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
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

export function GhostButton({ icon: Icon, children, className = '', ...props }) {
  return (
    <Base
      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-pill border border-line-strong px-[18px] py-[9px] text-[13px] leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {Icon && <Icon size={14} strokeWidth={2} aria-hidden className="shrink-0" />}
      {children}
    </Base>
  )
}
