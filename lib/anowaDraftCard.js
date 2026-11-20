/**
 * Pure pieces of Ask Anowa's draft card (Paper artboard 48): what each item
 * says, the card's state, the "why this amount" bar and the link that opens
 * the normal form prefilled (Edit). No React; the numbers come from the typed
 * draft items (convex/anowa/drafts.get), never from the model's text.
 */

/** Card state from its items: pending, saved, undone, cancelled or expired. */
export function cardState(card, now = Date.now()) {
  const items = card?.items || []
  if (!items.length) return 'missing'
  if (items.some((i) => i.status === 'committed')) return 'saved'
  if (items.some((i) => i.status === 'undone')) return 'undone'
  if (items.some((i) => i.status === 'pending')) return card.expiresAt <= now ? 'expired' : 'pending'
  if (items.some((i) => i.status === 'expired')) return 'expired'
  return 'cancelled'
}

/** Pending items split into those the member may confirm and those greyed out. */
export function splitItems(card) {
  const pending = (card?.items || []).filter((i) => i.status === 'pending')
  return {
    allowed: pending.filter((i) => !i.problem),
    refused: pending.filter((i) => !!i.problem),
  }
}

/** "01", "02": the row numbers. */
export function rowNumber(index) {
  return String(index + 1).padStart(2, '0')
}

/** Whole hours (at least 1) until a timestamp: the "Expires in N h" text. */
export function hoursLeft(expiresAt, now = Date.now()) {
  return Math.max(1, Math.ceil((expiresAt - now) / 3_600_000))
}

/** Whole minutes (at least 1) until Undo closes; 0 when it has. */
export function undoMinutesLeft(undoUntil, now = Date.now()) {
  if (!undoUntil || undoUntil <= now) return 0
  return Math.max(1, Math.ceil((undoUntil - now) / 60_000))
}

/**
 * The "why this amount" bar for a purchase order: the stock share of the
 * need and the ordered share, as percentages that sum to 100.
 */
export function orderBar(payload) {
  const need = Math.max(0, Number(payload?.needKg) || 0)
  const stock = Math.max(0, Number(payload?.stockKg) || 0)
  const order = Math.max(0, Number(payload?.quantityKg) || 0)
  const total = Math.max(need, stock + order)
  if (!total) return { stockPct: 0, orderPct: 100 }
  const stockPct = Math.round((Math.min(stock, total) / total) * 100)
  return { stockPct, orderPct: 100 - stockPct }
}

/** Fish in the unit after a mortality entry: { before, after } or null when unknown. */
export function fishAfter(payload) {
  if (payload?.kind !== 'daily_entry' || typeof payload.fishBefore !== 'number') return null
  return { before: payload.fishBefore, after: Math.max(0, payload.fishBefore - (payload.mortality || 0)) }
}

/** Which title/meta keys a row uses (locales: askAnowa.draft.kinds.*). */
export function itemKind(payload) {
  if (payload?.kind === 'daily_entry') return payload.feedKg > 0 ? 'daily' : 'mortality'
  if (payload?.kind === 'feed_issue') return 'issue'
  if (payload?.kind === 'purchase_order') return 'order'
  return 'task'
}

const qs = (params) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')

/** The normal form for an item, prefilled (Edit). */
export function editHref(item) {
  const p = item?.payload || {}
  if (p.kind === 'daily_entry') {
    return `/daily-entry?${qs({
      cage: p.cageId,
      date: item.date,
      mortality: p.mortality || undefined,
      cause: p.mortality ? p.mortalityCause : undefined,
      feed: p.feedKg || undefined,
      feedType: p.feedKg ? p.feedTypeId : undefined,
      notes: p.notes,
    })}`
  }
  if (p.kind === 'feed_issue') {
    return `/feed-issue?${qs({ feedType: p.feedTypeId, qty: p.quantityKg, cage: p.cageId, date: item.date, notes: p.notes })}`
  }
  if (p.kind === 'purchase_order') {
    return `/procurement?${qs({ newPo: 1, supplier: p.supplierId, feedType: p.feedTypeId, qty: p.quantityKg, price: p.pricePerKg, site: item.siteId })}`
  }
  return `/teams?${qs({ taskTitle: p.title, taskDue: p.dueDate })}`
}

/** One readable prefill value from a Next.js query (first of an array, trimmed, capped). */
export function queryValue(query, key, max = 200) {
  const raw = query?.[key]
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** A non-negative number from a query value, or '' (forms keep strings). */
export function queryNumber(query, key) {
  const v = queryValue(query, key, 20)
  const n = Number(v)
  return v !== '' && Number.isFinite(n) && n >= 0 ? String(n) : ''
}

/** A YYYY-MM-DD date from a query value, or ''. */
export function queryDate(query, key) {
  const v = queryValue(query, key, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''
}
