import { v } from 'convex/values'
import { paginationResultValidator, paginationOptsValidator } from 'convex/server'
import { query, mutation } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { scopedPageInRange, scopedRows, scopedRowsInRange } from './lib/scope'
import { enforceWithdrawal } from './lib/traceability'
import {
  assertOwns,
  listForCompany,
  listForCompanyAndLocation,
  writeCompanyId,
  writeLocationId,
  ensureDefaultLocation,
  logAudit,
} from './lib/tenancy'
import { assertUserCan, requireMember } from './lib/permissions'
import { userError } from './lib/errors'
import { amountPaidOf, statusFor } from './invoices'

function toClientCustomer(c: Doc<'customers'>) {
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

function toClientSale<E extends Record<string, unknown> = Record<never, never>>(s: Doc<'sales'>, extras: E = {} as E) {
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
    unit_count: s.unitCount ?? null,
    price_per_unit: s.pricePerUnit ?? null,
    batch_id: s.batchId ?? null,
    payment_status: s.paymentStatus || 'pending',
    amount_paid: amountPaidOf(s),
    balance: Math.round((s.totalAmount - amountPaidOf(s)) * 100) / 100,
    has_payments: s.amountPaid !== undefined,
    invoice_id: s.invoiceId ?? null,
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
  returns: v.array(
    v.object({
      id: v.id('customers'),
      _id: v.id('customers'),
      name: v.string(),
      contact_name: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      notes: v.optional(v.string()),
      active: v.boolean(),
      company_id: v.optional(v.id('companies')),
      updated_at: v.number(),
      created_at: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
    let rows = await scopedRows(ctx, user, 'customers')
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
  returns: v.id('customers'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.sales.correct' })
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
  returns: v.id('customers'),
  handler: async (ctx, { id, patch }) => {
    const { user } = await requireMember(ctx, { permission: 'finance.sales.correct' })
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

const saleRow = v.object({
  id: v.id('sales'),
  _id: v.id('sales'),
  harvest_id: v.optional(v.id('harvestRecords')),
  cage_id: v.optional(v.id('cages')),
  customer_id: v.optional(v.id('customers')),
  customer_name: v.optional(v.string()),
  sale_date: v.string(),
  weight_kg: v.number(),
  price_per_kg: v.number(),
  total_amount: v.number(),
  unit_count: v.union(v.number(), v.null()),
  price_per_unit: v.union(v.number(), v.null()),
  batch_id: v.union(v.id('batches'), v.null()),
  payment_status: v.union(v.literal('pending'), v.literal('partial'), v.literal('paid')),
  amount_paid: v.number(),
  balance: v.number(),
  has_payments: v.boolean(),
  invoice_id: v.union(v.id('invoices'), v.null()),
  notes: v.optional(v.string()),
  location_id: v.optional(v.id('farmLocations')),
  company_id: v.optional(v.id('companies')),
  created_by: v.optional(v.id('users')),
  updated_at: v.number(),
  created_at: v.number(),
  cage_name: v.union(v.string(), v.null()),
  invoice_number: v.union(v.string(), v.null()),
})

export const listSales = query({
  args: {
    harvestId: v.optional(v.id('harvestRecords')),
    locationId: v.optional(v.id('farmLocations')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  returns: v.array(saleRow),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
    let rows = args.harvestId
      ? await ctx.db
          .query('sales')
          .withIndex('by_harvest', (q) => q.eq('harvestId', args.harvestId!))
          .collect()
      : await scopedRowsInRange(ctx, user, 'sales', {
          from: args.dateFrom,
          to: args.dateTo,
          locationId: args.locationId,
        })

    rows = await listForCompanyAndLocation(user, rows, args.locationId)
    if (args.dateFrom) rows = rows.filter((s) => s.saleDate >= args.dateFrom!)
    if (args.dateTo) rows = rows.filter((s) => s.saleDate <= args.dateTo!)

    const out = await withCageNames(ctx, rows)
    return out.sort((a, b) => b.sale_date.localeCompare(a.sale_date))
  },
})

/** Client rows with `cage_name` (one `get` per distinct cage) and invoice number. */
async function withCageNames(ctx: QueryCtx, rows: Doc<'sales'>[]) {
  const names = new Map<string, string | null>()
  const out = []
  for (const sale of rows) {
    let cageName: string | null = null
    if (sale.cageId) {
      const key = String(sale.cageId)
      if (!names.has(key)) names.set(key, (await ctx.db.get(sale.cageId))?.name || null)
      cageName = names.get(key) ?? null
    }
    const invoice = sale.invoiceId ? await ctx.db.get(sale.invoiceId) : null
    out.push(
      toClientSale(sale, {
        cage_name: cageName,
        invoice_number: invoice && !invoice.voidedAt ? invoice.number : null,
      }),
    )
  }
  return out
}

/**
 * Paginated sales, newest sale date first (PLAT-001), via
 * `by_company_and_saleDate`. A site filter is applied per page.
 */
export const listSalesPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    locationId: v.optional(v.id('farmLocations')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  returns: paginationResultValidator(saleRow),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
    const result = await scopedPageInRange(ctx, user, 'sales', args.paginationOpts, {
      from: args.dateFrom,
      to: args.dateTo,
    })
    const rows = args.locationId
      ? result.page.filter((r) => r.locationId === args.locationId)
      : result.page
    return { ...result, page: await withCageNames(ctx, rows) }
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
    /** Admin only: sell fish inside a treatment withdrawal period (PROD-012). */
    withdrawalOverrideReason: v.optional(v.string()),
  },
  returns: v.id('sales'),
  handler: async (ctx, { withdrawalOverrideReason, ...args }) => {
    const { user } = await requireMember(ctx, { permission: 'finance.sales.record' })
    if (!(args.weightKg > 0)) throw new Error('Weight must be greater than zero')
    if (!(args.pricePerKg >= 0)) throw new Error('Price per kg must be zero or more')

    let cageId = args.cageId
    let locationId = args.locationId
    const companyId = await writeCompanyId(user)
    let harvest = null

    if (args.harvestId) {
      harvest = await ctx.db.get(args.harvestId)
      if (!harvest) throw new Error('Harvest not found')
      const allowed = await listForCompany(user, [harvest])
      if (!allowed.length) throw new Error('Access denied')
      cageId = cageId || harvest.cageId
      locationId = locationId || harvest.locationId
    }

    if (cageId) {
      const cage = await ctx.db.get(cageId)
      assertOwns(user, cage, 'Cage')
      locationId = locationId || cage.locationId
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

    // A sale from a cage (or its harvest) inside a withdrawal period is refused
    // unless an admin overrides it (PROD-012). The batch is the harvested one.
    const withdrawalOverride = cageId
      ? await enforceWithdrawal(ctx, user, {
          cageId,
          // Fish from a harvest are judged at the harvest date.
          date: harvest?.harvestDate ?? args.saleDate,
          action: 'sale',
          overrideReason: withdrawalOverrideReason,
          batchId: harvest?.batchId,
        })
      : undefined

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
      withdrawalOverride,
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
  returns: v.id('sales'),
  handler: async (ctx, { id, patch }) => {
    const { user } = await requireMember(ctx, { permission: 'finance.sales.record' })
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Sale not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')
    // Price and payment status are financial edits (doc 07 V9).
    if (
      (patch.pricePerKg !== undefined && patch.pricePerKg !== existing.pricePerKg) ||
      (patch.paymentStatus !== undefined && patch.paymentStatus !== existing.paymentStatus)
    ) {
      await assertUserCan(ctx, user, 'finance.sales.correct')
    }

    const weightChanged = patch.weightKg !== undefined && patch.weightKg !== existing.weightKg
    const priceChanged = patch.pricePerKg !== undefined && patch.pricePerKg !== existing.pricePerKg
    if ((weightChanged || priceChanged) && existing.unitCount !== undefined) {
      // A fingerling sale is priced per fish and took fish off the batch (NUR-002).
      throw userError(
        'CONFLICT',
        'This is a fingerling sale priced per fish. Reverse it from the hatchery and record it again to change the quantity or price.',
      )
    }

    const next: Record<string, unknown> = { updatedAt: Date.now() }
    if (patch.saleDate !== undefined) next.saleDate = patch.saleDate
    if (patch.notes !== undefined) next.notes = patch.notes.trim() || undefined

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
    const totalAmount =
      existing.unitCount !== undefined
        ? existing.totalAmount
        : Math.round(weightKg * pricePerKg * 100) / 100
    next.totalAmount = totalAmount

    // The same cap as createSale (d08 §10): the harvest's sales may not
    // exceed what was harvested.
    if (weightChanged && existing.harvestId) {
      const harvest = await ctx.db.get(existing.harvestId)
      if (harvest) {
        const others = await ctx.db
          .query('sales')
          .withIndex('by_harvest', (q) => q.eq('harvestId', existing.harvestId!))
          .collect()
        const sold = others.filter((r) => r._id !== id).reduce((s, r) => s + r.weightKg, 0)
        if (sold + weightKg > harvest.totalWeight + 0.05) {
          throw userError(
            'VALIDATION',
            `Sale exceeds remaining harvest weight (have ${harvest.totalWeight} kg, ${Math.round(sold * 100) / 100} kg sold elsewhere)`,
          )
        }
      }
    }

    if (Math.abs(totalAmount - existing.totalAmount) > 0.005) {
      if (existing.invoiceId) {
        const invoice = await ctx.db.get(existing.invoiceId)
        if (invoice && !invoice.voidedAt) {
          throw userError('CONFLICT', `Invoice ${invoice.number} was issued for this sale. Void it before changing the amount.`)
        }
      }
      if (existing.amountPaid !== undefined && existing.amountPaid > totalAmount + 0.005) {
        throw userError(
          'CONFLICT',
          `Payments received (${existing.amountPaid}) are more than the new total (${totalAmount}). Remove a payment first.`,
        )
      }
    }

    if (existing.amountPaid !== undefined) {
      // Recorded payments decide the status (INV-009).
      const derived = statusFor(existing.amountPaid, totalAmount)
      if (patch.paymentStatus !== undefined && patch.paymentStatus !== derived) {
        throw userError('CONFLICT', 'The payment status follows the payments recorded. Record or remove a payment instead.')
      }
      next.paymentStatus = derived
    } else if (patch.paymentStatus !== undefined) {
      next.paymentStatus = patch.paymentStatus
    }

    if (patch.customerId !== undefined) {
      const customer = await ctx.db.get(patch.customerId)
      assertOwns(user, customer, 'Customer')
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
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'finance.sales.correct' })
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Sale not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')
    if (existing.unitCount !== undefined && existing.batchId) {
      // A fingerling sale took fish off the ledger (NUR-002): reversing it in
      // the hatchery puts them back and removes this row.
      throw new Error('This is a fingerling sale. Reverse it from the hatchery so the fish are put back.')
    }
    if (existing.amountPaid !== undefined && existing.amountPaid > 0) {
      throw userError('CONFLICT', 'Payments are recorded on this sale. Remove them before deleting the sale.')
    }
    if (existing.invoiceId) {
      const invoice = await ctx.db.get(existing.invoiceId)
      if (invoice && !invoice.voidedAt) {
        await ctx.db.patch(invoice._id, { voidedAt: Date.now(), updatedAt: Date.now() })
      }
    }
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
  returns: v.union(v.object({ harvest_id: v.id('harvestRecords'), harvest_weight_kg: v.number(), sold_kg: v.number(), remaining_kg: v.number(), revenue: v.number(), sale_count: v.number() }), v.null()),
  handler: async (ctx, { harvestId }) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
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
