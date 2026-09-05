import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import { listForCompany, writeCompanyId, logAudit } from './lib/tenancy'
import {
  mergeSettings,
  assertStockingAllowed,
  assertTopupAllowed,
} from './lib/farmRules'
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

function cageBatchSlug(cage: { code?: string; name?: string }) {
  const raw = (cage.code || cage.name || 'CAGE')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 10)
  return raw || 'CAGE'
}

async function allocateBatchNumber(
  ctx: any,
  user: any,
  cage: { code?: string; name?: string },
  stockingDate: string,
) {
  const datePart = (stockingDate || new Date().toISOString().slice(0, 10)).replace(
    /-/g,
    '',
  )
  const base = `${cageBatchSlug(cage)}-${datePart}`
  let rows = await ctx.db.query('stockingHistory').collect()
  rows = await listForCompany(user, rows)
  const existing = new Set(rows.map((r: any) => r.batchNumber))
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
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

async function applyFishTransfer(ctx: any, transfer: any) {
  const source = await ctx.db.get(transfer.sourceCageId)
  if (!source) throw new Error('Source cage not found')
  const sourceCount = source.currentCount || 0
  if (sourceCount < transfer.quantity) {
    throw new Error('Insufficient fish on source cage')
  }

  const now = Date.now()
  const sourcePatch = sourceCagePatchAfterTransfer({
    transferType: transfer.transferType,
    quantity: transfer.quantity,
    sourceCurrentCount: sourceCount,
    now,
  })
  await ctx.db.patch(transfer.sourceCageId, sourcePatch)

  if (transfer.destinationStockingId) {
    const stocking = await ctx.db.get(transfer.destinationStockingId)
    if (!stocking) throw new Error('Linked destination stocking not found')
    if (stocking.status === 'pending_approval') {
      await ctx.db.patch(transfer.destinationStockingId, {
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
      status: 'active',
      species: stocking.species,
      updatedAt: now,
    })
  }

  if (transfer.destinationTopupId) {
    const topup = await ctx.db.get(transfer.destinationTopupId)
    if (!topup) throw new Error('Linked destination top-up not found')
    if (topup.status === 'pending_approval') {
      await ctx.db.patch(transfer.destinationTopupId, {
        status: 'approved',
        approvedBy: transfer.approvedBy,
        approvedAt: now,
      })
    }
    const stocking = await ctx.db.get(topup.stockingId)
    if (!stocking) throw new Error('Associated stocking record not found')
    const destCage = await ctx.db.get(stocking.cageId)
    if (destCage) {
      await ctx.db.patch(stocking.cageId, {
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
    let rows = await ctx.db.query('fishTransfers').collect()
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

    return Promise.all(
      rows.map(async (r) => {
        const [src, dest] = await Promise.all([
          ctx.db.get(r.sourceCageId),
          ctx.db.get(r.destinationCageId),
        ])
        return {
          id: r._id,
          ...r,
          sourceCageName: src?.name,
          destinationCageName: dest?.name,
        }
      }),
    )
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
      await applyFishTransfer(ctx, transfer)
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
