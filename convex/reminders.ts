import { v } from 'convex/values'
import { internalMutation, mutation } from './_generated/server'
import { internal } from './_generated/api'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser, requireRole } from './lib/authz'
import { mergeSettings } from './lib/farmRules'
import { CHECKS } from './automation/checks'
import { onEngine } from './automation/rules'
import { createRun } from './automation/engine'

const todayUtc = () => new Date().toISOString().split('T')[0]

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
 * One company's end-of-day check (legacy path, kept until the company moves
 * onto automation rules): active cages with no daily entry for the date
 * (sent to everyone, linking straight to a pre-filled daily entry), feed
 * types at or below their minimum stock and non-feed items at or below their
 * reorder level (sent to admins). The checks are shared with the engine's
 * built-in rules (convex/automation/checks.ts), so both send the same text.
 */
async function digestForCompany(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  date: string,
) {
  const company = await ctx.db.get(companyId)
  const settings = mergeSettings(company?.settings)
  const missing = await CHECKS.missed_daily_entry.run(ctx, companyId, date, {}, settings)
  const low = await CHECKS.low_feed_stock.run(ctx, companyId, date, {}, settings)
  const lowItems = await CHECKS.low_item_stock.run(ctx, companyId, date, {}, settings)

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
  if (missing.count) await send(people, 'missed-entry', missing)
  if (low.count) await send(admins, 'low-stock', low)
  if (lowItems.count) await send(admins, 'low-items', lowItems)
  return { missingCages: missing.count, lowFeedTypes: low.count, lowItems: lowItems.count, sent }
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
  handler: async (
    ctx,
    { date, cursor },
  ): Promise<{ scheduled: number; done: boolean }> => {
    const day = date ?? todayUtc()
    const page = await ctx.db
      .query('companies')
      .withIndex('by_status', (q) => q.eq('status', 'approved'))
      .paginate({ numItems: DIGEST_PAGE_SIZE, cursor: cursor ?? null })
    for (const c of page.page) {
      await ctx.scheduler.runAfter(0, internal.reminders.companyDigest, {
        companyId: c._id,
        date: day,
      })
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.reminders.dailyDigest, {
        date: day,
        cursor: page.continueCursor,
      })
    }
    return { scheduled: page.page.length, done: page.isDone }
  },
})

/** One company's daily digest (scheduled by dailyDigest). */
export const companyDigest = internalMutation({
  args: { companyId: v.id('companies'), date: v.string() },
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
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
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
    return await digestForCompany(ctx, companyId, todayUtc())
  },
})
