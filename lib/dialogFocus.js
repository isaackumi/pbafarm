/** The element Tab should move to, or null to let the browser handle it. */
export function nextFocus(items, current, backwards) {
  if (!items.length) return null
  const first = items[0]
  const last = items[items.length - 1]
  const inside = items.includes(current)
  if (backwards && (current === first || !inside)) return last
  if (!backwards && (current === last || !inside)) return first
  return null
}
