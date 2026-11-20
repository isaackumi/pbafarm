import { v } from 'convex/values'

/**
 * Keeper changes as Ask Anowa draft items (pendingBotActions.payload, channel
 * 'web'). Typed only: names are copied from the records when drafted, for
 * the card; ids are what confirm writes. Arrays are capped when built
 * (MAX_MOVES, MAX_NUDGES in ./model).
 */
export const keeperAssignPayload = v.object({
  kind: v.literal('keeper_assign'),
  /** assign = the manager chose who; rebalance = Auto-balance chose. */
  reason: v.union(v.literal('assign'), v.literal('rebalance')),
  moves: v.array(
    v.object({
      unitId: v.id('cages'),
      unitName: v.string(),
      fromKeeperId: v.optional(v.id('users')),
      fromName: v.optional(v.string()),
      toKeeperId: v.id('users'),
      toName: v.string(),
    }),
  ),
  backupId: v.optional(v.id('users')),
  backupName: v.optional(v.string()),
  /** Units Auto-balance could not place (nobody at the site has room). */
  unplaced: v.optional(v.number()),
})

export const keeperCoverPayload = v.object({
  kind: v.literal('keeper_cover'),
  keeperId: v.id('users'),
  keeperName: v.string(),
  coverId: v.id('users'),
  coverName: v.string(),
  fromDate: v.string(),
  toDate: v.string(),
  units: v.number(),
  split: v.optional(
    v.array(v.object({ unitId: v.id('cages'), unitName: v.string(), coverId: v.id('users'), coverName: v.string() })),
  ),
  note: v.optional(v.string()),
})

export const keeperNudgePayload = v.object({
  kind: v.literal('keeper_nudge'),
  keepers: v.array(
    v.object({ userId: v.id('users'), name: v.string(), due: v.number(), units: v.array(v.string()) }),
  ),
})

/** What a propose tool or a keeper screen sends (resolved and checked by convex/keepers/drafts.ts). */
export const keeperAssignInput = v.object({
  kind: v.literal('keeper_assign'),
  unitIds: v.optional(v.array(v.id('cages'))),
  /** Unit names or codes as typed ("D-01"), or a row ("row D") with `site`. */
  units: v.optional(v.array(v.string())),
  row: v.optional(v.string()),
  site: v.optional(v.string()),
  keeperId: v.optional(v.id('users')),
  keeper: v.optional(v.string()),
  backupId: v.optional(v.id('users')),
  backup: v.optional(v.string()),
  /** Drag-and-drop on the drill-in: each unit to a keeper. */
  moves: v.optional(v.array(v.object({ unitId: v.id('cages'), keeperId: v.id('users') }))),
})

export const keeperRebalanceInput = v.object({
  kind: v.literal('keeper_rebalance'),
  siteId: v.optional(v.id('farmLocations')),
  site: v.optional(v.string()),
  /** Only move these keepers' units (bulk bar); default every keeper over capacity. */
  keeperIds: v.optional(v.array(v.id('users'))),
  keepers: v.optional(v.array(v.string())),
  /** Only give units without a keeper a keeper (brief fix). */
  unassignedOnly: v.optional(v.boolean()),
  row: v.optional(v.string()),
})

export const keeperCoverInput = v.object({
  kind: v.literal('keeper_cover'),
  keeperId: v.optional(v.id('users')),
  keeper: v.optional(v.string()),
  coverId: v.optional(v.id('users')),
  cover: v.optional(v.string()),
  /** YYYY-MM-DD; default today. */
  fromDate: v.optional(v.string()),
  /** Day the keeper is back (YYYY-MM-DD), or `days` away. */
  toDate: v.optional(v.string()),
  days: v.optional(v.number()),
  split: v.optional(v.array(v.object({ unitId: v.id('cages'), coverId: v.id('users') }))),
  note: v.optional(v.string()),
})

export const keeperNudgeInput = v.object({
  kind: v.literal('keeper_nudge'),
  keeperIds: v.optional(v.array(v.id('users'))),
  keepers: v.optional(v.array(v.string())),
})

export const KEEPER_KINDS = ['keeper_assign', 'keeper_cover', 'keeper_nudge'] as const
export type KeeperKind = (typeof KEEPER_KINDS)[number]
export function isKeeperKind(kind: string): kind is KeeperKind {
  return (KEEPER_KINDS as readonly string[]).includes(kind)
}
