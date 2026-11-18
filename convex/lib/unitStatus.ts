/**
 * Unit status state machine (PROD-013).
 *
 *   empty ──stock──▶ active ──▶ harvesting ──harvest──▶ harvested ──▶ fallow ──▶ empty
 *     │                │  ▲                                  │           │
 *     └──▶ maintenance ◀┘  └──────────── (fish back) ─────────┘◀──────────┘
 *
 * "active" is the stocked state. Stocking, harvest and transfers move a unit
 * between empty/fallow/harvested and active as part of their own checks
 * (system transitions); `MANUAL_TRANSITIONS` lists what a person may set by
 * hand. Fish-count invariants hold either way: a stocked status needs fish,
 * an empty one needs none.
 */

export const UNIT_STATUSES = [
  'empty',
  'active',
  'harvesting',
  'harvested',
  'fallow',
  'maintenance',
] as const

export type UnitStatus = (typeof UNIT_STATUSES)[number]

/** Statuses that hold fish. */
export const STOCKED_STATUSES: ReadonlySet<UnitStatus> = new Set(['active', 'harvesting'])

/** Statuses that must hold no fish. */
export const EMPTY_STATUSES: ReadonlySet<UnitStatus> = new Set(['empty', 'harvested', 'fallow'])

/**
 * Transitions a person may make by hand. Going from empty to active is
 * stocking's job (approval, ABW and density checks), so it is not listed.
 */
export const MANUAL_TRANSITIONS: Record<UnitStatus, readonly UnitStatus[]> = {
  empty: ['maintenance', 'fallow'],
  active: ['harvesting', 'maintenance'],
  harvesting: ['active', 'maintenance'],
  harvested: ['fallow', 'maintenance', 'empty'],
  fallow: ['empty', 'maintenance'],
  // Back to work: stocked if fish stayed in during repairs, else empty.
  maintenance: ['active', 'empty', 'fallow'],
}

export const STATUS_LABELS: Record<UnitStatus, string> = {
  empty: 'Empty',
  active: 'Stocked',
  harvesting: 'Harvesting',
  harvested: 'Harvested',
  fallow: 'Fallow',
  maintenance: 'Maintenance',
}

function label(s: string) {
  return STATUS_LABELS[s as UnitStatus] ?? s
}

/** Why a manual change from `from` to `to` is refused, or null when allowed. */
export function transitionError(
  from: UnitStatus,
  to: UnitStatus,
  liveCount: number,
): string | null {
  if (from === to) return null
  if (!MANUAL_TRANSITIONS[from]?.includes(to)) {
    const allowed = MANUAL_TRANSITIONS[from] ?? []
    if (from === 'empty' && to === 'active') {
      return 'Stock the unit to make it active; stocking records the fish and checks density.'
    }
    return `A unit cannot go from ${label(from)} to ${label(to)}.${
      allowed.length ? ` Allowed: ${allowed.map(label).join(', ')}.` : ''
    }`
  }
  if (STOCKED_STATUSES.has(to) && liveCount <= 0) {
    return `${label(to)} needs fish in the unit; it has none.`
  }
  if (EMPTY_STATUSES.has(to) && liveCount > 0) {
    return `${label(to)} needs an empty unit; it still holds ${liveCount.toLocaleString('en-US')} fish. Harvest or transfer them first.`
  }
  return null
}

export function assertTransition(from: UnitStatus, to: UnitStatus, liveCount: number) {
  const err = transitionError(from, to, liveCount)
  if (err) throw new Error(err)
}

/** Statuses a person may choose next, with the reason any other is blocked. */
export function nextStatuses(from: UnitStatus, liveCount: number) {
  return (MANUAL_TRANSITIONS[from] ?? []).map((to) => {
    const reason = transitionError(from, to, liveCount)
    return { status: to, label: label(to), allowed: reason === null, reason }
  })
}
