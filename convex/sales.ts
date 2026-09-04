import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import {
  listForCompany,
  listForCompanyAndLocation,
  writeCompanyId,
  writeLocationId,
  ensureDefaultLocation,
  logAudit,
} from './lib/tenancy'

function toClientCustomer(c: any) {
  return {
    id: c._id,
    _id: c._id,
    name: c.name,
    contact_name: c.contactName,
    phone: c.phone,
    email: c.email,
    notes: c.notes,
    active: c.active !== false,
    company_id: c.companyId,
    updated_at: c.updatedAt,
    created_at: c._creationTime,
  }
}

function toClientSale(s: any, extras: Record<string, unknown> = {}) {
  return {
    id: s._id,
    _id: s._id,
    harvest_id: s.harvestId,
    cage_id: s.cageId,
    customer_id: s.customerId,
    customer_name: s.customerName,
    sale_date: s.saleDate,
    weight_kg: s.weightKg,
    price_per_kg: s.pricePerKg,
    total_amount: s.totalAmount,
    payment_status: s.paymentStatus || 'pending',
    notes: s.notes,
    location_id: s.locationId,
    company_id: s.companyId,
    created_by: s.createdBy,
    updated_at: s.updatedAt,
    created_at: s._creationTime,
    ...extras,
  }
}

export const listCustomers = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let rows = await ctx.db.query('customers').collect()
    rows = await listForCompany(user, rows)
    rows = rows.filter((c) => !c.deletedAt)
    if (!args.includeInactive) rows = rows.filter((c) => c.active !== false)
    return rows.map(toClientCustomer).sort((a, b) => a.name.localeCompare(b.name))
  },
})

export const createCustomer = mutation({
  args: {
    name: v.string(),
    contactName: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    const name = args.name.trim()
    if (!name) throw new Error('Customer name is required')
    const id = await ctx.db.insert('customers', {
      name,
      contactName: args.contactName?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      email: args.email?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      active: true,
      companyId: await writeCompanyId(user),
      updatedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'customers',
      recordId: id,
      newValues: args,
    })
    return id
  },
})

export const updateCustomer = mutation({
  args: {
    id: v.id('customers'),
    patch: v.object({
      name: v.optional(v.string()),
      contactName: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      notes: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    const existing = await ctx.db.get(id)
    if (!existing || existing.deletedAt) throw new Error('Customer not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    const next: Record<string, unknown> = { updatedAt: Date.now() }
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (!name) throw new Error('Name is required')
      next.name = name
    }
    if (patch.contactName !== undefined)
      next.contactName = patch.contactName.trim() || undefined
    if (patch.phone !== undefined) next.phone = patch.phone.trim() || undefined
    if (patch.email !== undefined) next.email = patch.email.trim() || undefined
    if (patch.notes !== undefined) next.notes = patch.notes.trim() || undefined
    if (patch.active !== undefined) next.active = patch.active

    await ctx.db.patch(id, next)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'customers',
      recordId: id,
      previousValues: existing,
      newValues: patch,
    })
    return id
  },
})

export const listSales = query({
  args: {
    harvestId: v.optional(v.id('harvestRecords')),
    locationId: v.optional(v.id('farmLocations')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let rows = args.harvestId
      ? await ctx.db
          .query('sales')
          .withIndex('by_harvest', (q) => q.eq('harvestId', args.harvestId!))
          .collect()
      : await ctx.db.query('sales').collect()

    rows = await listForCompanyAndLocation(user, rows, args.locationId)
    if (args.dateFrom) rows = rows.filter((s) => s.saleDate >= args.dateFrom!)
    if (args.dateTo) rows = rows.filter((s) => s.saleDate <= args.dateTo!)

    const out = []
    for (const sale of rows) {
      let cageName: string | null = null
      if (sale.cageId) {
        const cage = await ctx.db.get(sale.cageId)
        cageName = cage?.name || null
      }
      out.push(toClientSale(sale, { cage_name: cageName }))
    }
    return out.sort((a, b) => b.sale_date.localeCompare(a.sale_date))
  },
})

export const createSale = mutation({
  args: {
    harvestId: v.optional(v.id('harvestRecords')),
    cageId: v.optional(v.id('cages')),
    customerId: v.optional(v.id('customers')),
    customerName: v.optional(v.string()),
    saleDate: v.string(),
    weightKg: v.number(),
    pricePerKg: v.number(),
    paymentStatus: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('partial'),
        v.literal('paid'),
      ),
    ),
    notes: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!(args.weightKg > 0)) throw new Error('Weight must be greater than zero')
    if (!(args.pricePerKg >= 0)) throw new Error('Price per kg must be zero or more')

    let cageId = args.cageId
    let locationId = args.locationId
    let companyId = await writeCompanyId(user)
    let harvest = null

    if (args.harvestId) {
      harvest = await ctx.db.get(args.harvestId)
      if (!harvest) throw new Error('Harvest not found')
      const allowed = await listForCompany(user, [harvest])
      if (!allowed.length) throw new Error('Access denied')
      cageId = cageId || harvest.cageId
      locationId = locationId || harvest.locationId
      companyId = companyId || harvest.companyId
    }

    if (cageId) {
      const cage = await ctx.db.get(cageId)
      if (!cage) throw new Error('Cage not found')
      locationId = locationId || cage.locationId
      companyId = companyId || cage.companyId
    }

    await ensureDefaultLocation(ctx, user)
    locationId =
      (await writeLocationId(ctx, user, locationId)) ||
      (await ensureDefaultLocation(ctx, user))

    let customerName = args.customerName?.trim() || undefined
    if (args.customerId) {
      const customer = await ctx.db.get(args.customerId)
      if (!customer || customer.deletedAt) throw new Error('Customer not found')
      const allowed = await listForCompany(user, [customer])
      if (!allowed.length) throw new Error('Customer access denied')
      customerName = customer.name
    }
    if (!customerName && !args.customerId) {
      throw new Error('Select a customer or enter a buyer name')
    }

    if (harvest) {
      const existingSales = await ctx.db
        .query('sales')
        .withIndex('by_harvest', (q) => q.eq('harvestId', args.harvestId!))
        .collect()
      const sold = existingSales.reduce((s, r) => s + r.weightKg, 0)
      if (sold + args.weightKg > harvest.totalWeight + 0.05) {
        throw new Error(
          `Sale exceeds remaining harvest weight (have ${harvest.totalWeight} kg, sold ${sold} kg)`,
        )
      }
    }

    const totalAmount =
      Math.round(args.weightKg * args.pricePerKg * 100) / 100

    const id = await ctx.db.insert('sales', {
      harvestId: args.harvestId,
      cageId,
      customerId: args.customerId,
      customerName,
      saleDate: args.saleDate,
      weightKg: args.weightKg,
      pricePerKg: args.pricePerKg,
      totalAmount,
      paymentStatus: args.paymentStatus || 'pending',
      notes: args.notes?.trim() || undefined,
      locationId,
      companyId,
      createdBy: user._id,
      updatedAt: Date.now(),
    })

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'sales',
      recordId: id,
      newValues: { ...args, totalAmount },
      locationId,
    })
    return id
  },
})

export const updateSale = mutation({
  args: {
    id: v.id('sales'),
    patch: v.object({
      saleDate: v.optional(v.string()),
      weightKg: v.optional(v.number()),
      pricePerKg: v.optional(v.number()),
      paymentStatus: v.optional(
        v.union(
          v.literal('pending'),
          v.literal('partial'),
          v.literal('paid'),
        ),
      ),
      notes: v.optional(v.string()),
      customerId: v.optional(v.id('customers')),
      customerName: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Sale not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')

    const next: Record<string, unknown> = { updatedAt: Date.now() }
    if (patch.saleDate !== undefined) next.saleDate = patch.saleDate
    if (patch.notes !== undefined) next.notes = patch.notes.trim() || undefined
    if (patch.paymentStatus !== undefined) next.paymentStatus = patch.paymentStatus

    let weightKg = existing.weightKg
    let pricePerKg = existing.pricePerKg
    if (patch.weightKg !== undefined) {
      if (!(patch.weightKg > 0)) throw new Error('Weight must be greater than zero')
      weightKg = patch.weightKg
      next.weightKg = weightKg
    }
    if (patch.pricePerKg !== undefined) {
      if (!(patch.pricePerKg >= 0)) throw new Error('Invalid price')
      pricePerKg = patch.pricePerKg
      next.pricePerKg = pricePerKg
    }
    next.totalAmount = Math.round(weightKg * pricePerKg * 100) / 100

    if (patch.customerId !== undefined) {
      const customer = await ctx.db.get(patch.customerId)
      if (!customer) throw new Error('Customer not found')
      next.customerId = patch.customerId
      next.customerName = customer.name
    } else if (patch.customerName !== undefined) {
      next.customerName = patch.customerName.trim() || existing.customerName
    }

    await ctx.db.patch(id, next)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'sales',
      recordId: id,
      previousValues: existing,
      newValues: patch,
      locationId: existing.locationId,
    })
    return id
  },
})

export const removeSale = mutation({
  args: { id: v.id('sales') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Sale not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')
    await ctx.db.delete(id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'sales',
      recordId: id,
      previousValues: existing,
      locationId: existing.locationId,
    })
  },
})

/** Summary for a harvest: sold kg, revenue, remaining kg. */
export const harvestSaleSummary = query({
  args: { harvestId: v.id('harvestRecords') },
  handler: async (ctx, { harvestId }) => {
    const user = await requireUser(ctx)
    const harvest = await ctx.db.get(harvestId)
    if (!harvest) return null
    const allowed = await listForCompany(user, [harvest])
    if (!allowed.length) return null

    const sales = await ctx.db
      .query('sales')
      .withIndex('by_harvest', (q) => q.eq('harvestId', harvestId))
      .collect()

    const soldKg = sales.reduce((s, r) => s + r.weightKg, 0)
    const revenue = sales.reduce((s, r) => s + r.totalAmount, 0)
    return {
      harvest_id: harvestId,
      harvest_weight_kg: harvest.totalWeight,
      sold_kg: soldKg,
      remaining_kg: Math.max(0, harvest.totalWeight - soldKg),
      revenue,
      sale_count: sales.length,
    }
  },
})
