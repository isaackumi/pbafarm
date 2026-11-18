import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { DEFAULT_PREFS } from './automation/engine'
import { parseHhmm } from './automation/schedule'
import { quietHours } from './automation/validators'
import { requireAccount } from './lib/permissions'

/**
 * Per-user notification channels and quiet hours (AUTO-003). Automation
 * rules choose channels; each person can turn a channel off for themselves.
 * During quiet hours (company time) SMS/WhatsApp/email are skipped; in-app
 * notifications still arrive.
 */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAccount(ctx)
    const row = await ctx.db
      .query('notificationPreferences')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .first()
    return {
      inApp: row?.inApp ?? DEFAULT_PREFS.inApp,
      sms: row?.sms ?? DEFAULT_PREFS.sms,
      whatsapp: row?.whatsapp ?? DEFAULT_PREFS.whatsapp,
      email: row?.email ?? DEFAULT_PREFS.email,
      quietHours: row?.quietHours ?? null,
      hasPhone: !!user.phone,
      hasEmail: !!user.email,
    }
  },
})

export const update = mutation({
  args: {
    inApp: v.boolean(),
    sms: v.boolean(),
    whatsapp: v.boolean(),
    email: v.boolean(),
    quietHours: v.optional(v.union(quietHours, v.null())),
  },
  handler: async (ctx, args) => {
    const user = await requireAccount(ctx)
    const qh = args.quietHours ?? undefined
    if (qh && (!parseHhmm(qh.start) || !parseHhmm(qh.end))) throw new Error('Quiet hours must be HH:MM')
    const fields = {
      inApp: args.inApp,
      sms: args.sms,
      whatsapp: args.whatsapp,
      email: args.email,
      quietHours: qh,
      updatedAt: Date.now(),
    }
    const row = await ctx.db
      .query('notificationPreferences')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .first()
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert('notificationPreferences', { userId: user._id, ...fields })
    return null
  },
})
