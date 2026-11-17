/**
 * The waterline: a thin bar showing how full a cage is (fish count against
 * capacity). PBA Farm's one signature detail. Use it wherever a cage is named
 * in a list, and nowhere else.
 */
export default function Waterline({ count, capacity, inverted = false, className = '' }) {
  const cap = Number(capacity)
  const n = Number(count)
  if (!(cap > 0) || !Number.isFinite(n)) return null
  const pct = Math.max(0, Math.min(100, (n / cap) * 100))
  const label = `${n.toLocaleString()} of ${cap.toLocaleString()} fish (${pct.toFixed(0)}% full)`
  return (
    <span
      className={`block h-1 w-full overflow-hidden rounded-full ${
        inverted ? 'bg-white/25 dark:bg-black/20' : 'bg-foam-deep'
      } ${className}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <span
        className={`block h-full rounded-full ${inverted ? 'bg-white dark:bg-[#18181b]' : 'bg-lake'}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  )
}
