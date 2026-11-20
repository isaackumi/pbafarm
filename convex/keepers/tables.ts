import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Cage keepers (Paper "Cage keepers", artboards 54 to 57). Spread into the
 * schema like botTables so the schema diff stays additive.
 *
 * - cageKeepers: who keeps a unit, with history. One open row per unit
 *   (`active: true`, no `untilDate`); reassigning closes the open row and adds
 *   a new one, so the history is the unit's rows by date.
 * - keeperCovers: a keeper away for a date range, their units covered by one
 *   person or split between several. The effective keeper for a date is the
 *   cover when one is active, else the assignment (convex/keepers/model.ts).
 * - keeperSettings: one row per organization (capacity, deadline, escalation
 *   and the "own cages only" rule). Missing row = defaults.
 * - keeperScores: the coaching scorecard per keeper and the farm average,
 *   precomputed once a day (convex/keepers/scores.ts) so no screen reads two
 *   weeks of records for a thousand units.
 */

const coverSplit = v.object({ unitId: v.id('cages'), coverId: v.id('users') })

export const keeperTables = {
  cageKeepers: defineTable({
    companyId: v.id('companies'),
    unitId: v.id('cages'),
    /** The unit's site when assigned (scope filter and per-site boards). */
    locationId: v.optional(v.id('farmLocations')),
    keeperId: v.id('users'),
    backupId: v.optional(v.id('users')),
    /** Site-local date the assignment starts (inclusive). */
    sinceDate: v.string(),
    /** Site-local date it ended (exclusive); unset while open. */
    untilDate: v.optional(v.string()),
    /** true for the unit's open assignment. */
    active: v.boolean(),
    assignedBy: v.id('users'),
    assignedAt: v.number(),
    endedBy: v.optional(v.id('users')),
    endedAt: v.optional(v.number()),
    /** The Anowa draft item that made this change (Undo). */
    sourceDraft: v.optional(v.id('pendingBotActions')),
    /** The open row this one replaced (Undo reopens it). */
    replaces: v.optional(v.id('cageKeepers')),
  })
    .index('by_companyId_and_active', ['companyId', 'active'])
    .index('by_unitId_and_active', ['unitId', 'active'])
    .index('by_keeperId_and_active', ['keeperId', 'active'])
    .index('by_backupId_and_active', ['backupId', 'active'])
    .index('by_sourceDraft', ['sourceDraft']),

  keeperCovers: defineTable({
    companyId: v.id('companies'),
    /** The keeper who is away. */
    keeperId: v.id('users'),
    /** Who covers every unit not in `split`. */
    coverId: v.id('users'),
    /** Units given to someone else than `coverId` (at most 200). */
    split: v.optional(v.array(coverSplit)),
    /** First day away and the day they are back (both site-local, `fromDate` <= day < `toDate`). */
    fromDate: v.string(),
    toDate: v.string(),
    note: v.optional(v.string()),
    createdBy: v.id('users'),
    createdAt: v.number(),
    cancelledAt: v.optional(v.number()),
    cancelledBy: v.optional(v.id('users')),
    sourceDraft: v.optional(v.id('pendingBotActions')),
  })
    .index('by_companyId_and_toDate', ['companyId', 'toDate'])
    .index('by_keeperId_and_toDate', ['keeperId', 'toDate'])
    .index('by_sourceDraft', ['sourceDraft']),

  keeperSettings: defineTable({
    companyId: v.id('companies'),
    /** Cages one keeper should hold before the board calls it over capacity (default 25). */
    capacity: v.optional(v.number()),
    /** Daily entry deadline, site-local "HH:MM" (default "10:00"). */
    deadline: v.optional(v.string()),
    /** Minutes after the deadline to tell the backup, then the managers (defaults 60 and 120). */
    backupAfterMin: v.optional(v.number()),
    managerAfterMin: v.optional(v.number()),
    /** Escalation on/off (default on once any unit has a keeper). */
    escalate: v.optional(v.boolean()),
    /** Members without production.keepers.manage may log only units they keep (default off). */
    ownCagesOnly: v.optional(v.boolean()),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id('users')),
  }).index('by_companyId', ['companyId']),

  /**
   * Once-only marker of a keeper reminder, escalation or nudge per person
   * (`key` = kind:stage:date:userId). notifyUsers' own dedupe needs an in-app
   * row, which a member can turn off; this one holds for every channel.
   * Pruned after 30 days.
   */
  keeperAlerts: defineTable({
    companyId: v.id('companies'),
    key: v.string(),
    userId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_createdAt', ['createdAt'])
    .index('by_companyId_and_createdAt', ['companyId', 'createdAt']),

  keeperScores: defineTable({
    companyId: v.id('companies'),
    /** Unset = the farm average row. */
    keeperId: v.optional(v.id('users')),
    /** Site-local date the scores were computed for. */
    asOf: v.string(),
    units: v.number(),
    /** Entries made on their day over unit-days, last 14 days; null when no unit-days. */
    onTimePct: v.union(v.number(), v.null()),
    survivalPct: v.union(v.number(), v.null()),
    fcr: v.union(v.number(), v.null()),
    /** Units sampled in the last 14 days, over units stocked. */
    sampled: v.number(),
    stocked: v.number(),
    /** Highest-FCR unit, for "B-12 high". */
    worstFcrUnit: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_keeperId', ['companyId', 'keeperId']),
}
