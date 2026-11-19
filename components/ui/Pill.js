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

export default Pill
