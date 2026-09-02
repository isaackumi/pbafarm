import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import { listForCompany, writeCompanyId, logAudit } from './lib/tenancy'
import {
  mergeSettings,
  assertStockingAllowed,
  assertTopupAllowed,
} from './lib/farmRules'

async function loadRules(ctx: any, companyId: any) {
  if (!companyId) return mergeSettings(undefined)
  const company = await ctx.db.get(companyId)
  return mergeSettings(company?.settings)
}

const stockingStatus = v.union(
  v.literal('pending_approval'),
  v.literal('approved'),
  v.literal('rejected'),
)

function toClientStocking(s: any) {
  return {
    id: s._id,
    _id: s._id,
    cage_id: s.cageId,
    batch_number: s.batchNumber,
    stocking_date: s.stockingDate,
    fish_count: s.fishCount,
    initial_abw: s.initialAbw,
    initial_biomass: s.initialBiomass,
    source_location: s.sourceLocation,
    source_cage: s.sourceCage,
    transfer_supervisor: s.transferSupervisor,
    sampling_supervisor: s.samplingSupervisor,
    status: s.status,
    notes: s.notes,
    company_id: s.companyId,
    created_by: s.createdBy,
    approved_by: s.approvedBy,
    approved_at: s.approvedAt,
    deleted_at: s.deletedAt,
    created_at: s._creationTime,
  }
}

function toClientTopup(t: any) {
  return {
    id: t._id,
    _id: t._id,
    stocking_id: t.stockingId,
    topup_date: t.topupDate,
    fish_count: t.fishCount,
    abw: t.abw,
    source_location: t.sourceLocation,
    transfer_supervisor: t.transferSupervisor,
    status: t.status,
    notes: t.notes,
    company_id: t.companyId,
    created_by: t.createdBy,
    approved_by: t.approvedBy,
    approved_at: t.approvedAt,
    created_at: t._creationTime,
  }
}

// STOCKING HISTORY
export const listStockingHistory = query({
  args: {
    cageId: v.optional(v.id('cages')),
    status: v.optional(stockingStatus),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let stockings = args.cageId
      ? await ctx.db
          .query('stockingHistory')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await ctx.db.query('stockingHistory').collect()

    stockings = await listForCompany(user, stockings)

    if (args.status) {
      stockings = stockings.filter((s) => s.status === args.status)
    }
    if (!args.includeDeleted) {
      stockings = stockings.filter((s) => !s.deletedAt)
    }

    return stockings
      .map(toClientStocking)
      .sort((a, b) => b.stocking_date.localeCompare(a.stocking_date))
  },
})

export const createStocking = mutation({
  args: {
    cageId: v.id('cages'),
    batchNumber: v.string(),
    stockingDate: v.string(),
    fishCount: v.number(),
    initialAbw: v.number(),
    initialBiomass: v.number(),
    sourceLocation: v.optional(v.string()),
    sourceCage: v.optional(v.string()),
    transferSupervisor: v.optional(v.string()),
    samplingSupervisor: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const cage = await ctx.db.get(args.cageId)
    if (!cage) throw new Error('Cage not found')

    const companyId = (await writeCompanyId(user)) ?? cage.companyId
    const rules = await loadRules(ctx, companyId)
    assertStockingAllowed({
      cage,
      fishCount: args.fishCount,
      abw: args.initialAbw,
      rules: rules.stockingRules,
      farmRules: rules.farmRules,
    })

    const status = rules.stockingRules.requireApprovalForStocking
      ? 'pending_approval'
      : 'approved'

    const id = await ctx.db.insert('stockingHistory', {
      ...args,
      status,
      companyId,
      createdBy: user._id,
      ...(status === 'approved'
        ? { approvedBy: user._id, approvedAt: Date.now() }
        : {}),
    })

    if (status === 'approved') {
      await ctx.db.patch(args.cageId, {
        stockingDate: args.stockingDate,
        initialCount: args.fishCount,
        currentCount: args.fishCount,
        initialAbw: args.initialAbw,
        status: 'active',
        updatedAt: Date.now(),
      })
    }

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'stockingHistory',
      recordId: id,
      newValues: { ...args, status },
    })
    return id
  },
})

export const updateStocking = mutation({
  args: {
    id: v.id('stockingHistory'),
    patch: v.object({
      stockingDate: v.optional(v.string()),
      fishCount: v.optional(v.number()),
      initialAbw: v.optional(v.number()),
      initialBiomass: v.optional(v.number()),
      sourceLocation: v.optional(v.string()),
      sourceCage: v.optional(v.string()),
      transferSupervisor: v.optional(v.string()),
      samplingSupervisor: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    const stocking = await ctx.db.get(id)
    if (!stocking) throw new Error('Stocking record not found')
    const allowed = await listForCompany(user, [stocking])
    if (!allowed.length) throw new Error('Access denied')

    await ctx.db.patch(id, patch)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'stockingHistory',
      recordId: id,
      previousValues: stocking,
      newValues: patch,
    })
    return id
  },
})

export const approveStocking = mutation({
  args: { id: v.id('stockingHistory') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    
    const stocking = await ctx.db.get(id)
    if (!stocking) throw new Error('Stocking record not found')
    const allowed = await listForCompany(user, [stocking])
    if (!allowed.length) throw new Error('Access denied')

    if (stocking.status !== 'pending_approval') {
      throw new Error('Only pending stockings can be approved')
    }

    const now = Date.now()

    // Update stocking status
    await ctx.db.patch(id, {
      status: 'approved',
      approvedBy: user._id,
      approvedAt: now,
    })

    // Update cage with stocking information
    await ctx.db.patch(stocking.cageId, {
      stockingDate: stocking.stockingDate,
      initialCount: stocking.fishCount,
      currentCount: stocking.fishCount,
      initialAbw: stocking.initialAbw,
      status: 'active',
      updatedAt: now,
    })

    await logAudit(ctx, {
      actionType: 'approve',
      tableName: 'stockingHistory',
      recordId: id,
      newValues: { status: 'approved' },
    })
  },
})

export const rejectStocking = mutation({
  args: { 
    id: v.id('stockingHistory'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { id, reason }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    
    const stocking = await ctx.db.get(id)
    if (!stocking) throw new Error('Stocking record not found')
    const allowed = await listForCompany(user, [stocking])
    if (!allowed.length) throw new Error('Access denied')

    if (stocking.status !== 'pending_approval') {
      throw new Error('Only pending stockings can be rejected')
    }

    await ctx.db.patch(id, {
      status: 'rejected',
      notes: reason ? `${stocking.notes || ''}\nRejection reason: ${reason}` : stocking.notes,
      approvedBy: user._id,
      approvedAt: Date.now(),
    })

    await logAudit(ctx, {
      actionType: 'reject',
      tableName: 'stockingHistory',
      recordId: id,
      newValues: { status: 'rejected', reason },
    })
  },
})

// TOPUP HISTORY
export const listTopupHistory = query({
  args: {
    stockingId: v.optional(v.id('stockingHistory')),
    status: v.optional(stockingStatus),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let topups = args.stockingId
      ? await ctx.db
          .query('topupHistory')
          .withIndex('by_stocking', (q) => q.eq('stockingId', args.stockingId!))
          .collect()
      : await ctx.db.query('topupHistory').collect()

    topups = await listForCompany(user, topups)

    if (args.status) {
      topups = topups.filter((t) => t.status === args.status)
    }

    return topups
      .map(toClientTopup)
      .sort((a, b) => b.topup_date.localeCompare(a.topup_date))
  },
})

export const createTopup = mutation({
  args: {
    stockingId: v.id('stockingHistory'),
    topupDate: v.string(),
    fishCount: v.number(),
    abw: v.number(),
    sourceLocation: v.optional(v.string()),
    transferSupervisor: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const stocking = await ctx.db.get(args.stockingId)
    if (!stocking) throw new Error('Stocking record not found')

    if (stocking.status !== 'approved') {
      throw new Error('Can only create topups for approved stockings')
    }

    const cage = await ctx.db.get(stocking.cageId)
    const companyId = (await writeCompanyId(user)) ?? stocking.companyId
    const rules = await loadRules(ctx, companyId)
    assertTopupAllowed({
      cage,
      addedFish: args.fishCount,
      abw: args.abw,
      rules: rules.stockingRules,
      farmRules: rules.farmRules,
    })

    const status = rules.stockingRules.requireApprovalForTopup
      ? 'pending_approval'
      : 'approved'

    const id = await ctx.db.insert('topupHistory', {
      ...args,
      status,
      companyId,
      createdBy: user._id,
      ...(status === 'approved'
        ? { approvedBy: user._id, approvedAt: Date.now() }
        : {}),
    })

    if (status === 'approved' && cage) {
      await ctx.db.patch(stocking.cageId, {
        currentCount: (cage.currentCount || 0) + args.fishCount,
        updatedAt: Date.now(),
      })
    }

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'topupHistory',
      recordId: id,
      newValues: { ...args, status },
    })
    return id
  },
})

export const approveTopup = mutation({
  args: { id: v.id('topupHistory') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    
    const topup = await ctx.db.get(id)
    if (!topup) throw new Error('Topup record not found')
    const allowed = await listForCompany(user, [topup])
    if (!allowed.length) throw new Error('Access denied')

    if (topup.status !== 'pending_approval') {
      throw new Error('Only pending topups can be approved')
    }

    const stocking = await ctx.db.get(topup.stockingId)
    if (!stocking) throw new Error('Associated stocking record not found')

    const now = Date.now()

    // Update topup status
    await ctx.db.patch(id, {
      status: 'approved',
      approvedBy: user._id,
      approvedAt: now,
    })

    // Update cage current count
    const cage = await ctx.db.get(stocking.cageId)
    if (cage) {
      await ctx.db.patch(stocking.cageId, {
        currentCount: (cage.currentCount || 0) + topup.fishCount,
        updatedAt: now,
      })
    }

    await logAudit(ctx, {
      actionType: 'approve',
      tableName: 'topupHistory',
      recordId: id,
      newValues: { status: 'approved' },
    })
  },
})

export const rejectTopup = mutation({
  args: { 
    id: v.id('topupHistory'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { id, reason }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    
    const topup = await ctx.db.get(id)
    if (!topup) throw new Error('Topup record not found')
    const allowed = await listForCompany(user, [topup])
    if (!allowed.length) throw new Error('Access denied')

    if (topup.status !== 'pending_approval') {
      throw new Error('Only pending topups can be rejected')
    }

    await ctx.db.patch(id, {
      status: 'rejected',
      notes: reason ? `${topup.notes || ''}\nRejection reason: ${reason}` : topup.notes,
      approvedBy: user._id,
      approvedAt: Date.now(),
    })

    await logAudit(ctx, {
      actionType: 'reject',
      tableName: 'topupHistory',
      recordId: id,
      newValues: { status: 'rejected', reason },
    })
  },
})