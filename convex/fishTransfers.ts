import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { query, mutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { scopedPage, scopedRows, scopedRowsByStatus } from './lib/scope'
import { requireUser, requireRole } from './lib/authz'
import { listForCompany, writeCompanyId, logAudit } from './lib/tenancy'
import { emitDomainEvent } from './lib/events'
import {
  mergeSettings,
  assertStockingAllowed,
  assertTopupAllowed,
} from './lib/farmRules'
import { assertNoOtherOpenStocking } from './lib/cycles'
import { allocateBatchNumber } from './lib/batchNumbers'
import {
  deriveTransferType,
  transferBiomassKg,
  classifyDestination,
  sourceCagePatchAfterTransfer,
} from './lib/fishTransferLogic'

async function loadRules(ctx: any, companyId: any) {
  if (!companyId) return mergeSettings(undefined)
  const company = await ctx.db.get(companyId)
  return mergeSettings(company?.settings)
}

async function findApprovedStockingForCage(ctx: any, user: any, cageId: any) {
  let rows = await ctx.db
    .query('stockingHistory')
    .withIndex('by_cage', (q: any) => q.eq('cageId', cageId))
    .collect()
  rows = (await listForCompany(user, rows)).filter(
    (s: any) => !s.deletedAt && s.status === 'approved',
  )
  rows.sort((a: any, b: any) => (b.stockingDate || '').localeCompare(a.stockingDate || ''))
  return rows[0] || null
}

/**
 * Move the fish: take them off the source cage and put them on the
 * destination through the linked stocking or top-up.
 *
 * The linked row is only applied when it is still pending (or was created
 * already approved in this same mutation). A linked row that was approved
 * directly before transfer-linked rows were locked has already put its fish in
 * the destination cage, so only the source side is applied. A rejected linked
 * row means the transfer can no longer be approved.
 */
/** One `transfer.approved` event when a transfer takes effect (doc 07 §4). */
async function emitTransferApproved(
  ctx: MutationCtx,
  transfer: Doc<'fishTransfers'>,
  actorUserId: Id<'users'>,
) {
  if (!transfer.companyId) return
  const [source, dest] = await Promise.all([
    ctx.db.get(transfer.sourceCageId),
    ctx.db.get(transfer.destinationCageId),
  ])
  await emitDomainEvent(ctx, 'transfer.approved', {
    companyId: transfer.companyId,
    subject: { table: 'fishTransfers', id: String(transfer._id) },
    locationId: transfer.sourceLocationId ?? source?.locationId,
    actorUserId,
    businessDate: transfer.transferDate,
    data: {
      sourceCageId: String(transfer.sourceCageId),
      sourceCageName: source?.name ?? null,
      destinationCageId: String(transfer.destinationCageId),
      destinationCageName: dest?.name ?? null,
      quantity: transfer.quantity,
      transferType: transfer.transferType,
    },
  })
}

async function applyFishTransfer(
  ctx: any,
  transfer: any,
  opts: { linkedJustCreated?: boolean } = {},
) {
  const source = await ctx.db.get(transfer.sourceCageId)
  if (!source) throw new Error('Source cage not found')
  const sourceCount = source.currentCount || 0
  if (sourceCount < transfer.quantity) {
    throw new Error('Insufficient fish on source cage')
  }

  const stocking = transfer.destinationStockingId
    ? await ctx.db.get(transfer.destinationStockingId)
    : null
  if (transfer.destinationStockingId && !stocking) {
    throw new Error('Linked destination stocking not found')
  }
  const topup = transfer.destinationTopupId
    ? await ctx.db.get(transfer.destinationTopupId)
    : null
  if (transfer.destinationTopupId && !topup) {
    throw new Error('Linked destination top-up not found')
  }
  for (const [row, label] of [
    [stocking, 'stocking'],
    [topup, 'top-up'],
  ] as const) {
    if (row?.status === 'rejected' || row?.deletedAt) {
      throw new Error(
        `The ${label} linked to this transfer was rejected, so the transfer cannot be approved. Reject the transfer instead.`,
      )
    }
  }
  const applies = (row: any) =>
    opts.linkedJustCreated || row.status === 'pending_approval'

  // At approval time, re-check the destination as it is now: it may have been
  // stocked or harvested since the transfer was requested (doc 09 S9).
  if (!opts.linkedJustCreated) {
    if (stocking && applies(stocking)) {
      const destCage = await ctx.db.get(stocking.cageId)
      if (!destCage) throw new Error('Destination cage not found')
      const rules = await loadRules(ctx, transfer.companyId ?? destCage.companyId)
      assertStockingAllowed({
        cage: destCage,
        fishCount: stocking.fishCount,
        abw: stocking.initialAbw,
        rules: rules.stockingRules,
        farmRules: rules.farmRules,
      })
      await assertNoOtherOpenStocking(ctx, destCage, stocking._id)
    }
    if (topup && applies(topup)) {
      const destStocking = await ctx.db.get(topup.stockingId)
      if (destStocking?.closedAt) {
        throw new Error(
          'The destination cage has been harvested since this transfer was requested. Reject the transfer and create a new one.',
        )
      }
    }
  }

  const now = Date.now()
  const sourcePatch = sourceCagePatchAfterTransfer({
    transferType: transfer.transferType,
    quantity: transfer.quantity,
    sourceCurrentCount: sourceCount,
    now,
  })
  await ctx.db.patch(transfer.sourceCageId, sourcePatch)

  if (stocking && applies(stocking)) {
    if (stocking.status === 'pending_approval') {
      await ctx.db.patch(stocking._id, {
        status: 'approved',
        approvedBy: transfer.approvedBy,
        approvedAt: now,
      })
    }
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
  }

  if (topup && applies(topup)) {
    if (topup.status === 'pending_approval') {
      await ctx.db.patch(topup._id, {
        status: 'approved',
        approvedBy: transfer.approvedBy,
        approvedAt: now,
      })
    }
    const destStocking = await ctx.db.get(topup.stockingId)
    if (!destStocking) throw new Error('Associated stocking record not found')
    const destCage = await ctx.db.get(destStocking.cageId)
    if (destCage) {
      await ctx.db.patch(destStocking.cageId, {
        currentCount: (destCage.currentCount || 0) + topup.fishCount,
        updatedAt: now,
      })
    }
  }
}

export const listFishTransfers = query({
  args: {
    status: v.optional(
      v.union(
        v.literal('pending_approval'),
        v.literal('approved'),
        v.literal('rejected'),
      ),
    ),
    sourceCageId: v.optional(v.id('cages')),
    destinationCageId: v.optional(v.id('cages')),
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let rows = args.status
      ? await scopedRowsByStatus(ctx, user, 'fishTransfers', args.status)
      : await scopedRows(ctx, user, 'fishTransfers')
    rows = await listForCompany(user, rows)
    if (args.status) rows = rows.filter((r) => r.status === args.status)
    if (args.sourceCageId) {
      rows = rows.filter((r) => r.sourceCageId === args.sourceCageId)
    }
    if (args.destinationCageId) {
      rows = rows.filter((r) => r.destinationCageId === args.destinationCageId)
    }
    if (args.locationId) {
      rows = rows.filter(
        (r) =>
          r.sourceLocationId === args.locationId ||
          r.destinationLocationId === args.locationId,
      )
    }
    rows.sort((a, b) => b.updatedAt - a.updatedAt)
    return await withCageNames(ctx, rows)
  },
})

/** Client rows with source/destination cage names (one `get` per cage). */
async function withCageNames(ctx: QueryCtx, rows: Doc<'fishTransfers'>[]) {
  const names = new Map<string, string | undefined>()
  const nameOf = async (id: Doc<'fishTransfers'>['sourceCageId']) => {
    const key = String(id)
    if (!names.has(key)) names.set(key, (await ctx.db.get(id))?.name)
    return names.get(key)
  }
  const out = []
  for (const r of rows) {
    out.push({
      id: r._id,
      ...r,
      sourceCageName: await nameOf(r.sourceCageId),
      destinationCageName: await nameOf(r.destinationCageId),
    })
  }
  return out
}

/**
 * Paginated fish transfers (PLAT-001), newest first (creation order, via
 * `by_company`). Status, cage and site filters apply per page, so a page can
 * come back short.
 */
export const listFishTransfersPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(
      v.union(
        v.literal('pending_approval'),
        v.literal('approved'),
        v.literal('rejected'),
      ),
    ),
    sourceCageId: v.optional(v.id('cages')),
    destinationCageId: v.optional(v.id('cages')),
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const result = await scopedPage(ctx, user, 'fishTransfers', args.paginationOpts)
    const rows = result.page.filter(
      (r) =>
        (!args.status || r.status === args.status) &&
        (!args.sourceCageId || r.sourceCageId === args.sourceCageId) &&
        (!args.destinationCageId || r.destinationCageId === args.destinationCageId) &&
        (!args.locationId ||
          r.sourceLocationId === args.locationId ||
          r.destinationLocationId === args.locationId),
    )
    return { ...result, page: await withCageNames(ctx, rows) }
  },
})


export const getFishTransfer = query({
  args: { id: v.id('fishTransfers') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const row = await ctx.db.get(id)
    if (!row) return null
    const allowed = await listForCompany(user, [row])
    if (!allowed.length) return null
    const [src, dest] = await Promise.all([
      ctx.db.get(row.sourceCageId),
      ctx.db.get(row.destinationCageId),
    ])
    return {
      id: row._id,
      ...row,
      sourceCageName: src?.name,
      destinationCageName: dest?.name,
    }
  },
})

export const createFishTransfer = mutation({
  args: {
    sourceCageId: v.id('cages'),
    destinationCageId: v.id('cages'),
    transferDate: v.string(),
    quantity: v.number(),
    abw: v.number(),
    transferSupervisor: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (args.sourceCageId === args.destinationCageId) {
      throw new Error('Source and destination cages must be different')
    }

    const source = await ctx.db.get(args.sourceCageId)
    const dest = await ctx.db.get(args.destinationCageId)
    if (!source || !dest) throw new Error('Cage not found')

    const allowed = await listForCompany(user, [source, dest])
    if (allowed.length < 2) throw new Error('Access denied')

    const sourceCount = source.currentCount || 0
    if (sourceCount <= 0) throw new Error('Source cage has no fish')
    if (args.quantity <= 0) throw new Error('Quantity must be greater than zero')
    if (args.quantity > sourceCount) {
      throw new Error(
        `Quantity ${args.quantity} exceeds source count ${sourceCount}`,
      )
    }

    const companyId = (await writeCompanyId(user)) ?? source.companyId
    const rules = await loadRules(ctx, companyId)
    const transferType = deriveTransferType(args.quantity, sourceCount)
    const biomass = transferBiomassKg(args.quantity, args.abw)
    const branch = classifyDestination(
      dest.status,
      rules.stockingRules.allowStockOnlyEmptyStatuses,
    )
    if (branch === 'invalid') {
      throw new Error(
        `Destination cage status "${dest.status}" cannot receive a transfer`,
      )
    }

    const requireApproval =
      rules.stockingRules.requireApprovalForFishTransfer !== false
    const status = requireApproval ? 'pending_approval' : 'approved'
    const now = Date.now()

    const sourceStocking = await findApprovedStockingForCage(
      ctx,
      user,
      args.sourceCageId,
    )

    let destinationStockingId: any = undefined
    let destinationTopupId: any = undefined

    if (branch === 'stock') {
      assertStockingAllowed({
        cage: dest,
        fishCount: args.quantity,
        abw: args.abw,
        rules: rules.stockingRules,
        farmRules: rules.farmRules,
      })
      const batchNumber = await allocateBatchNumber(
        ctx,
        user,
        dest,
        args.transferDate,
      )
      destinationStockingId = await ctx.db.insert('stockingHistory', {
        cageId: args.destinationCageId,
        batchNumber,
        stockingDate: args.transferDate,
        fishCount: args.quantity,
        initialAbw: args.abw,
        initialBiomass: biomass,
        sourceLocation: source.location || undefined,
        sourceCage: source.name,
        transferSupervisor: args.transferSupervisor,
        notes: args.notes
          ? `Fish transfer from ${source.name}. ${args.notes}`
          : `Fish transfer from ${source.name}`,
        species: source.species || undefined,
        status,
        locationId: dest.locationId,
        companyId,
        createdBy: user._id,
        ...(status === 'approved'
          ? { approvedBy: user._id, approvedAt: now }
          : {}),
      })
    } else {
      const destStocking = await findApprovedStockingForCage(
        ctx,
        user,
        args.destinationCageId,
      )
      if (!destStocking) {
        throw new Error(
          'Destination cage is active but has no approved stocking to top up',
        )
      }
      assertTopupAllowed({
        cage: dest,
        addedFish: args.quantity,
        abw: args.abw,
        rules: rules.stockingRules,
        farmRules: rules.farmRules,
      })
      destinationTopupId = await ctx.db.insert('topupHistory', {
        stockingId: destStocking._id,
        topupDate: args.transferDate,
        fishCount: args.quantity,
        abw: args.abw,
        sourceLocation: source.location || source.name,
        transferSupervisor: args.transferSupervisor,
        notes: args.notes
          ? `Fish transfer from ${source.name}. ${args.notes}`
          : `Fish transfer from ${source.name}`,
        status,
        locationId: dest.locationId || destStocking.locationId,
        companyId,
        createdBy: user._id,
        ...(status === 'approved'
          ? { approvedBy: user._id, approvedAt: now }
          : {}),
      })
    }

    const transferId = await ctx.db.insert('fishTransfers', {
      sourceCageId: args.sourceCageId,
      destinationCageId: args.destinationCageId,
      sourceLocationId: source.locationId,
      destinationLocationId: dest.locationId,
      sourceStockingId: sourceStocking?._id,
      destinationStockingId,
      destinationTopupId,
      transferDate: args.transferDate,
      quantity: args.quantity,
      abw: args.abw,
      biomass,
      transferType,
      transferSupervisor: args.transferSupervisor,
      notes: args.notes,
      status,
      companyId,
      createdBy: user._id,
      ...(status === 'approved'
        ? { approvedBy: user._id, approvedAt: now }
        : {}),
      updatedAt: now,
    })

    if (status === 'approved') {
      const transfer = await ctx.db.get(transferId)
      await applyFishTransfer(ctx, transfer, { linkedJustCreated: true })
      if (transfer) await emitTransferApproved(ctx, transfer, user._id)
    }

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'fishTransfers',
      recordId: transferId,
      newValues: {
        ...args,
        transferType,
        biomass,
        status,
        destinationStockingId,
        destinationTopupId,
      },
    })

    return transferId
  },
})

export const approveFishTransfer = mutation({
  args: { id: v.id('fishTransfers') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')

    const transfer = await ctx.db.get(id)
    if (!transfer) throw new Error('Transfer not found')
    const allowed = await listForCompany(user, [transfer])
    if (!allowed.length) throw new Error('Access denied')
    if (transfer.status !== 'pending_approval') {
      throw new Error('Only pending transfers can be approved')
    }

    const now = Date.now()
    await ctx.db.patch(id, {
      status: 'approved',
      approvedBy: user._id,
      approvedAt: now,
      updatedAt: now,
    })

    const updated = await ctx.db.get(id)
    await applyFishTransfer(ctx, updated)

    await logAudit(ctx, {
      actionType: 'approve',
      tableName: 'fishTransfers',
      recordId: id,
      newValues: { status: 'approved' },
    })
    await emitTransferApproved(ctx, transfer, user._id)
  },
})

export const rejectFishTransfer = mutation({
  args: {
    id: v.id('fishTransfers'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { id, reason }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')

    const transfer = await ctx.db.get(id)
    if (!transfer) throw new Error('Transfer not found')
    const allowed = await listForCompany(user, [transfer])
    if (!allowed.length) throw new Error('Access denied')
    if (transfer.status !== 'pending_approval') {
      throw new Error('Only pending transfers can be rejected')
    }

    const now = Date.now()
    await ctx.db.patch(id, {
      status: 'rejected',
      notes: reason
        ? `${transfer.notes || ''}\nRejection reason: ${reason}`.trim()
        : transfer.notes,
      approvedBy: user._id,
      approvedAt: now,
      updatedAt: now,
    })

    if (transfer.destinationStockingId) {
      const stocking = await ctx.db.get(transfer.destinationStockingId)
      if (stocking?.status === 'pending_approval') {
        await ctx.db.patch(transfer.destinationStockingId, {
          status: 'rejected',
          approvedBy: user._id,
          approvedAt: now,
        })
      }
    }
    if (transfer.destinationTopupId) {
      const topup = await ctx.db.get(transfer.destinationTopupId)
      if (topup?.status === 'pending_approval') {
        await ctx.db.patch(transfer.destinationTopupId, {
          status: 'rejected',
          approvedBy: user._id,
          approvedAt: now,
        })
      }
    }

    await logAudit(ctx, {
      actionType: 'reject',
      tableName: 'fishTransfers',
      recordId: id,
      newValues: { status: 'rejected', reason },
    })
  },
})
