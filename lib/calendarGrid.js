const pad = (n) => String(n).padStart(2, '0')

/** Local YYYY-MM-DD for a Date. */
export function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** First of the month `delta` months from `month` (a Date on any day). */
export function shiftMonth(month, delta) {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1)
}

/**
 * Monday-first weeks covering the month of `month`: an array of weeks, each
 * seven `{ iso, day, inMonth }` cells, padded with days of the adjacent months.
 */
export function monthGrid(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const weeks = []
  const cursor = new Date(start)
  while (cursor <= last || weeks.length === 0 || cursor.getDay() !== 1) {
    if (cursor.getDay() === 1) weeks.push([])
    weeks[weeks.length - 1].push({
      iso: isoDate(cursor),
      day: cursor.getDate(),
      inMonth: cursor.getMonth() === first.getMonth(),
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return weeks
}

/** Group events (`{ date }`) by date, in input order. */
export function byDate(events) {
  const map = new Map()
  for (const e of events) {
    if (!e.date) continue
    if (!map.has(e.date)) map.set(e.date, [])
    map.get(e.date).push(e)
  }
  return map
}
