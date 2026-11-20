/**
 * Organization (farm) avatar: its logo when set, else initials on a square
 * tile. `highlight` marks the active farm with Paper's sky gradient chip
 * (69 at 28px, 70 at 40px: 160deg #1562D6 → #B9DDF9, ink initials).
 * `muted` greys the initials (Paper 70 farm waiting for approval).
 * At 24px (the sidebar tenant row, 7Z-0 / 69) the tile has 6px corners; the
 * open trigger keeps text-colour initials on the gradient (`lightText`).
 */
import { orgInitials } from '../lib/activeOrganization'

const SKY_CHIP = 'linear-gradient(in oklab 160deg, #1562D6 0%, #B9DDF9 100%)'

export function OrgAvatar({ name, logoUrl, size = 32, highlight = false, lightText = false, muted = false, className = '' }) {
  const box = { width: size, height: size }
  // Paper 70: 10px corners at 40px; Paper 69: 7px at 28px, 6px at 24px.
  const radius = size >= 40 ? 'rounded-[10px]' : size <= 24 ? 'rounded-[6px]' : 'rounded-[7px]'
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        style={box}
        className={`org-avatar shrink-0 ${size >= 40 ? 'rounded-[10px]' : 'rounded-[6px]'} border border-line-strong object-cover ${className}`}
      />
    )
  }
  // Paper 70 (40px): 14/18; Paper 69 (28px): 11px.
  const text = size <= 28 ? 'text-[11px] leading-[14px]' : size >= 40 ? 'text-[14px] leading-[18px]' : 'text-[12px] leading-4'
  return (
    <span
      style={highlight ? { ...box, backgroundImage: SKY_CHIP } : box}
      aria-hidden
      className={`org-avatar inline-flex shrink-0 items-center justify-center ${radius} font-semibold ${
        highlight ? (lightText ? 'text-text' : 'text-ink') : `border border-line-strong bg-surface-2 ${muted ? 'text-muted' : 'text-text'}`
      } ${text} ${className}`}
    >
      {orgInitials(name)}
    </span>
  )
}

export default OrgAvatar
