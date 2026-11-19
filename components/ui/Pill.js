/** Status/label pill (Paper 24 Sales, 22 Roles). Tones map to theme tokens. */
const TONE = {
  neutral: 'border-[var(--pill-neutral-border)] text-[var(--pill-neutral-text)]',
  pink: 'border-[var(--pill-pink-border)] text-[var(--pill-pink-text)]',
  cyan: 'border-[var(--pill-cyan-border)] text-[var(--pill-cyan-text)]',
  green: 'border-[var(--pill-green-border)] text-[var(--pill-green-text)]',
  amber: 'border-[var(--pill-amber-border)] text-[var(--pill-amber-text)]',
  red: 'border-[var(--pill-red-border)] text-[var(--pill-red-text)]',
}

export function Pill({ tone = 'neutral', children, className = '', ...props }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 py-1 text-[12px] leading-4 ${
        TONE[tone] || TONE.neutral
      } ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

/**
 * Filled status badge (Paper 43/44 invoice status): the tone at 12% behind
 * its own colour. The text always names the status.
 */
const BADGE = {
  neutral: 'bg-surface-2 text-muted',
  good: 'bg-[color-mix(in_oklab,var(--good)_12%,transparent)] text-good',
  warn: 'bg-[color-mix(in_oklab,var(--warn)_12%,transparent)] text-warn',
  alert: 'bg-[color-mix(in_oklab,var(--alert)_12%,transparent)] text-alert',
  cyan: 'bg-[color-mix(in_oklab,var(--cyan)_12%,transparent)] text-pearl-cyan',
  pink: 'bg-[color-mix(in_oklab,var(--pink)_12%,transparent)] text-pearl-pink',
}

export function Badge({ tone = 'neutral', children, className = '', ...props }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-pill px-2 py-[3px] text-[11px] leading-[14px] ${
        BADGE[tone] || BADGE.neutral
      } ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Pill
