import { v } from 'convex/values'
import { internalMutation, mutation } from './_generated/server'
import { internal } from './_generated/api'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser, requireRole } from './lib/authz'

import { todayIn, zoneFor } from './lib/dates'
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
  /** Fixed date for every site (tests, manual runs); omitted = each site's local today. */
  fixedDate?: string,
) {
  const cages = await ctx.db
    .query('cages')
    .withIndex('by_company_status', (q) => q.eq('companyId', companyId).eq('status', 'active'))
    .take(500)

  // "Today" is each site's local date (FARM-001): its time zone, else the company's.
  const company = await ctx.db.get(companyId)
  const now = Date.now()
  const siteDates = new Map<string, string>()
  const dateOf = async (locationId: Id<'farmLocations'> | undefined) => {
    if (fixedDate) return fixedDate
    const key = locationId ?? 'none'
    let d = siteDates.get(key)
    if (!d) {
      const site = locationId ? await ctx.db.get(locationId) : null
      d = todayIn(zoneFor(site, company), now)
      siteDates.set(key, d)
    }
    return d
  }
  const cageDates = new Map<Id<'cages'>, string>()
  for (const c of cages) cageDates.set(c._id, await dateOf(c.locationId))
  const dates = [...new Set(cageDates.values())]
  const date = fixedDate ?? (await dateOf(undefined))

  // Only this company's rows for the date(s): other tenants' volume cannot push
  // a logged cage out of the window and cause a false reminder.
  const loggedRows = []
  for (const d of dates) {
    loggedRows.push(
      ...(await ctx.db
        .query('dailyRecords')
        .withIndex('by_company_and_date', (q) => q.eq('companyId', companyId).eq('date', d))
        .collect()),
    )
  }
  const logged = new Set(
    loggedRows.filter((r) => cageDates.get(r.cageId) === r.date).map((r) => r.cageId),
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

  // Non-feed items (INV-001) at or below their reorder level, company-wide.
  const items = (
    await ctx.db
      .query('inventoryItems')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(500)
  ).filter((i) => !i.deletedAt && i.active && i.minimumStock > 0)
  const lowItems: { name: string; unit: string; have: number; min: number }[] = []
  if (items.length) {
    const held = new Map<string, number>()
    for (const s of await ctx.db
      .query('inventoryItemStock')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .collect()) {
      held.set(String(s.itemId), (held.get(String(s.itemId)) ?? 0) + s.quantity)
    }
    for (const i of items) {
      const have = held.get(String(i._id)) ?? 0
      if (have <= i.minimumStock) lowItems.push({ name: i.name, unit: i.unit, have, min: i.minimumStock })
    }
    lowItems.sort((a, b) => a.have / a.min - b.have / b.min)
  }
  if (lowItems.length) {
    for (const u of admins) {
      const ok = await notifyOnce(ctx, u, `low-items:${date}:${u._id}`, {
        title: `Low stock: ${lowItems.length} item${lowItems.length === 1 ? '' : 's'}`,
        message: nameList(
          lowItems.map((i) => `${i.name} ${kg(i.have)} ${i.unit} left (minimum ${kg(i.min)} ${i.unit})`),
          4,
        ),
        type: 'warning',
        link: '/inventory/items',
      })
      if (ok) sent += 1
    }
  }
  return { missingCages: missing.length, lowFeedTypes: low.length, lowItems: lowItems.length, sent }
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

/** One company's daily digest (scheduled by dailyDigest). */
export const companyDigest = internalMutation({
  args: { companyId: v.id('companies'), date: v.optional(v.string()) },
  handler: async (ctx, { companyId, date }) => {
    const company = await ctx.db.get(companyId)
    if (!company || company.status !== 'approved') {
      return { missingCages: 0, lowFeedTypes: 0, lowItems: 0, sent: 0 }
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
    return await digestForCompany(ctx, user.companyId)
  },
})
