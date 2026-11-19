import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { userError } from './lib/errors'
import { requireAccount } from './lib/permissions'
import { cleanPreferences, invalidPreferenceFields } from './lib/userPreferences'

/**
 * Per-user display preferences (CUSTOM-007). They follow the person to any
 * device; the browser keeps a per-user copy only for offline first paint.
 */

const notifications = v.object({
  email: v.boolean(),
  push: v.boolean(),
  lowFeed: v.boolean(),
  mortalityAlert: v.boolean(),
  waterQualityAlert: v.boolean(),
})

const dashboard = v.object({
  defaultTimeRange: v.string(),
  showCharts: v.boolean(),
  showMetrics: v.boolean(),
  showStockings: v.boolean(),
  /** 'plain' | 'sky'; checked by invalidPreferenceFields. */
  homeHeader: v.optional(v.string()),
})

const prefsFields = {
  dateFormat: v.optional(v.string()),
  timeFormat: v.optional(v.string()),
  currency: v.optional(v.string()),
  notifications: v.optional(notifications),
  dashboard: v.optional(dashboard),
  /** null clears the choice and goes back to the default shortcuts. */
  mobileShortcuts: v.optional(v.union(v.array(v.string()), v.null())),
}

const prefsResult = v.object({
  dateFormat: v.optional(v.string()),
  timeFormat: v.optional(v.string()),
  currency: v.optional(v.string()),
  notifications: v.optional(notifications),
  dashboard: v.optional(dashboard),
  mobileShortcuts: v.optional(v.array(v.string())),
  updatedAt: v.number(),
})

async function rowFor(ctx: { db: QueryCtx['db'] }, userId: Id<'users'>) {
  return await ctx.db
    .query('userPreferences')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique()
}

function publicFields(row: Doc<'userPreferences'>) {
  return {
    dateFormat: row.dateFormat,
    timeFormat: row.timeFormat,
    currency: row.currency,
    notifications: row.notifications,
    dashboard: row.dashboard,
    mobileShortcuts: row.mobileShortcuts,
    updatedAt: row.updatedAt,
  }
}

/** My saved preferences, or null when I have never saved any. */
export const mine = query({
  args: {},
  returns: v.union(prefsResult, v.null()),
  handler: async (ctx) => {
    const user = await requireAccount(ctx)
    const row = await rowFor(ctx, user._id)
    return row ? publicFields(row) : null
  },
})

/** Save some of my preferences; fields not given keep their value. */
export const update = mutation({
  args: prefsFields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAccount(ctx)
    const bad = invalidPreferenceFields(args)
    if (bad.length > 0) throw userError('VALIDATION', `Invalid preference: ${bad.join(', ')}`)
    const { mobileShortcuts, ...rest } = args
    const fields = {
      ...rest,
      ...(mobileShortcuts !== undefined ? { mobileShortcuts: mobileShortcuts ?? undefined } : {}),
      updatedAt: Date.now(),
    }
    const row = await rowFor(ctx, user._id)
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert('userPreferences', { userId: user._id, ...fields })
    return null
  },
})

/**
 * First sign-in after CUSTOM-007: copy the settings this browser kept in
 * localStorage, but only if the account has none yet (another device may
 * have saved first). Invalid values are dropped. Returns whether it copied.
 */
export const importFromDevice = mutation({
  args: { settings: v.any() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await requireAccount(ctx)
    if (await rowFor(ctx, user._id)) return false
    const clean = cleanPreferences(args.settings)
    const now = Date.now()
    await ctx.db.insert('userPreferences', {
      userId: user._id,
      dateFormat: clean.dateFormat,
      timeFormat: clean.timeFormat,
      currency: clean.currency,
      notifications: clean.notifications,
      dashboard: clean.dashboard,
      mobileShortcuts: clean.mobileShortcuts ?? undefined,
      importedFromDeviceAt: now,
      updatedAt: now,
    })
    return true
  },
})

/** Account deletion (ENT-005): preferences are personal data. */
export async function deleteUserPreferences(ctx: MutationCtx, userId: Id<'users'>) {
  const row = await rowFor(ctx, userId)
  if (row) await ctx.db.delete(row._id)
}
