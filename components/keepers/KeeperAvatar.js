import { avatarFill } from '../../lib/keepers'

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] || '' : '')).toUpperCase()
}

/**
 * Keeper avatar (Paper 54 to 57): a filled circle from the keeper palette
 * with #F2F3F4 initials, no border. 34px on the row board, 32px on the cover
 * sheet and My cages, 28px in the list (11px initials).
 */
export default function KeeperAvatar({ name, size = 32 }) {
  const text = size <= 28 ? 'text-[11px] leading-3' : 'text-xs leading-[14px]'
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-pill font-semibold text-[#F2F3F4] ${text}`}
      style={{ width: size, height: size, backgroundColor: avatarFill(name) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}
