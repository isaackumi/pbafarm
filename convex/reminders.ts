import { v } from 'convex/values'
import { internalMutation, mutation } from './_generated/server'
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

  const logged = new Set(
    (
      await ctx.db
        .query('dailyRecords')
        .withIndex('by_date', (q) => q.eq('date', date))
        .take(2000)
    )
      .filter((r) => r.companyId === companyId)
      .map((r) => r.cageId),
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

  // users has no company index yet; companies are small, so read and filter.
  const people = (await ctx.db.query('users').take(5000)).filter(
    (u) => u.companyId === companyId && u.active !== false,
  )
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

/** Run by the daily cron for every approved company. */
export const dailyDigest = internalMutation({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const day = date ?? todayUtc()
    const companies = (await ctx.db.query('companies').take(1000)).filter(
      (c) => c.status === 'approved',
    )
    let sent = 0
    for (const c of companies) {
      sent += (await digestForCompany(ctx, c._id, day)).sent
    }
    return { companies: companies.length, sent }
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
