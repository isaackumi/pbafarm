import { v } from 'convex/values'
import { internalMutation, mutation } from './_generated/server'
import { internal } from './_generated/api'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser, requireRole } from './lib/authz'

const todayUtc = () => new Date().toISOString().split('T')[0]
const kg = (n: number) => Math.round(n).toLocaleString('en-US')

/** List names, but keep the message short: "B2, C1, C4 and 3 more". */
function nameList(names: string[], max = 6) {
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

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
 * One company's end-of-day check: active cages with no daily entry for the
 * date (sent to everyone, linking straight to a pre-filled daily entry) and
 * feed types at or below their minimum stock (sent to admins).
 */
async function digestForCompany(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  date: string,
) {
  const cages = await ctx.db
    .query('cages')
    .withIndex('by_company_status', (q) => q.eq('companyId', companyId).eq('status', 'active'))
    .take(500)

  // Only this company's rows for the date: other tenants' volume cannot push
  // a logged cage out of the window and cause a false reminder.
  const logged = new Set(
    (
      await ctx.db
        .query('dailyRecords')
        .withIndex('by_company_and_date', (q) =>
          q.eq('companyId', companyId).eq('date', date),
        )
        .collect()
    ).map((r) => r.cageId),
  )
  const missing = cages
    .filter((c) => !logged.has(c._id))
    .sort((a, b) => a.name.localeCompare(b.name))

  const low = (
    await ctx.db
      .query('feedTypes')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(500)
  )
    .filter(
      (f) =>
        !f.deletedAt &&
        f.active !== false &&
        (f.minimumStock ?? 0) > 0 &&
        f.currentStock <= f.minimumStock,
    )
    .sort((a, b) => a.currentStock - b.currentStock)

  const people = (
    await ctx.db
      .query('users')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .collect()
  ).filter((u) => u.active !== false)
  const admins = people.filter((u) => u.role === 'admin' || u.role === 'super_admin')

  let sent = 0
  if (missing.length) {
    const link = `/daily-entry?cages=${missing.map((c) => c._id).join(',')}`
    for (const u of people) {
      const ok = await notifyOnce(ctx, u, `missed-entry:${date}:${u._id}`, {
        title: `Daily entry missing for ${missing.length} cage${missing.length === 1 ? '' : 's'}`,
        message: `No feed or mortality logged on ${date} for ${nameList(missing.map((c) => c.name))} (${logged.size} of ${cages.length} done).`,
        type: 'warning',
        link,
      })
      if (ok) sent += 1
    }
  }
  if (low.length) {
    for (const u of admins) {
      const ok = await notifyOnce(ctx, u, `low-stock:${date}:${u._id}`, {
        title: `Low feed stock: ${low.length} feed type${low.length === 1 ? '' : 's'}`,
        message: nameList(
          low.map((f) => `${f.name} ${kg(f.currentStock)} kg left (minimum ${kg(f.minimumStock)} kg)`),
          4,
        ),
        type: 'warning',
        link: '/stock-levels',
      })
      if (ok) sent += 1
    }
  }
  return { missingCages: missing.length, lowFeedTypes: low.length, sent }
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
      return { missingCages: 0, lowFeedTypes: 0, sent: 0 }
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
    return await digestForCompany(ctx, user.companyId, todayUtc())
  },
})
