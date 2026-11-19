import Link from 'next/link'

/**
 * Titled card (Paper 09 "Stock by feed" / "Reorder suggestions", 24 "Top
 * customers", 29 "Suppliers"): 16/600 title, an optional muted note or link
 * on the right, then hairline-divided rows (see ListRow).
 *
 * `meta` is plain muted text; `action` is { label, href } or { label, onClick }.
 */
export function Panel({ title, titleId, meta, action, children, className = '', bodyClassName = '' }) {
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={`flex min-w-0 flex-col gap-1 rounded-card border border-line bg-surface px-5 py-6 shadow-[var(--shadow-card)] sm:px-[26px] ${className}`}
    >
      {(title || meta || action) && (
        <div className="flex items-center justify-between gap-3 pb-[10px]">
          {title && (
            <h2 id={titleId} className="font-sans text-[15px] font-semibold leading-[18px] text-text">
              {title}
            </h2>
          )}
          {meta && <span className="text-xs leading-4 text-muted">{meta}</span>}
          {action && <PanelAction {...action} />}
        </div>
      )}
      <div className={`flex min-w-0 flex-col ${bodyClassName}`}>{children}</div>
    </section>
  )
}

function PanelAction({ label, href, onClick }) {
  const cls =
    'inline-flex items-center gap-1 rounded-sm text-[13px] leading-4 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
  if (href) {
    return (
      <Link href={href} className={cls}>
        {label}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {label}
    </button>
  )
}

const DOT = { good: 'bg-dot-good', warn: 'bg-dot-warn', alert: 'bg-dot-alert', cyan: 'bg-cyan-fill', pink: 'bg-pink-fill', neutral: 'bg-faint' }

/**
 * One row in a Panel: optional 7px dot, a title with a muted sub-line, and a
 * right-aligned value (with its own optional sub-line). Pass `href` to make
 * the row a link.
 */
export function ListRow({ dot, dotLabel, title, sub, value, valueSub, valueClassName = '', href, children }) {
  const body = (
    <>
      {dot && (
        <span
          role={dotLabel ? 'img' : undefined}
          aria-label={dotLabel}
          aria-hidden={dotLabel ? undefined : true}
          className={`size-[7px] shrink-0 rounded-pill ${DOT[dot] || DOT.neutral}`}
        />
      )}
      <div className="flex min-w-0 grow basis-0 flex-col gap-[2px]">
        <div className="truncate text-[14px] leading-[18px] text-text">{title}</div>
        {sub && <div className="truncate text-xs leading-4 text-muted">{sub}</div>}
      </div>
      {children}
      {(value != null || valueSub) && (
        <div className="flex shrink-0 flex-col items-end gap-[2px] text-right">
          {value != null && (
            <div className={`text-[14px] font-medium leading-[18px] tabular-nums text-text ${valueClassName}`}>{value}</div>
          )}
          {valueSub && <div className="text-xs leading-4 text-muted">{valueSub}</div>}
        </div>
      )}
    </>
  )
  const cls = 'flex items-center gap-[14px] border-t border-line py-[11px]'
  if (href) {
    return (
      <Link href={href} className={`${cls} rounded-sm hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan`}>
        {body}
      </Link>
    )
  }
  return <div className={cls}>{body}</div>
}

export default Panel
