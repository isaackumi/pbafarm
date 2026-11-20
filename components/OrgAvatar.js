/**
 * Organization (farm) avatar: its logo when set, else initials on a square
 * tile. `highlight` marks the active farm with the brand gradient (Paper 69/70).
 */
import { orgInitials } from '../lib/activeOrganization'

export function OrgAvatar({ name, logoUrl, size = 32, highlight = false, className = '' }) {
  const box = { width: size, height: size }
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        style={box}
        className={`org-avatar shrink-0 rounded-[6px] border border-line-strong object-cover ${className}`}
      />
    )
  }
  const text = size <= 24 ? 'text-[11px] leading-[14px]' : size >= 40 ? 'text-[15px] leading-5' : 'text-[12px] leading-4'
  return (
    <span
      style={box}
      aria-hidden
      className={`org-avatar inline-flex shrink-0 items-center justify-center rounded-[7px] font-semibold ${
        highlight
          ? 'bg-[image:var(--gradient-brand)] text-[#0b0d10]'
          : 'border border-line-strong bg-surface-2 text-text'
      } ${text} ${className}`}
    >
      {orgInitials(name)}
    </span>
  )
}

export default OrgAvatar
