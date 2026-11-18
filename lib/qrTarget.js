/**
 * What a scanned cage label points at (MOBILE-006).
 *
 * Labels printed from /cages/qr-codes encode a stable short code:
 * `<origin>/scan?c=<code>`. The code is the cage's own code when it is unique
 * on the farm, else `~` and the end of the cage id, so it survives a domain
 * change and reads well on the sticker. /scan is precached, so a scan with no
 * signal resolves it against the cage list saved on the phone.
 *
 * Older labels encode `<origin>/daily-entry?cage=<id>` and still work. The
 * origin is always ignored, so labels printed on another host (preview, old
 * domain) open this app. A label may also carry just the cage id, its code or
 * its name (hand-made stickers, typed fallback).
 */

const idOf = (c) => c?.id || c?._id

/** Entry screens a scan may land on. */
export const SCAN_TARGETS = {
  daily: '/daily-entry',
  biweekly: '/biweekly-entry',
}

const SHORT_ID_LENGTH = 6
const ID_PREFIX = '~'

/**
 * The short code printed on a cage's label: its own code when no other cage
 * shares it (case-insensitive), else `~` + the last characters of its id.
 */
export function shortCodeFor(cage, cages = []) {
  const code = String(cage?.code || '').trim()
  if (code && !code.startsWith(ID_PREFIX)) {
    const lower = code.toLowerCase()
    const shared = cages.filter((c) => String(c.code || '').trim().toLowerCase() === lower)
    if (shared.length <= 1) return code
  }
  return `${ID_PREFIX}${String(idOf(cage)).slice(-SHORT_ID_LENGTH)}`
}

/** The URL encoded in a cage's QR label. */
export function labelUrl(origin, cage, cages = []) {
  return `${origin}/scan?c=${encodeURIComponent(shortCodeFor(cage, cages))}`
}

/** The cage a short code, id, code or name names, or null when none or ambiguous. */
export function findCageByCode(text, cages = []) {
  const raw = String(text ?? '').trim()
  if (!raw || !cages?.length) return null
  const byId = cages.find((c) => String(idOf(c)) === raw)
  if (byId) return byId
  if (raw.startsWith(ID_PREFIX) && raw.length > ID_PREFIX.length) {
    const tail = raw.slice(ID_PREFIX.length)
    const hits = cages.filter((c) => String(idOf(c)).endsWith(tail))
    return hits.length === 1 ? hits[0] : null
  }
  const lower = raw.toLowerCase()
  const codeHits = cages.filter((c) => String(c.code || '').trim().toLowerCase() === lower)
  if (codeHits.length === 1) return codeHits[0]
  if (codeHits.length > 1) return null
  const nameHits = cages.filter((c) => String(c.name || '').trim().toLowerCase() === lower)
  return nameHits.length === 1 ? nameHits[0] : null
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
    const shortCodes = url.searchParams.getAll('c').filter(Boolean)
    if (shortCodes.length) {
      if (!known) return null
      const found = shortCodes.map((code) => findCageByCode(code, cages)).filter(Boolean)
      return found.length ? { cageIds: [...new Set(found.map((c) => String(idOf(c))))], target } : null
    }
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
  const match = findCageByCode(raw, cages)
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
