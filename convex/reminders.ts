import { v } from 'convex/values'
import { internalMutation, mutation } from './_generated/server'
import { internal } from './_generated/api'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

import { todayIn, zoneFor } from './lib/dates'
import { requireMember } from './lib/permissions'
import { mergeSettings } from './lib/farmRules'
import { CHECKS, nameList } from './automation/checks'
import { effectiveKeeper } from './keepers/model'
import { onEngine } from './automation/rules'
import { createRun } from './automation/engine'

async function notifyOnce(
  ctx: MutationCtx,
  user: Doc<'users'>,
  dedupeKey: string,
  n: { title: string; message: string; type: string; link: string },
) {
  const seen = await ctx.db
    .query('notifications')
    .withIndex('by_dedupe', (q) => q.eq('dedupeKey', dedupeKey))
    .first()
  if (seen) return false
  await ctx.db.insert('notifications', {
    userId: user._id,
    title: n.title,
    message: n.message,
    type: n.type,
    read: false,
    link: n.link,
    companyId: user.companyId,
    dedupeKey,
  })
  return true
}

/**
 * One company's end-of-day check (legacy path, used until the company moves
 * onto automation rules): active cages with no daily entry for their site's
 * local date (sent to everyone, linking straight to a pre-filled daily
 * entry), feed types at or below their minimum stock and non-feed items at or
 * below their reorder level (sent to admins). The checks are shared with the
 * engine's built-in rules (convex/automation/checks.ts), so both send the
 * same text with the same dedupe keys.
 */
async function digestForCompany(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  /** Fixed date for every site (tests, manual runs); omitted = each site's local today. */
  fixedDate?: string,
) {
  const company = await ctx.db.get(companyId)
  const settings = mergeSettings(company?.settings)
  const now = Date.now()
  const date = fixedDate ?? todayIn(zoneFor(null, company), now)
  const at = fixedDate ? undefined : now
  const missing = await CHECKS.missed_daily_entry.run(ctx, companyId, date, {}, settings, at)
  const low = await CHECKS.low_feed_stock.run(ctx, companyId, date, {}, settings, at)
  const lowItems = await CHECKS.low_item_stock.run(ctx, companyId, date, {}, settings, at)

  const people = (
    await ctx.db
      .query('users')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .collect()
  ).filter((u) => u.active !== false)
  const admins = people.filter((u) => u.role === 'admin' || u.role === 'super_admin')

  let sent = 0
  const send = async (users: Doc<'users'>[], prefix: string, r: { title: string; message: string; link: string }) => {
    for (const u of users) {
      const ok = await notifyOnce(ctx, u, `${prefix}:${date}:${u._id}`, { ...r, type: 'warning' })
      if (ok) sent += 1
    }
  }
  if (missing.count) {
    // Cage keepers: each effective keeper gets their own units; admins the
    // whole list. Without keepers, everyone gets it as before.
    const byKeeper = await missingByKeeper(ctx, companyId, String(missing.unitIds ?? ''), date)
    if (byKeeper) {
      for (const [userId, units] of byKeeper) {
        const u = people.find((p) => p._id === userId)
        if (!u || admins.includes(u)) continue
        const ok = await notifyOnce(ctx, u, `missed-entry:${date}:${u._id}`, {
          title: `Daily entry missing for ${units.length} of your unit${units.length === 1 ? '' : 's'}`,
          message: `No feed or mortality logged on ${date} for ${nameList(units.map((x) => x.name))}.`,
          link: `/daily-entry?cages=${units.map((x) => x._id).join(',')}`,
          type: 'warning',
        })
        if (ok) sent += 1
      }
      await send(admins, 'missed-entry', missing)
    } else {
      await send(people, 'missed-entry', missing)
    }
  }
  if (low.count) await send(admins, 'low-stock', low)
  if (lowItems.count) await send(admins, 'low-items', lowItems)
  return { missingCages: missing.count, lowFeedTypes: low.count, lowItems: lowItems.count, sent }
}

/**
 * Missing units grouped by the person who should log them (cage keepers), or
 * null when the organization has no keepers yet.
 */
async function missingByKeeper(ctx: MutationCtx, companyId: Id<'companies'>, unitIds: string, date: string) {
  const any = await ctx.db
    .query('cageKeepers')
    .withIndex('by_companyId_and_active', (q) => q.eq('companyId', companyId).eq('active', true))
    .first()
  if (!any) return null
  const out = new Map<Id<'users'>, Doc<'cages'>[]>()
  for (const id of unitIds.split(',').filter(Boolean).slice(0, 500)) {
    const unit = await ctx.db.get(id as Id<'cages'>)
    if (!unit || unit.companyId !== companyId) continue
    const eff = await effectiveKeeper(ctx, unit, date)
    if (eff) out.set(eff.keeperId, [...(out.get(eff.keeperId) ?? []), unit])
  }
  return out
}

/** Approved companies handled per dailyDigest run before it continues. */
const DIGEST_PAGE_SIZE = 50

/**
 * Run by the daily cron. Pages through approved companies and schedules one
 * `companyDigest` per company, each in its own transaction: one company's
 * failure or size cannot roll back or starve another's reminders. Continues
 * itself with the next page until every approved company is scheduled.
 */
export const dailyDigest = internalMutation({
  args: { date: v.optional(v.string()), cursor: v.optional(v.string()) },
  returns: v.object({ scheduled: v.number(), done: v.boolean() }),
  handler: async (
    ctx,
    { date, cursor },
  ): Promise<{ scheduled: number; done: boolean }> => {
    // No date: each company works out its sites' local dates (FARM-001).
    const day = date
    const page = await ctx.db
      .query('companies')
      .withIndex('by_status', (q) => q.eq('status', 'approved'))
      .paginate({ numItems: DIGEST_PAGE_SIZE, cursor: cursor ?? null })
    for (const c of page.page) {
      await ctx.scheduler.runAfter(0, internal.reminders.companyDigest, {
        companyId: c._id,
        ...(day ? { date: day } : {}),
      })
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.reminders.dailyDigest, {
        ...(day ? { date: day } : {}),
        cursor: page.continueCursor,
      })
    }
    return { scheduled: page.page.length, done: page.isDone }
  },
})

const companyDigestItem = v.object({
  missingCages: v.number(),
  lowFeedTypes: v.number(),
  lowItems: v.number(),
  sent: v.number(),
})

/** One company's daily digest (scheduled by dailyDigest). */
export const companyDigest = internalMutation({
  args: { companyId: v.id('companies'), date: v.optional(v.string()) },
  returns: v.union(
    companyDigestItem,
    v.object({
      missingCages: v.number(),
      lowFeedTypes: v.number(),
      lowItems: v.number(),
      sent: v.number(),
      onEngine: v.boolean(),
    }),
  ),
  handler: async (ctx, { companyId, date }) => {
    const company = await ctx.db.get(companyId)
    if (!company || company.status !== 'approved') {
      return { missingCages: 0, lowFeedTypes: 0, lowItems: 0, sent: 0 }
    }
    // Moved onto automation rules (M17): the engine's built-in rules send
    // these reminders at the company's own time.
    if (await onEngine(ctx, companyId)) {
      return { missingCages: 0, lowFeedTypes: 0, lowItems: 0, sent: 0, onEngine: true }
    }
    return await digestForCompany(ctx, companyId, date)
  },
})


/** Admins can send today's reminders now instead of waiting for the evening run. */
export const runForMyCompanyNow = mutation({
  args: {},
  returns: v.union(
    companyDigestItem,
    v.object({
      missingCages: v.number(),
      lowFeedTypes: v.number(),
      lowItems: v.number(),
      sent: v.number(),
      onEngine: v.boolean(),
      runs: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const { user } = await requireMember(ctx, { permission: 'org.settings.manage' })
    if (!user.companyId) throw new Error('Your account is not linked to a company')
    const companyId = user.companyId
    if (await onEngine(ctx, companyId)) {
      // Run the company's enabled built-in reminder rules now instead.
      const rules = await ctx.db
        .query('automationRules')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(50)
      const now = Date.now()
      let runs = 0
      for (const rule of rules) {
        if (!rule.builtIn || !rule.enabled) continue
        if (await createRun(ctx, rule, { triggerKind: 'manual', dedupeKey: `${rule._id}:manual:${now}` })) runs += 1
      }
      return { missingCages: 0, lowFeedTypes: 0, lowItems: 0, sent: 0, onEngine: true, runs }
    }
    return await digestForCompany(ctx, companyId)
  },
})
