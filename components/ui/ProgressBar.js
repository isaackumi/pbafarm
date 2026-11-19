/** 8px track (Paper 09 Feed). Brand fill is the pink→cyan gradient. */
const FILL = { alert: 'bg-alert', warn: 'bg-warn', good: 'bg-good', cyan: 'bg-pearl-cyan', pink: 'bg-pearl-pink' }

export function ProgressBar({ value = 0, max = 100, tone = 'brand', label, className = '' }) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`h-2 w-full overflow-hidden rounded-pill bg-line ${className}`}
    >
      <div
        className={`h-full rounded-pill ${FILL[tone] || ''}`}
        style={{
          width: `${pct}%`,
          ...(FILL[tone] ? {} : { backgroundImage: 'var(--gradient-bar)' }),
        }}
      />
    </div>
  )
}

export default ProgressBar
