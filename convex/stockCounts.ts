import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertOwns, logAudit, writeCompanyId, writeLocationId } from './lib/tenancy'
import { requireMember } from './lib/permissions'
import { userError } from './lib/errors'
import { applyStockChange, siteStock } from './lib/feedLedger'
import { move, stockRow } from './inventoryItems'

/**
 * Stock counts (INV-011): a cycle count of feed and stock items at one site.
 *
 * Starting a count snapshots what the system holds at the site (feed: the
 * site's lots plus unassigned stock, as the ledger checks it; items: the
 * site's stock row). Staff enter what they counted; an admin posts the count,
 * which writes one site adjustment per counted line that differs from the
 * snapshot (referenceId = the count). Lines left blank are not adjusted.
 * Count when the store is quiet: movements after the snapshot are not netted.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const round3 = (n: number) => Math.round(n * 1000) / 1000
const EPS = 1e-6

type Line = Doc<'stockCounts'>['lines'][number]

function toClientCount(c: Doc<'stockCounts'>, siteName: string | null) {
  const counted = c.lines.filter((l) => l.counted !== undefined)
  return {
    id: c._id,
    _id: c._id,
    location_id: c.locationId,
    site_name: siteName,
    count_date: c.countDate,
    status: c.status,
    notes: c.notes ?? null,
    lines: c.lines.map((l, index) => ({
      index,
      kind: l.kind,
      feed_type_id: l.feedTypeId ?? null,
      item_id: l.itemId ?? null,
      name: l.name,
      unit: l.unit,
      expected: l.expected,
      counted: l.counted ?? null,
      difference: l.counted !== undefined ? round3(l.counted - l.expected) : null,
      variance: l.variance ?? null,
    })),
    line_count: c.lines.length,
    counted_count: counted.length,
    difference_count: counted.filter((l) => Math.abs((l.counted ?? 0) - l.expected) > EPS).length,
    posted_at: c.postedAt ?? null,
    created_at: c._creationTime,
  }
}

async function loadCount(ctx: MutationCtx, user: Doc<'users'>, id: Id<'stockCounts'>) {
  const count = await ctx.db.get(id)
  assertOwns(user, count, 'Stock count')
  return count
}

function requireDraft(count: Doc<'stockCounts'>) {
  if (count.status !== 'draft') throw userError('CONFLICT', 'This count is already posted or cancelled')
}

export const listCounts = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.view' })
    if (!user.companyId) return []
    const companyId = user.companyId
    const rows = args.locationId
      ? await ctx.db
          .query('stockCounts')
          .withIndex('by_company_and_location', (q) =>
            q.eq('companyId', companyId).eq('locationId', args.locationId!),
          )
          .order('desc')
          .take(100)
      : await ctx.db
          .query('stockCounts')
          .withIndex('by_company', (q) => q.eq('companyId', companyId))
          .order('desc')
          .take(100)
    const names = new Map<string, string | null>()
    const out = []
    for (const c of rows) {
      try {
        assertOwns(user, c, 'Stock count')
      } catch {
        continue
      }
      if (!names.has(c.locationId)) names.set(c.locationId, (await ctx.db.get(c.locationId))?.name ?? null)
      out.push(toClientCount(c, names.get(c.locationId) ?? null))
    }
    return out
  },
})

export const getCount = query({
  args: { id: v.id('stockCounts') },
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.view' })
    const count = await ctx.db.get(id)
    if (!count) return null
    try {
      assertOwns(user, count, 'Stock count')
    } catch {
      return null
    }
    const site = await ctx.db.get(count.locationId)
    return toClientCount(count, site?.name ?? null)
  },
})

/** Snapshot the site's feed and item stock into a new draft count. */
export const startCount = mutation({
  args: {
    locationId: v.id('farmLocations'),
    countDate: v.string(),
    include: v.optional(v.union(v.literal('all'), v.literal('feed'), v.literal('items'))),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.issue' })
    const companyId = await writeCompanyId(user)
    const locationId = (await writeLocationId(ctx, user, args.locationId))!
    if (!DATE_RE.test(args.countDate)) throw userError('VALIDATION', 'Count date must be a date (YYYY-MM-DD)')

    const open = await ctx.db
      .query('stockCounts')
      .withIndex('by_company_and_location', (q) => q.eq('companyId', companyId).eq('locationId', locationId))
      .order('desc')
      .take(20)
    if (open.some((c) => c.status === 'draft')) {
      throw userError('CONFLICT', 'A count is already open at this site. Post or cancel it first.')
    }

    const include = args.include ?? 'all'
    const lines: Line[] = []
    if (include !== 'items') {
      const feedTypes = await ctx.db
        .query('feedTypes')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .collect()
      for (const f of feedTypes.filter((f) => f.active && !f.deletedAt).sort((a, b) => a.name.localeCompare(b.name))) {
        const stock = await siteStock(ctx, f, locationId)
        lines.push({ kind: 'feed', feedTypeId: f._id, name: f.name, unit: 'kg', expected: round3(stock.available) })
      }
    }
    if (include !== 'feed') {
      const items = await ctx.db
        .query('inventoryItems')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .collect()
      for (const item of items.filter((i) => i.active && !i.deletedAt).sort((a, b) => a.name.localeCompare(b.name))) {
        const row = await stockRow(ctx, item._id, locationId)
        lines.push({ kind: 'item', itemId: item._id, name: item.name, unit: item.unit, expected: round3(row?.quantity ?? 0) })
      }
    }
    if (!lines.length) throw userError('VALIDATION', 'Nothing to count: add feed types or stock items first')

    const id = await ctx.db.insert('stockCounts', {
      companyId,
      locationId,
      countDate: args.countDate,
      status: 'draft',
      lines,
      notes: args.notes?.trim() || undefined,
      createdBy: user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'stockCounts',
      recordId: id,
      newValues: { locationId, countDate: args.countDate, include, lines: lines.length },
      locationId,
    })
    return id
  },
})

/** Enter counted quantities (null clears a line). */
export const updateCountLines = mutation({
  args: {
    id: v.id('stockCounts'),
    lines: v.array(v.object({ index: v.number(), counted: v.union(v.number(), v.null()) })),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.issue' })
    const count = await loadCount(ctx, user, args.id)
    requireDraft(count)
    const lines = [...count.lines]
    for (const { index, counted } of args.lines) {
      const line = lines[index]
      if (!Number.isInteger(index) || !line) throw userError('VALIDATION', `No line ${index} on this count`)
      if (counted !== null && (!Number.isFinite(counted) || counted < 0)) {
        throw userError('VALIDATION', `Counted quantity for ${line.name} must be zero or more`)
      }
      lines[index] = { ...line, counted: counted === null ? undefined : round3(counted) }
    }
    await ctx.db.patch(count._id, { lines, updatedAt: Date.now() })
    return count._id
  },
})

/** Post the count: one site adjustment per counted line that differs. */
export const postCount = mutation({
  args: { id: v.id('stockCounts') },
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.adjust' })
    const count = await loadCount(ctx, user, id)
    requireDraft(count)
    if (!count.lines.some((l) => l.counted !== undefined)) {
      throw userError('VALIDATION', 'Enter at least one counted quantity before posting')
    }
    const site = await ctx.db.get(count.locationId)
    const notes = `Stock count ${count.countDate} at ${site?.name ?? 'site'}`
    const lines: Line[] = []
    let adjusted = 0
    for (const line of count.lines) {
      if (line.counted === undefined) {
        lines.push(line)
        continue
      }
      const variance = round3(line.counted - line.expected)
      if (Math.abs(variance) <= EPS) {
        lines.push({ ...line, variance: 0 })
        continue
      }
      if (line.kind === 'feed' && line.feedTypeId) {
        await applyStockChange(ctx, {
          user,
          feedTypeId: line.feedTypeId,
          deltaKg: variance,
          transactionType: 'adjustment',
          referenceId: String(count._id),
          notes,
          location: site?.name,
          locationId: count.locationId,
        })
      } else if (line.kind === 'item' && line.itemId) {
        const item = await ctx.db.get(line.itemId)
        assertOwns(user, item, 'Item')
        await move(ctx, user, item, {
          locationId: count.locationId,
          type: 'adjustment',
          quantity: variance,
          date: count.countDate,
          notes,
        })
      }
      adjusted += 1
      lines.push({ ...line, variance })
    }
    await ctx.db.patch(count._id, {
      lines,
      status: 'posted',
      postedBy: user._id,
      postedAt: Date.now(),
      updatedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'stock_adjustment',
      tableName: 'stockCounts',
      recordId: count._id,
      newValues: { posted: true, adjusted },
      locationId: count.locationId,
    })
    return { adjusted }
  },
})

export const cancelCount = mutation({
  args: { id: v.id('stockCounts') },
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.adjust' })
    const count = await loadCount(ctx, user, id)
    requireDraft(count)
    await ctx.db.patch(count._id, { status: 'cancelled', updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'stockCounts',
      recordId: count._id,
      previousValues: { status: count.status },
      locationId: count.locationId,
    })
  },
})
