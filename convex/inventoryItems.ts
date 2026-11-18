import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertOwns, ensureDefaultLocation, logAudit, writeCompanyId, writeLocationId } from './lib/tenancy'
import { tenantScope } from './lib/scope'
import { requireMember } from './lib/permissions'

/**
 * Non-feed inventory (INV-001): chemicals, drugs, nets, equipment, fuel,
 * spares. Stock is held per site; every change is a signed movement, and a
 * transfer between sites is two movements (out and in) sharing a
 * transferId.
 *
 * Roles follow the feed store: anyone in the company adds items, receives
 * and issues; editing items, adjustments and transfers are admin only.
 */

export const ITEM_CATEGORIES = ['chemical', 'drug', 'net', 'equipment', 'fuel', 'spare', 'other'] as const

const itemCategory = v.union(...ITEM_CATEGORIES.map((c) => v.literal(c)))

type MovementType = Doc<'inventoryMovements'>['type']

const EPS = 1e-9
const today = () => new Date().toISOString().slice(0, 10)

async function loadItem(ctx: MutationCtx, user: Doc<'users'>, id: Id<'inventoryItems'>) {
  const item = await ctx.db.get(id)
  assertOwns(user, item, 'Item')
  if (item.deletedAt) throw new Error('Item not found')
  return item
}

async function siteFor(ctx: MutationCtx, user: Doc<'users'>, locationId?: Id<'farmLocations'>) {
  return (await writeLocationId(ctx, user, locationId)) || (await ensureDefaultLocation(ctx, user))
}

async function stockRow(ctx: QueryCtx | MutationCtx, itemId: Id<'inventoryItems'>, locationId: Id<'farmLocations'>) {
  return await ctx.db
    .query('inventoryItemStock')
    .withIndex('by_item_and_location', (q) => q.eq('itemId', itemId).eq('locationId', locationId))
    .unique()
}

/** Apply one signed movement at a site. Stock never goes below zero. */
async function move(
  ctx: MutationCtx,
  user: Doc<'users'>,
  item: Doc<'inventoryItems'>,
  args: {
    locationId: Id<'farmLocations'>
    type: MovementType
    quantity: number
    date?: string
    unitCost?: number
    cageId?: Id<'cages'>
    supplierId?: Id<'feedSuppliers'>
    transferId?: string
    notes?: string
  },
) {
  if (!Number.isFinite(args.quantity) || args.quantity === 0) {
    throw new Error('Quantity must be a non-zero number')
  }
  const row = await stockRow(ctx, item._id, args.locationId)
  const have = row?.quantity ?? 0
  const next = have + args.quantity
  if (next < -EPS) {
    const site = await ctx.db.get(args.locationId)
    throw new Error(
      `Not enough ${item.name} at ${site?.name ?? 'this site'}: ${have} ${item.unit} there, ${Math.abs(args.quantity)} ${item.unit} needed`,
    )
  }
  const now = Date.now()
  if (row) {
    await ctx.db.patch(row._id, { quantity: Math.max(0, next), updatedAt: now })
  } else {
    await ctx.db.insert('inventoryItemStock', {
      companyId: item.companyId,
      itemId: item._id,
      locationId: args.locationId,
      quantity: Math.max(0, next),
      updatedAt: now,
    })
  }
  return await ctx.db.insert('inventoryMovements', {
    companyId: item.companyId,
    itemId: item._id,
    locationId: args.locationId,
    type: args.type,
    quantity: args.quantity,
    unitCost: args.unitCost,
    cageId: args.cageId,
    supplierId: args.supplierId,
    transferId: args.transferId,
    date: args.date ?? today(),
    notes: args.notes?.trim() || undefined,
    createdBy: user._id,
  })
}

function positive(q: number) {
  if (!Number.isFinite(q) || !(q > 0)) throw new Error('Quantity must be greater than zero')
  return q
}

/** Items with total and per-site stock, low-stock flag, newest names first. */
export const listItems = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.view' })
    const scope = tenantScope(user)
    if (scope.kind !== 'company') return []
    const items = (
      await ctx.db
        .query('inventoryItems')
        .withIndex('by_company', (q) => q.eq('companyId', scope.companyId))
        .take(1000)
    ).filter((i) => args.includeArchived || !i.deletedAt)
    const stock = await ctx.db
      .query('inventoryItemStock')
      .withIndex('by_company', (q) => q.eq('companyId', scope.companyId))
      .collect()
    const sites = new Map<string, string>()
    for (const s of stock) {
      const key = String(s.locationId)
      if (!sites.has(key)) sites.set(key, (await ctx.db.get(s.locationId))?.name ?? '')
    }
    const supplierNames = new Map<string, string>()
    const out = []
    for (const item of items) {
      const levels = stock
        .filter((s) => s.itemId === item._id)
        .map((s) => ({ location_id: s.locationId, location_name: sites.get(String(s.locationId)) || '', quantity: s.quantity }))
      const total = levels.reduce((s, l) => s + l.quantity, 0)
      let supplierName: string | null = null
      if (item.supplierId) {
        const key = String(item.supplierId)
        if (!supplierNames.has(key)) supplierNames.set(key, (await ctx.db.get(item.supplierId))?.name ?? '')
        supplierName = supplierNames.get(key) || null
      }
      out.push({
        id: item._id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        minimum_stock: item.minimumStock,
        unit_cost: item.unitCost ?? null,
        supplier_id: item.supplierId ?? null,
        supplier_name: supplierName,
        active: item.active && !item.deletedAt,
        total,
        site_quantity: args.locationId
          ? (levels.find((l) => l.location_id === args.locationId)?.quantity ?? 0)
          : null,
        levels,
        low: item.minimumStock > 0 && total <= item.minimumStock,
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  },
})

export const listMovements = query({
  args: { itemId: v.optional(v.id('inventoryItems')), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.view' })
    const scope = tenantScope(user)
    if (scope.kind !== 'company') return []
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500)
    const rows = args.itemId
      ? await ctx.db
          .query('inventoryMovements')
          .withIndex('by_company_and_item', (q) => q.eq('companyId', scope.companyId).eq('itemId', args.itemId!))
          .order('desc')
          .take(limit)
      : await ctx.db
          .query('inventoryMovements')
          .withIndex('by_company_and_date', (q) => q.eq('companyId', scope.companyId))
          .order('desc')
          .take(limit)
    const names = new Map<string, string>()
    const nameOf = async (id?: Id<'inventoryItems'> | Id<'farmLocations'> | Id<'cages'>) => {
      if (!id) return null
      const key = String(id)
      if (!names.has(key)) names.set(key, ((await ctx.db.get(id)) as { name?: string } | null)?.name ?? '')
      return names.get(key) || null
    }
    const out = []
    for (const m of rows) {
      out.push({
        id: m._id,
        item_id: m.itemId,
        item_name: await nameOf(m.itemId),
        location_name: await nameOf(m.locationId),
        cage_name: await nameOf(m.cageId),
        type: m.type,
        quantity: m.quantity,
        unit_cost: m.unitCost ?? null,
        date: m.date,
        notes: m.notes ?? '',
      })
    }
    return out
  },
})

export const createItem = mutation({
  args: {
    name: v.string(),
    category: itemCategory,
    unit: v.string(),
    minimumStock: v.optional(v.number()),
    supplierId: v.optional(v.id('feedSuppliers')),
    unitCost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.purchase.record' })
    const companyId = await writeCompanyId(user)
    const name = args.name.trim()
    if (!name) throw new Error('Item name is required')
    if (!args.unit.trim()) throw new Error('Unit is required')
    if (args.supplierId) assertOwns(user, await ctx.db.get(args.supplierId), 'Supplier')
    const id = await ctx.db.insert('inventoryItems', {
      companyId,
      name,
      category: args.category,
      unit: args.unit.trim(),
      minimumStock: Math.max(0, args.minimumStock ?? 0),
      supplierId: args.supplierId,
      unitCost: args.unitCost,
      active: true,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, { actionType: 'create', tableName: 'inventoryItems', recordId: id, newValues: args })
    return id
  },
})

export const updateItem = mutation({
  args: {
    id: v.id('inventoryItems'),
    name: v.optional(v.string()),
    category: v.optional(itemCategory),
    unit: v.optional(v.string()),
    minimumStock: v.optional(v.number()),
    supplierId: v.optional(v.union(v.id('feedSuppliers'), v.null())),
    unitCost: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.prices.manage' })
    const item = await loadItem(ctx, user, args.id)
    const patch: Partial<Doc<'inventoryItems'>> = { updatedAt: Date.now() }
    if (args.name !== undefined) {
      if (!args.name.trim()) throw new Error('Item name is required')
      patch.name = args.name.trim()
    }
    if (args.category !== undefined) patch.category = args.category
    if (args.unit !== undefined) patch.unit = args.unit.trim()
    if (args.minimumStock !== undefined) patch.minimumStock = Math.max(0, args.minimumStock)
    if (args.supplierId !== undefined) {
      if (args.supplierId) assertOwns(user, await ctx.db.get(args.supplierId), 'Supplier')
      patch.supplierId = args.supplierId ?? undefined
    }
    if (args.unitCost !== undefined) patch.unitCost = args.unitCost
    if (args.active !== undefined) patch.active = args.active
    await ctx.db.patch(args.id, patch)
    await logAudit(ctx, { actionType: 'update', tableName: 'inventoryItems', recordId: args.id, previousValues: item, newValues: patch })
    return args.id
  },
})

/** Archive an item. Its movements stay; stock must be zero first. */
export const archiveItem = mutation({
  args: { id: v.id('inventoryItems') },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.adjust' })
    const item = await loadItem(ctx, user, args.id)
    const rows = await ctx.db
      .query('inventoryItemStock')
      .withIndex('by_item_and_location', (q) => q.eq('itemId', item._id))
      .collect()
    if (rows.some((r) => r.quantity > EPS)) {
      throw new Error(`${item.name} still has stock; issue or adjust it to zero first`)
    }
    await ctx.db.patch(args.id, { deletedAt: Date.now(), active: false, updatedAt: Date.now() })
    await logAudit(ctx, { actionType: 'delete', tableName: 'inventoryItems', recordId: args.id, previousValues: item })
    return null
  },
})

export const receive = mutation({
  args: {
    itemId: v.id('inventoryItems'),
    quantity: v.number(),
    locationId: v.optional(v.id('farmLocations')),
    unitCost: v.optional(v.number()),
    supplierId: v.optional(v.id('feedSuppliers')),
    date: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.purchase.record' })
    const item = await loadItem(ctx, user, args.itemId)
    if (args.supplierId) assertOwns(user, await ctx.db.get(args.supplierId), 'Supplier')
    if (args.unitCost !== undefined && !(args.unitCost >= 0)) throw new Error('Unit cost must be zero or more')
    const locationId = await siteFor(ctx, user, args.locationId)
    return await move(ctx, user, item, {
      locationId,
      type: 'receipt',
      quantity: positive(args.quantity),
      unitCost: args.unitCost,
      supplierId: args.supplierId ?? item.supplierId,
      date: args.date,
      notes: args.notes,
    })
  },
})

export const issue = mutation({
  args: {
    itemId: v.id('inventoryItems'),
    quantity: v.number(),
    locationId: v.optional(v.id('farmLocations')),
    cageId: v.optional(v.id('cages')),
    date: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.issue' })
    return await issueItem(ctx, user, args)
  },
})

/**
 * Issue a non-feed item to a unit (or a site). Used by the issue screen and
 * by maintenance and pond water logs that consume spares or chemicals.
 */
export async function issueItem(
  ctx: MutationCtx,
  user: Doc<'users'>,
  args: {
    itemId: Id<'inventoryItems'>
    quantity: number
    locationId?: Id<'farmLocations'>
    cageId?: Id<'cages'>
    date?: string
    notes?: string
  },
): Promise<Id<'inventoryMovements'>> {
  const item = await loadItem(ctx, user, args.itemId)
  let locationId = args.locationId
  if (args.cageId) {
    const cage = await ctx.db.get(args.cageId)
    assertOwns(user, cage, 'Cage')
    if (locationId && cage.locationId && cage.locationId !== locationId) {
      throw new Error('The cage is not at that site')
    }
    locationId = locationId ?? cage.locationId
  }
  locationId = await siteFor(ctx, user, locationId)
  return await move(ctx, user, item, {
    locationId,
    type: 'issue',
    quantity: -positive(args.quantity),
    cageId: args.cageId,
    date: args.date,
    notes: args.notes,
  })
}

/** Stock count correction (signed). Admin only, reason required. */
export const adjust = mutation({
  args: {
    itemId: v.id('inventoryItems'),
    delta: v.number(),
    locationId: v.optional(v.id('farmLocations')),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.adjust' })
    if (!args.reason.trim()) throw new Error('A reason is required')
    const item = await loadItem(ctx, user, args.itemId)
    const locationId = await siteFor(ctx, user, args.locationId)
    const id = await move(ctx, user, item, { locationId, type: 'adjustment', quantity: args.delta, notes: args.reason })
    await logAudit(ctx, { actionType: 'stock_adjustment', tableName: 'inventoryMovements', recordId: id, newValues: args, locationId })
    return id
  },
})

/** Move stock between two sites: an out leg and an in leg. Admin only. */
export const transfer = mutation({
  args: {
    itemId: v.id('inventoryItems'),
    quantity: v.number(),
    fromLocationId: v.id('farmLocations'),
    toLocationId: v.id('farmLocations'),
    date: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.adjust' })
    if (args.fromLocationId === args.toLocationId) throw new Error('Pick two different sites')
    const item = await loadItem(ctx, user, args.itemId)
    const from = await siteFor(ctx, user, args.fromLocationId)
    const to = await siteFor(ctx, user, args.toLocationId)
    const qty = positive(args.quantity)
    const transferId = `${from}:${to}:${Date.now()}`
    const out = await move(ctx, user, item, {
      locationId: from, type: 'transfer_out', quantity: -qty, transferId, date: args.date, notes: args.notes,
    })
    const inn = await move(ctx, user, item, {
      locationId: to, type: 'transfer_in', quantity: qty, transferId, date: args.date, notes: args.notes,
    })
    return { out, in: inn }
  },
})
