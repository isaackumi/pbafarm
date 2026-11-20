/**
 * Auto-balance (pure): which units move to whom so that units without a
 * keeper get one and nobody holds more than the capacity. Keepers only take
 * units at a site where they already keep units (they know the site and have
 * access). The lightest keeper wins; a keeper already in the unit's row wins
 * ties, so a row stays with few people. Deterministic: same input, same moves.
 */

export type BalanceUnit = {
  id: string
  name: string
  site: string
  row: string
  keeperId: string | null
}

export type BalanceMove = { unitId: string; fromKeeperId: string | null; toKeeperId: string }

export function balance(opts: {
  units: BalanceUnit[]
  capacity: number
  /** Only move units of these keepers (and units without a keeper); default every over-capacity keeper. */
  sources?: Set<string>
  /** Keepers that may receive (e.g. not away); default every keeper. */
  eligible?: (keeperId: string) => boolean
  maxMoves: number
}): { moves: BalanceMove[]; unplaced: number } {
  const { units, capacity, maxMoves } = opts
  const eligible = opts.eligible ?? (() => true)
  const load = new Map<string, number>()
  const keepersAt = new Map<string, Set<string>>()
  const rowsOf = new Map<string, Set<string>>()
  for (const u of units) {
    if (!u.keeperId) continue
    load.set(u.keeperId, (load.get(u.keeperId) ?? 0) + 1)
    if (!keepersAt.has(u.site)) keepersAt.set(u.site, new Set())
    keepersAt.get(u.site)!.add(u.keeperId)
    const rk = `${u.site}|${u.row}`
    if (!rowsOf.has(rk)) rowsOf.set(rk, new Set())
    rowsOf.get(rk)!.add(u.keeperId)
  }

  // The pool: units without a keeper, then each source keeper's excess (last units by name).
  const pool: BalanceUnit[] = units
    .filter((u) => !u.keeperId)
    .sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  const byKeeper = new Map<string, BalanceUnit[]>()
  for (const u of units) {
    if (!u.keeperId) continue
    if (!byKeeper.has(u.keeperId)) byKeeper.set(u.keeperId, [])
    byKeeper.get(u.keeperId)!.push(u)
  }
  for (const [k, list] of [...byKeeper.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const over = list.length - capacity
    const chosen = opts.sources ? opts.sources.has(k) : over > 0
    if (!chosen || over <= 0) continue
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    pool.push(...list.slice(list.length - over))
  }

  const moves: BalanceMove[] = []
  let unplaced = 0
  for (const u of pool) {
    if (moves.length >= maxMoves) {
      unplaced += 1
      continue
    }
    const sameRow = rowsOf.get(`${u.site}|${u.row}`) ?? new Set()
    const candidates = [...(keepersAt.get(u.site) ?? [])].filter(
      (k) => k !== u.keeperId && eligible(k) && (load.get(k) ?? 0) < capacity,
    )
    if (!candidates.length) {
      unplaced += 1
      continue
    }
    candidates.sort((a, b) => {
      const la = load.get(a) ?? 0
      const lb = load.get(b) ?? 0
      // Same row wins when within one unit of the lightest.
      const ra = sameRow.has(a) ? 1 : 0
      const rb = sameRow.has(b) ? 1 : 0
      if (Math.abs(la - lb) <= 1 && ra !== rb) return rb - ra
      return la - lb || a.localeCompare(b)
    })
    const to = candidates[0]
    moves.push({ unitId: u.id, fromKeeperId: u.keeperId, toKeeperId: to })
    load.set(to, (load.get(to) ?? 0) + 1)
    if (u.keeperId) load.set(u.keeperId, (load.get(u.keeperId) ?? 0) - 1)
    sameRow.add(to)
    rowsOf.set(`${u.site}|${u.row}`, sameRow)
  }
  return { moves, unplaced }
}

/**
 * Escalation stage for a site at a moment (pure). 0 = before the deadline,
 * 1 = keeper, 2 = backup, 3 = managers. Stops after `windowMin` past the
 * manager stage so a late run never wakes people in the evening.
 */
export function escalationStage(
  minutesNow: number,
  s: { deadline: string; backupAfterMin: number; managerAfterMin: number },
  windowMin = 240,
): 0 | 1 | 2 | 3 {
  const [h, m] = s.deadline.split(':').map(Number)
  const since = minutesNow - (h * 60 + m)
  if (since < 0) return 0
  if (since > Math.max(s.managerAfterMin, s.backupAfterMin) + windowMin) return 0
  if (since >= s.managerAfterMin) return 3
  if (since >= s.backupAfterMin) return 2
  return 1
}
