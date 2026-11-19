/** Small status dot: 6px in tables, 8px on sensor cards. */
const TONE = {
  good: 'bg-dot-good',
  warn: 'bg-dot-warn',
  alert: 'bg-dot-alert',
  offline: 'bg-faint',
  neutral: 'bg-faint',
}

export function StatusDot({ tone = 'good', size = 6, label, className = '' }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`inline-block shrink-0 rounded-full ${TONE[tone] || TONE.neutral} ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

export default StatusDot
