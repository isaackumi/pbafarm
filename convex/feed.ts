import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser } from './lib/authz'
import { listForCompany, writeCompanyId, logAudit } from './lib/tenancy'
import {
  applyStockChange,
  bagsFromKg,
  kgFromBags,
} from './lib/feedLedger'

function toClientSupplier(s: any) {
  return {
    id: s._id,
    _id: s._id,
    name: s.name,
    abbreviation: s.abbreviation,
    contact_info: s.contactInfo,
    website: s.website,
    company_id: s.companyId,
    deleted_at: s.deletedAt,
    updated_at: s.updatedAt,
    created_at: s._creationTime,
  }
}

function toClientFeedType(f: any) {
  const bagSize = f.bagSizeKg && f.bagSizeKg > 0 ? f.bagSizeKg : 25
  return {
    id: f._id,
    _id: f._id,
    name: f.name,
    description: f.description,
    current_stock: f.currentStock,
    current_stock_bags: bagsFromKg(f.currentStock, bagSize),
    minimum_stock: f.minimumStock,
    price_per_kg: f.pricePerKg,
    bag_size_kg: bagSize,
    supplier_id: f.supplierId,
    active: f.active,
    company_id: f.companyId,
    deleted_at: f.deletedAt,
    updated_at: f.updatedAt,
    created_at: f._creationTime,
  }
}

function toClientPurchase(p: any) {
  return {
    id: p._id,
    _id: p._id,
    feed_type_id: p.feedTypeId,
    quantity: p.quantity,
    bags: p.bags,
    price_per_kg: p.pricePerKg,
    purchase_date: p.purchaseDate,
    supplier_id: p.supplierId,
    batch_number: p.batchNumber,
    expiry_date: p.expiryDate,
    notes: p.notes,
    company_id: p.companyId,
    deleted_at: p.deletedAt,
    updated_at: p.updatedAt,
    created_at: p._creationTime,
  }
}

function toClientUsage(u: any) {
  return {
    id: u._id,
    _id: u._id,
    feed_type_id: u.feedTypeId,
    cage_id: u.cageId,
    quantity: u.quantity,
    bags: u.bags,
    usage_date: u.usageDate,
    source: u.source,
    notes: u.notes,
    company_id: u.companyId,
    deleted_at: u.deletedAt,
    updated_at: u.updatedAt,
    created_at: u._creationTime,
  }
}

function resolveQuantityKg(
  feedType: { bagSizeKg?: number },
  quantityKg?: number,
  bags?: number,
) {
  if (quantityKg != null && quantityKg > 0) return quantityKg
  if (bags != null && bags > 0) return kgFromBags(bags, feedType.bagSizeKg)
  throw new Error('Provide quantityKg or bags greater than zero')
}

// SUPPLIERS
export const listSuppliers = query({
  args: { includeDeleted: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let suppliers = await ctx.db.query('feedSuppliers').collect()
    suppliers = await listForCompany(user, suppliers)
    if (!args.includeDeleted) {
      suppliers = suppliers.filter((s) => !s.deletedAt)
    }
    return suppliers.map(toClientSupplier).sort((a, b) => a.name.localeCompare(b.name))
  },
})

export const createSupplier = mutation({
  args: {
    name: v.string(),
    abbreviation: v.optional(v.string()),
    contactInfo: v.optional(v.string()),
    website: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const now = Date.now()
    const id = await ctx.db.insert('feedSuppliers', {
      ...args,
      companyId: await writeCompanyId(user),
      updatedAt: now,
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'feedSuppliers',
      recordId: id,
      newValues: args,
    })
    return id
  },
})

export const updateSupplier = mutation({
  args: {
    id: v.id('feedSuppliers'),
    patch: v.object({
      name: v.optional(v.string()),
      abbreviation: v.optional(v.string()),
      contactInfo: v.optional(v.string()),
      website: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Supplier not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'feedSuppliers',
      recordId: id,
      previousValues: existing,
      newValues: patch,
    })
    return id
  },
})

export const softDeleteSupplier = mutation({
  args: { id: v.id('feedSuppliers') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Supplier not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    await ctx.db.patch(id, { deletedAt: Date.now(), updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'soft_delete',
      tableName: 'feedSuppliers',
      recordId: id,
      previousValues: existing,
    })
  },
})

// FEED TYPES
export const listFeedTypes = query({
  args: { includeDeleted: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let feedTypes = await ctx.db.query('feedTypes').collect()
    feedTypes = await listForCompany(user, feedTypes)
    if (!args.includeDeleted) {
      feedTypes = feedTypes.filter((f) => !f.deletedAt)
    }
    return feedTypes.map(toClientFeedType).sort((a, b) => a.name.localeCompare(b.name))
  },
})

export const createFeedType = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    currentStock: v.number(),
    minimumStock: v.number(),
    pricePerKg: v.number(),
    bagSizeKg: v.optional(v.number()),
    supplierId: v.optional(v.id('feedSuppliers')),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const now = Date.now()
    const opening = Math.max(0, args.currentStock)
    const id = await ctx.db.insert('feedTypes', {
      name: args.name,
      description: args.description,
      currentStock: 0,
      minimumStock: args.minimumStock,
      pricePerKg: args.pricePerKg,
      bagSizeKg: args.bagSizeKg && args.bagSizeKg > 0 ? args.bagSizeKg : 25,
      supplierId: args.supplierId,
      active: args.active ?? true,
      companyId: await writeCompanyId(user),
      updatedAt: now,
    })

    if (opening > 0) {
      await applyStockChange(ctx, {
        user,
        feedTypeId: id,
        deltaKg: opening,
        transactionType: 'adjustment',
        referenceId: String(id),
        notes: 'Opening stock',
      })
    }

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'feedTypes',
      recordId: id,
      newValues: args,
    })
    return id
  },
})

export const updateFeedType = mutation({
  args: {
    id: v.id('feedTypes'),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      minimumStock: v.optional(v.number()),
      pricePerKg: v.optional(v.number()),
      bagSizeKg: v.optional(v.number()),
      supplierId: v.optional(v.id('feedSuppliers')),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Feed type not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'feedTypes',
      recordId: id,
      previousValues: existing,
      newValues: patch,
    })
    return id
  },
})

export const softDeleteFeedType = mutation({
  args: { id: v.id('feedTypes') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Feed type not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    await ctx.db.patch(id, { deletedAt: Date.now(), updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'soft_delete',
      tableName: 'feedTypes',
      recordId: id,
      previousValues: existing,
    })
  },
})

// PURCHASES
export const listPurchases = query({
  args: {
    feedTypeId: v.optional(v.id('feedTypes')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let purchases = args.feedTypeId
      ? await ctx.db
          .query('feedPurchases')
          .withIndex('by_feed_type', (q) => q.eq('feedTypeId', args.feedTypeId!))
          .collect()
      : await ctx.db.query('feedPurchases').collect()

    purchases = await listForCompany(user, purchases)
    if (args.dateFrom) purchases = purchases.filter((p) => p.purchaseDate >= args.dateFrom!)
    if (args.dateTo) purchases = purchases.filter((p) => p.purchaseDate <= args.dateTo!)
    return purchases.map(toClientPurchase).sort((a, b) => b.purchase_date.localeCompare(a.purchase_date))
  },
})

export const createPurchase = mutation({
  args: {
    feedTypeId: v.id('feedTypes'),
    quantity: v.optional(v.number()),
    bags: v.optional(v.number()),
    pricePerKg: v.number(),
    purchaseDate: v.string(),
    supplierId: v.optional(v.id('feedSuppliers')),
    batchNumber: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const feedType = await ctx.db.get(args.feedTypeId)
    if (!feedType || feedType.deletedAt) throw new Error('Feed type not found')
    const allowed = await listForCompany(user, [feedType])
    if (!allowed.length) throw new Error('Access denied')

    const quantityKg = resolveQuantityKg(feedType, args.quantity, args.bags)
    const bags =
      args.bags != null ? args.bags : bagsFromKg(quantityKg, feedType.bagSizeKg)

    const now = Date.now()
    const id = await ctx.db.insert('feedPurchases', {
      feedTypeId: args.feedTypeId,
      quantity: quantityKg,
      bags,
      pricePerKg: args.pricePerKg,
      purchaseDate: args.purchaseDate,
      supplierId: args.supplierId,
      batchNumber: args.batchNumber,
      expiryDate: args.expiryDate,
      notes: args.notes,
      companyId: (await writeCompanyId(user)) ?? feedType.companyId,
      updatedAt: now,
    })

    await applyStockChange(ctx, {
      user,
      feedTypeId: args.feedTypeId,
      deltaKg: quantityKg,
      bags,
      transactionType: 'purchase',
      referenceId: String(id),
      notes: args.notes || `Purchase ${args.purchaseDate}`,
    })

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'feedPurchases',
      recordId: id,
      newValues: { ...args, quantityKg, bags },
    })
    return id
  },
})

// USAGE / ISSUE
export const listUsage = query({
  args: {
    feedTypeId: v.optional(v.id('feedTypes')),
    cageId: v.optional(v.id('cages')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let usage = []

    if (args.feedTypeId) {
      usage = await ctx.db
        .query('feedUsage')
        .withIndex('by_feed_type', (q) => q.eq('feedTypeId', args.feedTypeId!))
        .collect()
    } else if (args.cageId) {
      usage = await ctx.db
        .query('feedUsage')
        .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
        .collect()
    } else {
      usage = await ctx.db.query('feedUsage').collect()
    }

    usage = await listForCompany(user, usage)
    if (args.dateFrom) usage = usage.filter((u) => u.usageDate >= args.dateFrom!)
    if (args.dateTo) usage = usage.filter((u) => u.usageDate <= args.dateTo!)
    return usage.map(toClientUsage).sort((a, b) => b.usage_date.localeCompare(a.usage_date))
  },
})

async function recordOutboundUsage(
  ctx: any,
  args: {
    feedTypeId: any
    cageId?: any
    quantity?: number
    bags?: number
    usageDate: string
    notes?: string
    source: 'issue' | 'daily' | 'usage'
    allowNegative?: boolean
    overrideReason?: string
    transactionType: 'issue' | 'daily_usage' | 'usage'
    referenceId?: string
  },
) {
  const user = await requireUser(ctx)
  const feedType = await ctx.db.get(args.feedTypeId)
  if (!feedType || feedType.deletedAt) throw new Error('Feed type not found')
  const allowed = await listForCompany(user, [feedType])
  if (!allowed.length) throw new Error('Access denied')

  if (args.cageId) {
    const cage = await ctx.db.get(args.cageId)
    if (!cage) throw new Error('Cage not found')
    const cageAllowed = await listForCompany(user, [cage])
    if (!cageAllowed.length) throw new Error('Cage access denied')
  }

  const quantityKg = resolveQuantityKg(feedType, args.quantity, args.bags)
  const bags =
    args.bags != null ? args.bags : bagsFromKg(quantityKg, feedType.bagSizeKg)

  const now = Date.now()
  const id = await ctx.db.insert('feedUsage', {
    feedTypeId: args.feedTypeId,
    cageId: args.cageId,
    quantity: quantityKg,
    bags,
    usageDate: args.usageDate,
    source: args.source,
    notes: args.notes,
    companyId: (await writeCompanyId(user)) ?? feedType.companyId,
    updatedAt: now,
  })

  await applyStockChange(ctx, {
    user,
    feedTypeId: args.feedTypeId,
    deltaKg: -quantityKg,
    bags,
    transactionType: args.transactionType,
    referenceId: args.referenceId ?? String(id),
    notes: args.notes || `${args.source} ${args.usageDate}`,
    allowNegative: args.allowNegative,
    overrideReason: args.overrideReason,
  })

  await logAudit(ctx, {
    actionType: 'create',
    tableName: 'feedUsage',
    recordId: id,
    newValues: { ...args, quantityKg, bags },
  })
  return id
}

export const createUsage = mutation({
  args: {
    feedTypeId: v.id('feedTypes'),
    cageId: v.optional(v.id('cages')),
    quantity: v.optional(v.number()),
    bags: v.optional(v.number()),
    usageDate: v.string(),
    notes: v.optional(v.string()),
    allowNegative: v.optional(v.boolean()),
    overrideReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await recordOutboundUsage(ctx, {
      ...args,
      source: 'usage',
      transactionType: 'usage',
    })
  },
})

/** Explicit store take-out by feeders (may link to a cage). */
export const createIssue = mutation({
  args: {
    feedTypeId: v.id('feedTypes'),
    cageId: v.optional(v.id('cages')),
    quantity: v.optional(v.number()),
    bags: v.optional(v.number()),
    usageDate: v.string(),
    notes: v.optional(v.string()),
    allowNegative: v.optional(v.boolean()),
    overrideReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await recordOutboundUsage(ctx, {
      ...args,
      source: 'issue',
      transactionType: 'issue',
    })
  },
})
