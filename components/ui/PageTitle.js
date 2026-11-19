/**
 * Shell page header (Paper 7Z-0): eyebrow, H1 and up to two actions
 * (usually GradientButtons).
 */
export function PageTitle({ eyebrow, title, actions, titleProps = {}, className = '' }) {
  return (
    <div className={`flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="flex min-w-0 flex-col gap-[6px]">
        {eyebrow && <div className="text-[13px] leading-4 text-muted">{eyebrow}</div>}
        <h1
          className="font-sans text-[24px] font-semibold leading-[30px] tracking-[-0.02em] text-text sm:text-[30px] sm:leading-9"
          {...titleProps}
        >
          {title}
        </h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  )
}

export default PageTitle
