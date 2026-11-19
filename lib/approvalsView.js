/** Pure helpers for the Approvals inbox (Paper 25 Approvals). */

export const APPROVAL_TABS = ['all', 'stocking', 'fish_transfer', 'topup']

/** Compact age of a request: minutes, hours or days. */
export function requestAge(createdAt, now = Date.now()) {
  const mins = Math.max(0, Math.floor((now - createdAt) / 60000))
  if (mins < 60) return { unit: 'm', n: mins }
  const hours = Math.floor(mins / 60)
  if (hours < 24) return { unit: 'h', n: hours }
  return { unit: 'd', n: Math.floor(hours / 24) }
}

/** Pending count per tab. */
export function tabCounts(rows) {
  const counts = { all: 0, stocking: 0, fish_transfer: 0, topup: 0 }
  for (const r of rows || []) {
    counts.all += 1
    if (r.type in counts) counts[r.type] += 1
  }
  return counts
}

/** Rows in a tab, and the selected row (kept if still listed, else the first). */
export function inboxView(rows, tab, selectedKey) {
  const list = (rows || []).filter((r) => tab === 'all' || r.type === tab)
  const selected = list.find((r) => rowKey(r) === selectedKey) || list[0] || null
  return { list, selected }
}

export const rowKey = (r) => `${r.type}-${r.id}`
