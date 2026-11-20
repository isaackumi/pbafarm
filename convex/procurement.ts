import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertOwns, ensureDefaultLocation, logAudit, writeCompanyId, writeLocationId } from './lib/tenancy'
import { tenantScope } from './lib/scope'
import { applyStockChange, bagsFromKg } from './lib/feedLedger'
import { mergeSettings } from './lib/farmRules'
import { requireMember } from './lib/permissions'

/**
 * Feed purchase orders (INV-004).
 *
 * draft → ordered → received, or cancelled before receipt.
 * - Anyone in the company drafts and edits drafts, and receives a delivery
 *   (the store keeper), the same people who can record a feed purchase.
 * - Placing and cancelling an order is admin only: it commits money.
 * Receiving writes one `feedPurchases` row per line and books it into stock
 * through the feed ledger (`applyStockChange`), exactly like a purchase
 * entered by hand, at the price and quantity actually received.
 */

const lineInput = v.object({
  feedTypeId: v.id('feedTypes'),
  quantityKg: v.number(),
  pricePerKg: v.number(),
})

type LineInput = { feedTypeId: Id<'feedTypes'>; quantityKg: number; pricePerKg: number }

async function validateLines(ctx: MutationCtx, user: Doc<'users'>, lines: LineInput[]) {
  if (lines.length === 0) throw new Error('Add at least one feed line')
  if (lines.length > 50) throw new Error('A purchase order can have at most 50 lines')
  for (const l of lines) {
    const ft = await ctx.db.get(l.feedTypeId)
    assertOwns(user, ft, 'Feed type')
    if (ft.deletedAt) throw new Error('Feed type not found')
    if (!(l.quantityKg > 0)) throw new Error('Each line needs a quantity greater than zero')
    if (!(l.pricePerKg >= 0)) throw new Error('Price per kg must be zero or more')
  }
  return lines.map((l) => ({ feedTypeId: l.feedTypeId, quantityKg: l.quantityKg, pricePerKg: l.pricePerKg }))
}

async function validateSupplier(ctx: MutationCtx, user: Doc<'users'>, supplierId: Id<'feedSuppliers'>) {
  const supplier = await ctx.db.get(supplierId)
  assertOwns(user, supplier, 'Supplier')
  if (supplier.deletedAt) throw new Error('Supplier not found')
}

async function loadPo(ctx: MutationCtx, user: Doc<'users'>, id: Id<'purchaseOrders'>) {
  const po = await ctx.db.get(id)
  assertOwns(user, po, 'Purchase order')
  return po
}

const lineValue = (l: { quantityKg: number; pricePerKg: number }) => l.quantityKg * l.pricePerKg

export const list = query({
  args: {
    status: v.optional(
      v.union(v.literal('draft'), v.literal('ordered'), v.literal('received'), v.literal('cancelled')),
    ),
  },
  returns: v.array(
    v.object({
      id: v.id('purchaseOrders'),
      po_number: v.string(),
      status: v.union(
        v.literal('draft'),
        v.literal('cancelled'),
        v.literal('ordered'),
        v.literal('received'),
      ),
      supplier_id: v.id('feedSuppliers'),
      supplier_name: v.union(v.string(), v.null()),
      location_id: v.union(v.id('farmLocations'), v.null()),
      location_name: v.union(v.string(), v.null()),
      expected_date: v.union(v.string(), v.null()),
      received_date: v.union(v.string(), v.null()),
      notes: v.string(),
      lines: v.array(
        v.object({
          feed_type_id: v.id('feedTypes'),
          feed_type_name: v.union(v.string(), v.null()),
          quantity_kg: v.number(),
          price_per_kg: v.number(),
          received_kg: v.union(v.number(), v.null()),
          received_price_per_kg: v.union(v.number(), v.null()),
          purchase_id: v.union(v.id('feedPurchases'), v.null()),
        }),
      ),
      ordered_value: v.number(),
      received_value: v.number(),
      created_at: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.view' })
    const scope = tenantScope(user)
    if (scope.kind !== 'company') return []
    const rows = args.status
      ? await ctx.db
          .query('purchaseOrders')
          .withIndex('by_company_and_status', (q) =>
            q.eq('companyId', scope.companyId).eq('status', args.status!),
          )
          .order('desc')
          .take(500)
      : await ctx.db
          .query('purchaseOrders')
          .withIndex('by_company', (q) => q.eq('companyId', scope.companyId))
          .order('desc')
          .take(500)

    const names = new Map<string, string>()
    const nameOf = async (id: Id<'feedSuppliers'> | Id<'feedTypes'> | Id<'farmLocations'> | undefined) => {
      if (!id) return null
      const key = String(id)
      if (!names.has(key)) names.set(key, ((await ctx.db.get(id)) as { name?: string } | null)?.name ?? '')
      return names.get(key) || null
    }

    const out = []
    for (const po of rows) {
      const lines = []
      for (const l of po.lines) {
        lines.push({
          feed_type_id: l.feedTypeId,
          feed_type_name: await nameOf(l.feedTypeId),
          quantity_kg: l.quantityKg,
          price_per_kg: l.pricePerKg,
          received_kg: l.receivedKg ?? null,
          received_price_per_kg: l.receivedPricePerKg ?? null,
          purchase_id: l.purchaseId ?? null,
        })
      }
      out.push({
        id: po._id,
        po_number: po.poNumber,
        status: po.status,
        supplier_id: po.supplierId,
        supplier_name: await nameOf(po.supplierId),
        location_id: po.locationId ?? null,
        location_name: await nameOf(po.locationId),
        expected_date: po.expectedDate ?? null,
        received_date: po.receivedDate ?? null,
        notes: po.notes ?? '',
        lines,
        ordered_value: po.lines.reduce((s, l) => s + lineValue(l), 0),
        received_value: po.lines.reduce(
          (s, l) => s + (l.receivedKg ?? 0) * (l.receivedPricePerKg ?? l.pricePerKg),
          0,
        ),
        created_at: po._creationTime,
      })
    }
    return out
  },
})

export const create = mutation({
  args: {
    supplierId: v.id('feedSuppliers'),
    locationId: v.optional(v.id('farmLocations')),
    lines: v.array(lineInput),
    expectedDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.id('purchaseOrders'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.purchase.record' })
    return await createPurchaseOrderAs(ctx, user, args)
  },
})

export type PurchaseOrderInput = {
  supplierId: Id<'feedSuppliers'>
  locationId?: Id<'farmLocations'>
  lines: LineInput[]
  expectedDate?: string
  notes?: string
}

/**
 * Create a draft purchase order as `user` (the caller has checked
 * inventory.purchase.record). Shared by the form and Ask Anowa's confirm.
 */
export async function createPurchaseOrderAs(ctx: MutationCtx, user: Doc<'users'>, args: PurchaseOrderInput) {
  const companyId = await writeCompanyId(user)
  await validateSupplier(ctx, user, args.supplierId)
  const lines = await validateLines(ctx, user, args.lines)
  const locationId = args.locationId ? await writeLocationId(ctx, user, args.locationId) : undefined

  // Sequential per company; concurrent creates conflict and retry.
  const latest = await ctx.db
    .query('purchaseOrders')
    .withIndex('by_company', (q) => q.eq('companyId', companyId))
    .order('desc')
    .first()
  const lastNo = latest ? Number(latest.poNumber.replace(/\D/g, '')) || 0 : 0
  const poNumber = `PO-${String(lastNo + 1).padStart(4, '0')}`

  const id = await ctx.db.insert('purchaseOrders', {
    companyId,
    poNumber,
    supplierId: args.supplierId,
    locationId,
    status: 'draft',
    lines,
    expectedDate: args.expectedDate,
    notes: args.notes?.trim() || undefined,
    createdBy: user._id,
    updatedAt: Date.now(),
  })
  await logAudit(ctx, { actionType: 'create', tableName: 'purchaseOrders', recordId: id, newValues: { ...args, poNumber }, locationId })
  return id
}

/** Edit a draft. Ordered, received and cancelled orders are fixed. */
export const update = mutation({
  args: {
    id: v.id('purchaseOrders'),
    supplierId: v.optional(v.id('feedSuppliers')),
    locationId: v.optional(v.id('farmLocations')),
    lines: v.optional(v.array(lineInput)),
    expectedDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.id('purchaseOrders'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.purchase.record' })
    const po = await loadPo(ctx, user, args.id)
    if (po.status !== 'draft') throw new Error('Only a draft purchase order can be edited')
    const patch: Partial<Doc<'purchaseOrders'>> = { updatedAt: Date.now() }
    if (args.supplierId) {
      await validateSupplier(ctx, user, args.supplierId)
      patch.supplierId = args.supplierId
    }
    if (args.locationId) patch.locationId = await writeLocationId(ctx, user, args.locationId)
    if (args.lines) patch.lines = await validateLines(ctx, user, args.lines)
    if (args.expectedDate !== undefined) patch.expectedDate = args.expectedDate || undefined
    if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined
    await ctx.db.patch(args.id, patch)
    await logAudit(ctx, { actionType: 'update', tableName: 'purchaseOrders', recordId: args.id, previousValues: po, newValues: patch })
    return args.id
  },
})

export const markOrdered = mutation({
  args: { id: v.id('purchaseOrders') },
  returns: v.id('purchaseOrders'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.purchase.correct' })
    const po = await loadPo(ctx, user, args.id)
    if (po.status !== 'draft') throw new Error('Only a draft can be placed as an order')
    await ctx.db.patch(args.id, { status: 'ordered', orderedAt: Date.now(), orderedBy: user._id, updatedAt: Date.now() })
    await logAudit(ctx, { actionType: 'po_ordered', tableName: 'purchaseOrders', recordId: args.id, newValues: { status: 'ordered' } })
    return args.id
  },
})

export const cancel = mutation({
  args: { id: v.id('purchaseOrders'), reason: v.optional(v.string()) },
  returns: v.id('purchaseOrders'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.purchase.correct' })
    const po = await loadPo(ctx, user, args.id)
    if (po.status === 'received') throw new Error('A received order cannot be cancelled; void its purchases instead')
    if (po.status === 'cancelled') return args.id
    const notes = args.reason?.trim()
      ? `${po.notes ? `${po.notes}\n` : ''}Cancelled: ${args.reason.trim()}`
      : po.notes
    await ctx.db.patch(args.id, { status: 'cancelled', notes, updatedAt: Date.now() })
    await logAudit(ctx, { actionType: 'po_cancelled', tableName: 'purchaseOrders', recordId: args.id, previousValues: { status: po.status }, newValues: { reason: args.reason } })
    return args.id
  },
})

/**
 * Receive an ordered PO in full. Each line may override the quantity and
 * price actually delivered (0 kg = not delivered) and carry a batch and
 * expiry. Each delivered line becomes a feed purchase in stock at the
 * delivery site.
 */
export const receive = mutation({
  args: {
    id: v.id('purchaseOrders'),
    receivedDate: v.string(),
    lines: v.optional(
      v.array(
        v.object({
          index: v.number(),
          receivedKg: v.optional(v.number()),
          pricePerKg: v.optional(v.number()),
          batchNumber: v.optional(v.string()),
          expiryDate: v.optional(v.string()),
        }),
      ),
    ),
  },
  returns: v.object({ received: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'inventory.purchase.record' })
    const po = await loadPo(ctx, user, args.id)
    if (po.status !== 'ordered') throw new Error('Only an ordered purchase order can be received')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.receivedDate)) throw new Error('Date must be YYYY-MM-DD')

    const company = await ctx.db.get(po.companyId)
    const feedRules = mergeSettings(company?.settings).feedRules
    const locationId =
      (await writeLocationId(ctx, user, po.locationId)) || (await ensureDefaultLocation(ctx, user))
    const site = await ctx.db.get(locationId)

    const overrides = new Map((args.lines ?? []).map((l) => [l.index, l]))
    for (const index of overrides.keys()) {
      if (!Number.isInteger(index) || index < 0 || index >= po.lines.length) {
        throw new Error('Unknown purchase order line')
      }
    }

    const lines: Doc<'purchaseOrders'>['lines'] = []
    let received = 0
    for (let i = 0; i < po.lines.length; i++) {
      const line = po.lines[i]
      const o = overrides.get(i)
      const kg = o?.receivedKg ?? line.quantityKg
      const price = o?.pricePerKg ?? line.pricePerKg
      if (!(kg >= 0)) throw new Error('Received quantity cannot be negative')
      if (!(price >= 0)) throw new Error('Price per kg must be zero or more')
      if (kg === 0) {
        lines.push({ ...line, receivedKg: 0, receivedPricePerKg: price })
        continue
      }
      if (feedRules.requireBatchOnPurchase && !o?.batchNumber?.trim()) {
        throw new Error('Batch number is required for purchases')
      }
      const feedType = await ctx.db.get(line.feedTypeId)
      assertOwns(user, feedType, 'Feed type')
      if (feedType.deletedAt) throw new Error('Feed type not found')
      const bags = bagsFromKg(kg, feedType.bagSizeKg)
      const purchaseId = await ctx.db.insert('feedPurchases', {
        feedTypeId: line.feedTypeId,
        quantity: kg,
        bags,
        pricePerKg: price,
        purchaseDate: args.receivedDate,
        supplierId: po.supplierId,
        batchNumber: o?.batchNumber?.trim() || undefined,
        expiryDate: o?.expiryDate || undefined,
        notes: `Received on ${po.poNumber}`,
        locationId,
        companyId: po.companyId,
        updatedAt: Date.now(),
      })
      await applyStockChange(ctx, {
        user,
        feedTypeId: line.feedTypeId,
        deltaKg: kg,
        bags,
        transactionType: 'purchase',
        referenceId: String(purchaseId),
        notes: `${po.poNumber} received ${args.receivedDate}`,
        batchNumber: o?.batchNumber?.trim() || undefined,
        expiryDate: o?.expiryDate || undefined,
        location: site?.name || feedRules.defaultLocation,
        locationId,
      })
      received += 1
      lines.push({
        ...line,
        receivedKg: kg,
        receivedPricePerKg: price,
        batchNumber: o?.batchNumber?.trim() || undefined,
        expiryDate: o?.expiryDate || undefined,
        purchaseId,
      })
    }
    if (received === 0) throw new Error('Nothing was received; cancel the order instead')

    await ctx.db.patch(args.id, {
      status: 'received',
      lines,
      locationId,
      receivedDate: args.receivedDate,
      receivedBy: user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'po_received',
      tableName: 'purchaseOrders',
      recordId: args.id,
      newValues: { receivedDate: args.receivedDate, lines },
      locationId,
    })
    return { received }
  },
})
