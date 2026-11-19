/** Initials avatar: 32px round in the top bar, 24px square for the workspace. */
export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({ name, size = 32, square = false, className = '' }) {
  const text = size <= 24 ? 'text-[11px] leading-[14px]' : 'text-[12px] leading-4'
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-line-strong bg-surface-2 font-semibold text-text ${
        square ? 'rounded-[6px]' : 'rounded-pill'
      } ${text} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

export default Avatar
