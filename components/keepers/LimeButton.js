import Link from 'next/link'

/**
 * Anowa's primary action (Paper 54 to 57 lime pill, ink text in both themes).
 * md: the header pill, a 45px lime pill inside a 1.5px lime ring (48px, 15/18).
 * cta: the cover sheet's "Set cover" (11px by 20px, 14/18). lg: My cages
 * "Log today" (44px, 15/18). sm: 40px, 14/18.
 */
const SIZE = {
  md: 'h-12 px-[23.5px] text-[15px] leading-[18px]',
  cta: 'py-[11px] px-5 text-[14px] leading-[18px]',
  lg: 'h-11 px-5 text-[15px] leading-[18px]',
  sm: 'h-10 px-[18px] text-[14px] leading-[18px]',
}

export default function LimeButton({ href, icon: Icon, children, size = 'md', className = '', ...props }) {
  const cls = `inline-flex shrink-0 items-center justify-center gap-2.5 whitespace-nowrap rounded-pill bg-lime font-semibold text-ink hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50 ${
    SIZE[size] || SIZE.sm
  } ${className}`
  const inner = (
    <>
      {Icon && <Icon size={16} strokeWidth={2} aria-hidden className="shrink-0" />}
      {children}
    </>
  )
  if (href) {
    return (
      <Link href={href} className={cls} {...props}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" className={cls} {...props}>
      {inner}
    </button>
  )
}
