import { v } from 'convex/values'
import { paginationResultValidator, paginationOptsValidator } from 'convex/server'
import { query, mutation } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { asOfDate, scopedPage, scopedRows, scopedRowsByStatus } from './lib/scope'
import { assertOwns, listForCompany, listForCompanyAndLocation, writeCompanyId, logAudit } from './lib/tenancy'
import {
  mergeSettings,
  assertStockingAllowed,
  assertTopupAllowed,
} from './lib/farmRules'
import { assertNoOtherOpenStocking } from './lib/cycles'
import { allocateBatchNumber } from './lib/batchNumbers'
import { beginStockWrite, restateStocking, shadowStocking, shadowTopup } from './lib/productionDualWrite'
import { assertDifferentApprover, assertUserCan, requireMember } from './lib/permissions'
import { onApprovalDecided, onApprovalRequested } from './approvalAlerts'
import { validateCustom } from './lib/customFields'
import { customValues } from './schema'

async function loadRules(ctx: QueryCtx, companyId: Id<'companies'> | undefined) {
  if (!companyId) return mergeSettings(undefined)
  const company = await ctx.db.get(companyId)
  return mergeSettings(company?.settings)
}

/**
 * The fish transfer that created this stocking or top-up, if any. Such rows
 * are approved or rejected through the transfer, never on their own:
 * approving one directly would put the fish in the destination cage without
 * taking them out of the source (doc 09 S2/S3).
 */
async function linkedTransfer(
  ctx: QueryCtx,
  link: { stockingId?: Id<'stockingHistory'>; topupId?: Id<'topupHistory'> },
) {
  if (link.stockingId) {
    return await ctx.db
      .query('fishTransfers')
      .withIndex('by_destinationStockingId', (q) =>
        q.eq('destinationStockingId', link.stockingId),
      )
      .first()
  }
  if (link.topupId) {
    return await ctx.db
      .query('fishTransfers')
      .withIndex('by_destinationTopupId', (q) =>
        q.eq('destinationTopupId', link.topupId),
      )
      .first()
  }
  return null
}

async function assertNotTransferLinked(
  ctx: QueryCtx,
  link: { stockingId?: Id<'stockingHistory'>; topupId?: Id<'topupHistory'> },
) {
  const transfer = await linkedTransfer(ctx, link)
  if (transfer) {
    const what = link.stockingId ? 'stocking' : 'top-up'
    throw new Error(
      `This ${what} was created by a fish transfer. Approve or reject the transfer on the Approvals page instead.`,
    )
  }
}

const stockingStatus = v.union(
  v.literal('pending_approval'),
  v.literal('approved'),
  v.literal('rejected'),
)

function toClientStocking(s: Doc<'stockingHistory'>) {
  return {
    custom: s.custom ?? {},
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
    species: s.species,
    location_id: s.locationId,
    company_id: s.companyId,
    created_by: s.createdBy,
    approved_by: s.approvedBy,
    approved_at: s.approvedAt,
    deleted_at: s.deletedAt,
    created_at: s._creationTime,
  }
}

function toClientTopup(t: Doc<'topupHistory'>) {
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

const statusValues = v.union(
  v.literal('rejected'),
  v.literal('approved'),
  v.literal('pending_approval'),
)

const topupRow = v.object({
  type: v.literal('topup'),
  id: v.id('topupHistory'),
  batchNumber: v.string(),
  cageName: v.string(),
  date: v.string(),
  count: v.number(),
  abw: v.number(),
  biomass: v.number(),
  createdAt: v.number(),
})

const stockingRow = v.object({
  type: v.literal('stocking'),
  id: v.id('stockingHistory'),
  batchNumber: v.string(),
  cageName: v.string(),
  date: v.string(),
  count: v.number(),
  abw: v.number(),
  biomass: v.number(),
  createdAt: v.number(),
})

const fishTransferRow = v.object({
  type: v.literal('fish_transfer'),
  id: v.id('fishTransfers'),
  batchNumber: v.string(),
  cageName: v.string(),
  date: v.string(),
  count: v.number(),
  abw: v.number(),
  biomass: v.number(),
  createdAt: v.number(),
})

const cageValues = v.union(
  v.object({
    id: v.id('cages'),
    name: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('harvested'),
      v.literal('harvesting'),
      v.literal('maintenance'),
      v.literal('fallow'),
      v.literal('empty'),
    ),
    code: v.optional(v.string()),
    location: v.optional(v.string()),
  }),
  v.null(),
)

const topupHistoryRow = v.object({
  id: v.id('topupHistory'),
  _id: v.id('topupHistory'),
  stocking_id: v.id('stockingHistory'),
  topup_date: v.string(),
  fish_count: v.number(),
  abw: v.number(),
  source_location: v.optional(v.string()),
  transfer_supervisor: v.optional(v.string()),
  status: statusValues,
  notes: v.optional(v.string()),
  company_id: v.optional(v.id('companies')),
  created_by: v.optional(v.id('users')),
  approved_by: v.optional(v.id('users')),
  approved_at: v.optional(v.number()),
  created_at: v.number(),
})

const cageRow = v.object({
  cage: v.union(
    v.object({
      id: v.id('cages'),
      _id: v.id('cages'),
      name: v.string(),
      code: v.optional(v.string()),
      status: v.union(
        v.literal('active'),
        v.literal('harvested'),
        v.literal('harvesting'),
        v.literal('maintenance'),
        v.literal('fallow'),
        v.literal('empty'),
      ),
      location: v.optional(v.string()),
    }),
    v.null(),
  ),
  cage_name: v.union(v.string(), v.null()),
  custom: v.record(v.string(), v.any()),
  id: v.id('stockingHistory'),
  _id: v.id('stockingHistory'),
  cage_id: v.id('cages'),
  batch_number: v.string(),
  stocking_date: v.string(),
  fish_count: v.number(),
  initial_abw: v.number(),
  initial_biomass: v.number(),
  source_location: v.optional(v.string()),
  source_cage: v.optional(v.string()),
  transfer_supervisor: v.optional(v.string()),
  sampling_supervisor: v.optional(v.string()),
  status: statusValues,
  notes: v.optional(v.string()),
  species: v.optional(v.string()),
  location_id: v.optional(v.id('farmLocations')),
  company_id: v.optional(v.id('companies')),
  created_by: v.optional(v.id('users')),
  approved_by: v.optional(v.id('users')),
  approved_at: v.optional(v.number()),
  deleted_at: v.optional(v.number()),
  created_at: v.number(),
})

// STOCKING HISTORY
export const listStockingHistory = query({
  args: {
    cageId: v.optional(v.id('cages')),
    status: v.optional(stockingStatus),
    includeDeleted: v.optional(v.boolean()),
    locationId: v.optional(v.id('farmLocations')),
  },
  returns: v.array(cageRow),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    let stockings = args.cageId
      ? await ctx.db
          .query('stockingHistory')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await scopedRows(ctx, user, 'stockingHistory', { locationId: args.locationId })

    stockings = await listForCompanyAndLocation(user, stockings, args.locationId)

    if (args.status) {
      stockings = stockings.filter((s) => s.status === args.status)
    }
    if (!args.includeDeleted) {
      stockings = stockings.filter((s) => !s.deletedAt)
    }

    return (
      await Promise.all(
        stockings.map(async (s) => {
          const cage = s.cageId ? await ctx.db.get(s.cageId) : null
          const client = toClientStocking(s)
          return {
            ...client,
            cage: cage
              ? {
                  id: cage._id,
                  _id: cage._id,
                  name: cage.name,
                  code: cage.code,
                  status: cage.status,
                  location: cage.location,
                }
              : null,
            cage_name: cage?.name ?? null,
          }
        }),
      )
    ).sort((a, b) => b.stocking_date.localeCompare(a.stocking_date))
  },
})

/**
 * Paginated stocking history (PLAT-001), newest entry first (creation order,
 * via `by_company`). Status, deleted and site filters apply per page, so a
 * page can come back short.
 */
export const listStockingHistoryPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(stockingStatus),
    includeDeleted: v.optional(v.boolean()),
    locationId: v.optional(v.id('farmLocations')),
  },
  returns: paginationResultValidator(cageRow),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const result = await scopedPage(ctx, user, 'stockingHistory', args.paginationOpts)
    const rows = result.page.filter(
      (s) =>
        (!args.status || s.status === args.status) &&
        (args.includeDeleted || !s.deletedAt) &&
        (!args.locationId || s.locationId === args.locationId),
    )
    const page = []
    for (const s of rows) {
      const cage = s.cageId ? await ctx.db.get(s.cageId) : null
      page.push({
        ...toClientStocking(s),
        cage: cage
          ? {
              id: cage._id,
              _id: cage._id,
              name: cage.name,
              code: cage.code,
              status: cage.status,
              location: cage.location,
            }
          : null,
        cage_name: cage?.name ?? null,
      })
    }
    return { ...result, page }
  },
})

export const getStocking = query({
  args: { id: v.id('stockingHistory') },
  returns: v.union(
    v.object({
      transfer_id: v.union(v.id('fishTransfers'), v.null()),
      cage: cageValues,
      topups: v.array(topupHistoryRow),
      custom: v.record(v.string(), v.any()),
      id: v.id('stockingHistory'),
      _id: v.id('stockingHistory'),
      cage_id: v.id('cages'),
      batch_number: v.string(),
      stocking_date: v.string(),
      fish_count: v.number(),
      initial_abw: v.number(),
      initial_biomass: v.number(),
      source_location: v.optional(v.string()),
      source_cage: v.optional(v.string()),
      transfer_supervisor: v.optional(v.string()),
      sampling_supervisor: v.optional(v.string()),
      status: statusValues,
      notes: v.optional(v.string()),
      species: v.optional(v.string()),
      location_id: v.optional(v.id('farmLocations')),
      company_id: v.optional(v.id('companies')),
      created_by: v.optional(v.id('users')),
      approved_by: v.optional(v.id('users')),
      approved_at: v.optional(v.number()),
      deleted_at: v.optional(v.number()),
      created_at: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const stocking = await ctx.db.get(id)
    if (!stocking || stocking.deletedAt) return null
    const allowed = await listForCompany(user, [stocking])
    if (!allowed.length) return null

    const cage = await ctx.db.get(stocking.cageId)
    const topups = (
      await ctx.db
        .query('topupHistory')
        .withIndex('by_stocking', (q) => q.eq('stockingId', id))
        .collect()
    ).filter((t) => t.status === 'approved' || t.status === 'pending_approval')

    const transfer = await linkedTransfer(ctx, { stockingId: id })
    return {
      ...toClientStocking(stocking),
      transfer_id: transfer?._id ?? null,
      cage: cage
        ? {
            id: cage._id,
            name: cage.name,
            status: cage.status,
            code: cage.code,
            location: cage.location,
          }
        : null,
      topups: topups.map(toClientTopup),
    }
  },
})

export const getTopup = query({
  args: { id: v.id('topupHistory') },
  returns: v.union(
    v.object({
      transfer_id: v.union(v.id('fishTransfers'), v.null()),
      stocking: v.union(
        v.object({
          id: v.id('stockingHistory'),
          batch_number: v.string(),
          stocking_date: v.string(),
          status: statusValues,
          fish_count: v.number(),
          initial_abw: v.number(),
        }),
        v.null(),
      ),
      cage: cageValues,
      id: v.id('topupHistory'),
      _id: v.id('topupHistory'),
      stocking_id: v.id('stockingHistory'),
      topup_date: v.string(),
      fish_count: v.number(),
      abw: v.number(),
      source_location: v.optional(v.string()),
      transfer_supervisor: v.optional(v.string()),
      status: statusValues,
      notes: v.optional(v.string()),
      company_id: v.optional(v.id('companies')),
      created_by: v.optional(v.id('users')),
      approved_by: v.optional(v.id('users')),
      approved_at: v.optional(v.number()),
      created_at: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const topup = await ctx.db.get(id)
    if (!topup) return null
    const allowed = await listForCompany(user, [topup])
    if (!allowed.length) return null

    const stocking = await ctx.db.get(topup.stockingId)
    let cage = null
    if (stocking) {
      const c = await ctx.db.get(stocking.cageId)
      if (c) {
        cage = {
          id: c._id,
          name: c.name,
          status: c.status,
          code: c.code,
          location: c.location,
        }
      }
    }

    const transfer = await linkedTransfer(ctx, { topupId: id })
    return {
      ...toClientTopup(topup),
      transfer_id: transfer?._id ?? null,
      stocking: stocking
        ? {
            id: stocking._id,
            batch_number: stocking.batchNumber,
            stocking_date: stocking.stockingDate,
            status: stocking.status,
            fish_count: stocking.fishCount,
            initial_abw: stocking.initialAbw,
          }
        : null,
      cage,
    }
  },
})

export const createStocking = mutation({
  args: {
    cageId: v.id('cages'),
    batchNumber: v.optional(v.string()),
    stockingDate: v.string(),
    fishCount: v.number(),
    initialAbw: v.number(),
    initialBiomass: v.number(),
    sourceLocation: v.optional(v.string()),
    sourceCage: v.optional(v.string()),
    transferSupervisor: v.optional(v.string()),
    samplingSupervisor: v.optional(v.string()),
    notes: v.optional(v.string()),
    species: v.optional(v.string()),
    custom: v.optional(customValues),
  },
  returns: v.id('stockingHistory'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.stocking.request' })
    const cage = await ctx.db.get(args.cageId)
    assertOwns(user, cage, 'Cage')

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

    const locationId = cage.locationId
    const { species, batchNumber: rawBatch, custom: rawCustom, ...rest } = args
    const custom = await validateCustom(ctx, {
      companyId,
      entity: 'stockingHistory',
      custom: rawCustom,
      mode: 'create',
      context: { locationId, core: { ...rest, species } },
    })
    const batchNumber =
      rawBatch?.trim() ||
      (await allocateBatchNumber(ctx, user, cage, args.stockingDate))

    const id = await ctx.db.insert('stockingHistory', {
      ...rest,
      custom,
      batchNumber,
      species: species || undefined,
      status,
      locationId,
      companyId,
      createdBy: user._id,
      ...(status === 'approved'
        ? { approvedBy: user._id, approvedAt: Date.now() }
        : {}),
    })

    if (status === 'approved') {
      const write = await beginStockWrite(ctx, [cage], user._id)
      await ctx.db.patch(args.cageId, {
        stockingDate: args.stockingDate,
        initialCount: args.fishCount,
        currentCount: args.fishCount,
        initialAbw: args.initialAbw,
        // New cycle: weight starts at the stocking ABW, not the last cycle's.
        currentWeight: args.initialAbw,
        status: 'active',
        species: species || cage.species,
        updatedAt: Date.now(),
      })
      const row = (await ctx.db.get(id))!
      await write.post((o) => shadowStocking(ctx, row, user._id, o))
    }

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'stockingHistory',
      recordId: id,
      newValues: { ...args, batchNumber, status },
    })
    if (status === 'pending_approval') await onApprovalRequested(ctx, 'stocking', id)
    return id
  },
})

/** Preview next auto batch number for a cage + date. */
export const suggestBatchNumber = query({
  args: {
    cageId: v.id('cages'),
    stockingDate: v.optional(v.string()),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const cage = await ctx.db.get(args.cageId)
    if (!cage) return null
    const allowed = await listForCompany(user, [cage])
    if (!allowed.length) return null
    // The client passes stockingDate (its today by default); the server
    // clock is only the fallback for older clients.
    return allocateBatchNumber(ctx, user, cage, asOfDate(args.stockingDate))
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
      custom: v.optional(customValues),
    }),
  },
  returns: v.id('stockingHistory'),
  handler: async (ctx, { id, patch: rawPatch }) => {
    const { user } = await requireMember(ctx, { permission: 'production.stocking.request' })
    const stocking = await ctx.db.get(id)
    if (!stocking) throw new Error('Stocking record not found')
    const allowed = await listForCompany(user, [stocking])
    if (!allowed.length) throw new Error('Access denied')
    if (stocking.status === 'approved') await assertUserCan(ctx, user, 'production.stocking.approve')
    const patch = { ...rawPatch }
    if (patch.custom !== undefined) {
      patch.custom = await validateCustom(ctx, {
        companyId: stocking.companyId,
        entity: 'stockingHistory',
        custom: patch.custom,
        previous: stocking.custom,
        mode: 'update',
        context: { locationId: stocking.locationId, core: { ...stocking, ...rawPatch } },
      })
    }

    await ctx.db.patch(id, patch)
    await restateStocking(ctx, stocking, (await ctx.db.get(id))!, user._id)
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

/** Soft-delete stocking (pending or rejected only). */
export const removeStocking = mutation({
  args: {
    id: v.id('stockingHistory'),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, reason }) => {
    const { user } = await requireMember(ctx, { permission: 'production.stocking.approve' })
    const stocking = await ctx.db.get(id)
    if (!stocking || stocking.deletedAt) throw new Error('Stocking not found')
    const allowed = await listForCompany(user, [stocking])
    if (!allowed.length) throw new Error('Access denied')
    if (stocking.status === 'approved') {
      throw new Error('Cannot delete an approved stocking — reject or adjust the cage instead')
    }

    await ctx.db.patch(id, {
      deletedAt: Date.now(),
      notes: reason
        ? `${stocking.notes || ''}\nDeleted: ${reason}`.trim()
        : stocking.notes,
    })
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'stockingHistory',
      recordId: id,
      previousValues: stocking,
      newValues: { deleted: true, reason },
    })
  },
})

export const approveStocking = mutation({
  args: { id: v.id('stockingHistory') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.stocking.approve' })
    
    const stocking = await ctx.db.get(id)
    if (!stocking) throw new Error('Stocking record not found')
    const allowed = await listForCompany(user, [stocking])
    if (!allowed.length) throw new Error('Access denied')

    if (stocking.status !== 'pending_approval') {
      throw new Error('Only pending stockings can be approved')
    }
    await assertDifferentApprover(ctx, user, stocking)
    await assertNotTransferLinked(ctx, { stockingId: id })

    // Re-check against the cage as it is now: it may have been stocked since
    // this request was made (doc 09 S9).
    const cage = await ctx.db.get(stocking.cageId)
    if (!cage) throw new Error('Cage not found')
    const rules = await loadRules(ctx, stocking.companyId ?? cage.companyId)
    assertStockingAllowed({
      cage,
      fishCount: stocking.fishCount,
      abw: stocking.initialAbw,
      rules: rules.stockingRules,
      farmRules: rules.farmRules,
    })
    await assertNoOtherOpenStocking(ctx, cage, id)

    const now = Date.now()

    // Update stocking status
    await ctx.db.patch(id, {
      status: 'approved',
      approvedBy: user._id,
      approvedAt: now,
    })

    // Update cage with stocking information
    const write = await beginStockWrite(ctx, [cage], user._id)
    await ctx.db.patch(stocking.cageId, {
      stockingDate: stocking.stockingDate,
      initialCount: stocking.fishCount,
      currentCount: stocking.fishCount,
      initialAbw: stocking.initialAbw,
      // New cycle: weight starts at the stocking ABW, not the last cycle's.
      currentWeight: stocking.initialAbw,
      status: 'active',
      species: stocking.species,
      updatedAt: now,
    })
    const approved = (await ctx.db.get(id))!
    await write.post((o) => shadowStocking(ctx, approved, user._id, o))

    await logAudit(ctx, {
      actionType: 'approve',
      tableName: 'stockingHistory',
      recordId: id,
      newValues: { status: 'approved' },
    })
    await onApprovalDecided(ctx, 'stocking', id, 'approved', user._id)
  },
})

export const rejectStocking = mutation({
  args: { 
    id: v.id('stockingHistory'),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, reason }) => {
    const { user } = await requireMember(ctx, { permission: 'production.stocking.approve' })
    
    const stocking = await ctx.db.get(id)
    if (!stocking) throw new Error('Stocking record not found')
    const allowed = await listForCompany(user, [stocking])
    if (!allowed.length) throw new Error('Access denied')

    if (stocking.status !== 'pending_approval') {
      throw new Error('Only pending stockings can be rejected')
    }
    await assertNotTransferLinked(ctx, { stockingId: id })

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
    await onApprovalDecided(ctx, 'stocking', id, 'rejected', user._id)
  },
})

// TOPUP HISTORY
export const listTopupHistory = query({
  args: {
    stockingId: v.optional(v.id('stockingHistory')),
    status: v.optional(stockingStatus),
  },
  returns: v.array(topupHistoryRow),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    let topups = args.stockingId
      ? await ctx.db
          .query('topupHistory')
          .withIndex('by_stocking', (q) => q.eq('stockingId', args.stockingId!))
          .collect()
      : await scopedRows(ctx, user, 'topupHistory')

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
  returns: v.id('topupHistory'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.stocking.request' })
    const stocking = await ctx.db.get(args.stockingId)
    assertOwns(user, stocking, 'Stocking record')

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
      locationId: stocking.locationId || cage?.locationId,
      companyId,
      createdBy: user._id,
      ...(status === 'approved'
        ? { approvedBy: user._id, approvedAt: Date.now() }
        : {}),
    })

    if (status === 'approved' && cage) {
      const write = await beginStockWrite(ctx, [cage], user._id)
      await ctx.db.patch(stocking.cageId, {
        currentCount: (cage.currentCount || 0) + args.fishCount,
        updatedAt: Date.now(),
      })
      const row = (await ctx.db.get(id))!
      await write.post((o) => shadowTopup(ctx, row, user._id, o))
    }

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'topupHistory',
      recordId: id,
      newValues: { ...args, status },
    })
    if (status === 'pending_approval') await onApprovalRequested(ctx, 'topup', id)
    return id
  },
})

export const approveTopup = mutation({
  args: { id: v.id('topupHistory') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.stocking.approve' })
    
    const topup = await ctx.db.get(id)
    if (!topup) throw new Error('Topup record not found')
    const allowed = await listForCompany(user, [topup])
    if (!allowed.length) throw new Error('Access denied')

    if (topup.status !== 'pending_approval') {
      throw new Error('Only pending topups can be approved')
    }
    await assertDifferentApprover(ctx, user, topup)
    await assertNotTransferLinked(ctx, { topupId: id })

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
    const write = await beginStockWrite(ctx, [cage], user._id)
    if (cage) {
      await ctx.db.patch(stocking.cageId, {
        currentCount: (cage.currentCount || 0) + topup.fishCount,
        updatedAt: now,
      })
    }
    const approved = (await ctx.db.get(id))!
    await write.post((o) => shadowTopup(ctx, approved, user._id, o))

    await logAudit(ctx, {
      actionType: 'approve',
      tableName: 'topupHistory',
      recordId: id,
      newValues: { status: 'approved' },
    })
    await onApprovalDecided(ctx, 'topup', id, 'approved', user._id)
  },
})

export const rejectTopup = mutation({
  args: { 
    id: v.id('topupHistory'),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, reason }) => {
    const { user } = await requireMember(ctx, { permission: 'production.stocking.approve' })
    
    const topup = await ctx.db.get(id)
    if (!topup) throw new Error('Topup record not found')
    const allowed = await listForCompany(user, [topup])
    if (!allowed.length) throw new Error('Access denied')

    if (topup.status !== 'pending_approval') {
      throw new Error('Only pending topups can be rejected')
    }
    await assertNotTransferLinked(ctx, { topupId: id })

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
    await onApprovalDecided(ctx, 'topup', id, 'rejected', user._id)
  },
})

/** Live pending stocking + top-up queue for the approvals page. */
export const listPendingApprovals = query({
  args: {},
  returns: v.object({
    stockings: v.array(stockingRow),
    topups: v.array(topupRow),
    fishTransfers: v.array(fishTransferRow),
    all: v.array(v.union(stockingRow, fishTransferRow, topupRow)),
  }),
  handler: async (ctx) => {
    const { user } = await requireMember(ctx, { permission: 'production.stocking.approve' })

    // The company's whole pending queue (by_company_and_status): another
    // tenant's backlog can no longer hide this company's pending items.
    let stockings = (
      await scopedRowsByStatus(ctx, user, 'stockingHistory', 'pending_approval')
    ).filter((s) => !s.deletedAt)
    let topups = await scopedRowsByStatus(ctx, user, 'topupHistory', 'pending_approval')
    const transfers = await scopedRowsByStatus(
      ctx,
      user,
      'fishTransfers',
      'pending_approval',
    )


    const linkedStockingIds = new Set(
      transfers
        .map((t) => t.destinationStockingId)
        .filter(Boolean)
        .map(String),
    )
    const linkedTopupIds = new Set(
      transfers
        .map((t) => t.destinationTopupId)
        .filter(Boolean)
        .map(String),
    )
    stockings = stockings.filter((s) => !linkedStockingIds.has(String(s._id)))
    topups = topups.filter((t) => !linkedTopupIds.has(String(t._id)))

    const cageIds = [
      ...new Set([
        ...stockings.map((s) => s.cageId),
        ...transfers.flatMap((t) => [t.sourceCageId, t.destinationCageId]),
      ]),
    ]
    const cages = new Map<string, string>()
    for (const cageId of cageIds) {
      const cage = await ctx.db.get(cageId)
      if (cage) cages.set(String(cageId), cage.name)
    }

    const stockingRows = stockings.map((s) => ({
      type: 'stocking' as const,
      id: s._id,
      batchNumber: s.batchNumber,
      cageName: cages.get(String(s.cageId)) || '—',
      date: s.stockingDate,
      count: s.fishCount,
      abw: s.initialAbw,
      biomass: s.initialBiomass,
      createdAt: s._creationTime,
    }))

    const topupRows = []
    for (const t of topups) {
      const stocking = await ctx.db.get(t.stockingId)
      let batchNumber = 'Top-up'
      let cageName = '—'
      if (stocking) {
        batchNumber = stocking.batchNumber
        const cached = cages.get(String(stocking.cageId))
        if (cached) {
          cageName = cached
        } else {
          const cage = await ctx.db.get(stocking.cageId)
          cageName = cage?.name || '—'
          if (cage) cages.set(String(stocking.cageId), cage.name)
        }
      }
      topupRows.push({
        type: 'topup' as const,
        id: t._id,
        batchNumber,
        cageName,
        date: t.topupDate,
        count: t.fishCount,
        abw: t.abw,
        biomass: (t.fishCount * t.abw) / 1000,
        createdAt: t._creationTime,
      })
    }

    const transferRows = transfers.map((t) => {
      const srcName = cages.get(String(t.sourceCageId)) || '—'
      const destName = cages.get(String(t.destinationCageId)) || '—'
      return {
        type: 'fish_transfer' as const,
        id: t._id,
        batchNumber: `${srcName} → ${destName}`,
        cageName: destName,
        date: t.transferDate,
        count: t.quantity,
        abw: t.abw,
        biomass: t.biomass,
        createdAt: t._creationTime,
      }
    })

    const all = [...stockingRows, ...topupRows, ...transferRows].sort(
      (a, b) => b.createdAt - a.createdAt,
    )

    return {
      stockings: stockingRows,
      topups: topupRows,
      fishTransfers: transferRows,
      all,
    }
  },
})