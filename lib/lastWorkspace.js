/**
 * The farm workspace last used on this device (Paper 15 workspace card:
 * "PBA Farm Ltd · Switch"). Only the organization's display name is kept,
 * in localStorage; nothing about the account. "Switch" forgets it.
 */
const KEY = 'anowa.lastWorkspace'

export function rememberWorkspace(org) {
  if (!org?.name) return
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ name: String(org.name).slice(0, 120) }))
  } catch {
    // Storage blocked: the card just does not show.
  }
}

export function lastWorkspace() {
  try {
    const raw = window.localStorage.getItem(KEY)
    const v = raw ? JSON.parse(raw) : null
    return v && typeof v.name === 'string' && v.name ? { name: v.name } : null
  } catch {
    return null
  }
}

export function forgetWorkspace() {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
