/**
 * Platform maintenance mode (Paper 62). A console admin schedules a window
 * (start, end, optional message); while it is open every member sees the
 * maintenance screen and platform admins keep working. Queries have no
 * clock, so the app compares the window with its own time.
 *
 * The "Status page" button links to the STATUS_PAGE_URL deployment env var
 * and is hidden when it is not set (docs/ops/anowa-cutover.md).
 */
import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireConsoleAdmin } from './access'
import { recordPlatformEvent } from '../billing/ops'
import { userError } from '../lib/errors'

export const MAINTENANCE_MESSAGE_MAX = 280
/** Longest window one setting may hold. */
export const MAINTENANCE_MAX_MS = 7 * 24 * 60 * 60 * 1000

const windowValidator = v.object({
  startsAt: v.number(),
  endsAt: v.number(),
  message: v.union(v.string(), v.null()),
  updatedAt: v.number(),
})

async function currentRow(ctx: QueryCtx | MutationCtx) {
  return await ctx.db.query('systemMaintenance').first()
}

/** STATUS_PAGE_URL when it is an http(s) URL, else null. */
export function statusPageUrl(raw: string | undefined = process.env.STATUS_PAGE_URL): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * The scheduled window, read by every app page (signed in or not), and the
 * status page link. Null when nothing is scheduled.
 */
export const status = query({
  args: {},
  returns: v.object({
    window: v.union(windowValidator, v.null()),
    statusPageUrl: v.union(v.string(), v.null()),
  }),
  handler: async (ctx) => {
    const row = await currentRow(ctx)
    return {
      window: row
        ? { startsAt: row.startsAt, endsAt: row.endsAt, message: row.message ?? null, updatedAt: row.updatedAt }
        : null,
      statusPageUrl: statusPageUrl(),
    }
  },
})

/** Schedule (or replace) the maintenance window. Console admins only; audited. */
export const set = mutation({
  args: {
    startsAt: v.number(),
    endsAt: v.number(),
    message: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireConsoleAdmin(ctx)
    if (!Number.isFinite(args.startsAt) || !Number.isFinite(args.endsAt) || args.endsAt <= args.startsAt) {
      throw userError('VALIDATION', 'The end must be after the start')
    }
    if (args.endsAt <= Date.now()) {
      throw userError('VALIDATION', 'The end must be in the future')
    }
    if (args.endsAt - args.startsAt > MAINTENANCE_MAX_MS) {
      throw userError('VALIDATION', 'A maintenance window can last at most 7 days')
    }
    const message = args.message?.trim() || undefined
    if (message && message.length > MAINTENANCE_MESSAGE_MAX) {
      throw userError('VALIDATION', `The message can be at most ${MAINTENANCE_MESSAGE_MAX} characters`)
    }
    const row = { startsAt: args.startsAt, endsAt: args.endsAt, message, updatedBy: admin._id, updatedAt: Date.now() }
    const existing = await currentRow(ctx)
    let id
    if (existing) {
      await ctx.db.replace(existing._id, row)
      id = existing._id
    } else {
      id = await ctx.db.insert('systemMaintenance', row)
    }
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'maintenance.set',
      targetTable: 'systemMaintenance',
      targetId: id,
      details: { startsAt: args.startsAt, endsAt: args.endsAt, message: message ?? null },
    })
    return null
  },
})

/** End or cancel the maintenance window. Console admins only; audited. */
export const clear = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const admin = await requireConsoleAdmin(ctx)
    const existing = await currentRow(ctx)
    if (!existing) return null
    await ctx.db.delete(existing._id)
    await recordPlatformEvent(ctx, {
      actorId: admin._id,
      action: 'maintenance.clear',
      targetTable: 'systemMaintenance',
      targetId: existing._id,
      details: { startsAt: existing.startsAt, endsAt: existing.endsAt },
    })
    return null
  },
})
