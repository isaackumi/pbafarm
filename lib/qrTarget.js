/**
 * What a scanned cage label points at (MOBILE-006).
 *
 * Labels printed from /cages/qr-codes encode `<origin>/daily-entry?cage=<id>`.
 * The origin is ignored, so labels printed on another host (preview, old
 * domain) still open this app. A label may also carry just the cage id, its
 * code or its name (hand-made stickers, typed fallback).
 */

const idOf = (c) => c?.id || c?._id

/** Entry screens a scan may land on. */
export const SCAN_TARGETS = {
  daily: '/daily-entry',
  biweekly: '/biweekly-entry',
}

/**
 * Returns `{ cageIds, target }` where `target` is 'daily' | 'biweekly' | null
 * (null: the label did not say), or null when nothing usable was found.
 * When `cages` is given, ids are kept only if they are in it and plain text
 * is matched against cage id, code and name (case-insensitive).
 */
export function parseCageScan(text, cages = null) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const known = cages ? new Map(cages.map((c) => [String(idOf(c)), c])) : null

  let url = null
  try {
    url = new URL(raw)
  } catch {
    // Not absolute: maybe a path like /daily-entry?cage=...
    if (raw.startsWith('/')) {
      try {
        url = new URL(raw, 'http://local.invalid')
      } catch {
        url = null
      }
    }
  }

  if (url) {
    const path = url.pathname.replace(/\/+$/, '')
    const target = path.endsWith(SCAN_TARGETS.biweekly)
      ? 'biweekly'
      : path.endsWith(SCAN_TARGETS.daily)
        ? 'daily'
        : null
    let ids = [...url.searchParams.getAll('cage'), ...url.searchParams.getAll('cages')]
      .flatMap((v) => v.split(','))
      .map((s) => s.trim())
      .filter(Boolean)
    if (!ids.length) {
      // /cages/<id> links from the cage page.
      const m = /\/cages\/([^/?#]+)$/.exec(path)
      if (m && m[1] !== 'qr-codes') ids = [decodeURIComponent(m[1])]
    }
    if (known) ids = ids.filter((id) => known.has(id))
    return ids.length ? { cageIds: [...new Set(ids)], target } : null
  }

  if (!known) return { cageIds: [raw], target: null }
  if (known.has(raw)) return { cageIds: [raw], target: null }
  const lower = raw.toLowerCase()
  const match =
    cages.find((c) => String(c.code || '').toLowerCase() === lower) ||
    cages.find((c) => String(c.name || '').toLowerCase() === lower)
  return match ? { cageIds: [String(idOf(match))], target: null } : null
}

/** The in-app URL for a scan result on the chosen entry screen. */
export function scanHref(result, fallbackTarget = 'daily') {
  if (!result?.cageIds?.length) return null
  const target = result.target || fallbackTarget
  const base = SCAN_TARGETS[target] || SCAN_TARGETS.daily
  const key = result.cageIds.length > 1 ? 'cages' : 'cage'
  return `${base}?${key}=${result.cageIds.map(encodeURIComponent).join(',')}`
}
