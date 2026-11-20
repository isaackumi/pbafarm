import Link from 'next/link'

/** Anowa's primary action (Paper 54 to 57 lime pill, ink text in both themes). */
export default function LimeButton({ href, icon: Icon, children, size = 'md', className = '', ...props }) {
  const cls = `inline-flex shrink-0 items-center justify-center gap-2.5 whitespace-nowrap rounded-pill bg-lime font-semibold text-ink hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50 ${
    size === 'md' ? 'h-[45px] px-[22px] text-[15px] leading-[18px]' : size === 'lg' ? 'h-11 px-5 text-[15px]' : 'h-10 px-[18px] text-[14px] leading-[18px]'
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
