import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { asOfDate, scopedRowsInRange, tenantScope, PLATFORM_SCAN_LIMIT } from './lib/scope'
import {
  listForCompany,
  listForCompanyAndLocation,
  writeCompanyId,
  logAudit,
} from './lib/tenancy'
import { requireMember } from './lib/permissions'

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function toClient(t: any, cageName?: string | null) {
  return {
    id: t._id,
    _id: t._id,
    cage_id: t.cageId,
    cage_name: cageName || null,
    date: t.date,
    diagnosis: t.diagnosis,
    treatment: t.treatment,
    product_name: t.productName,
    dosage: t.dosage,
    fish_affected: t.fishAffected,
    withdrawal_days: t.withdrawalDays,
    withdrawal_until: t.withdrawalUntil,
    administered_by: t.administeredBy,
    notes: t.notes,
    location_id: t.locationId,
    company_id: t.companyId,
    created_by: t.createdBy,
    updated_at: t.updatedAt,
    created_at: t._creationTime,
  }
}

export const list = query({
  args: {
    cageId: v.optional(v.id('cages')),
    locationId: v.optional(v.id('farmLocations')),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    let rows = args.cageId
      ? await ctx.db
          .query('healthTreatments')
          .withIndex('by_cage', (q) => q.eq('cageId', args.cageId!))
          .collect()
      : await scopedRowsInRange(ctx, user, 'healthTreatments', {
          from: args.dateFrom,
          to: args.dateTo,
          locationId: args.locationId,
        })

    rows = await listForCompanyAndLocation(user, rows, args.locationId)
    if (args.dateFrom) rows = rows.filter((r) => r.date >= args.dateFrom!)
    if (args.dateTo) rows = rows.filter((r) => r.date <= args.dateTo!)

    const out = []
    for (const row of rows) {
      const cage = await ctx.db.get(row.cageId)
      out.push(toClient(row, cage?.name))
    }
    return out.sort((a, b) => b.date.localeCompare(a.date))
  },
})

export const create = mutation({
  args: {
    cageId: v.id('cages'),
    date: v.string(),
    diagnosis: v.optional(v.string()),
    treatment: v.string(),
    productName: v.optional(v.string()),
    dosage: v.optional(v.string()),
    fishAffected: v.optional(v.number()),
    withdrawalDays: v.optional(v.number()),
    administeredBy: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.health.record' })
    const cage = await ctx.db.get(args.cageId)
    if (!cage) throw new Error('Cage not found')
    const allowed = await listForCompany(user, [cage])
    if (!allowed.length) throw new Error('Access denied')

    const treatment = args.treatment.trim()
    if (!treatment) throw new Error('Treatment is required')

    const withdrawalDays =
      args.withdrawalDays != null && args.withdrawalDays > 0
        ? args.withdrawalDays
        : undefined
    const withdrawalUntil = withdrawalDays
      ? addDays(args.date, withdrawalDays)
      : undefined

    const id = await ctx.db.insert('healthTreatments', {
      cageId: args.cageId,
      date: args.date,
      diagnosis: args.diagnosis?.trim() || undefined,
      treatment,
      productName: args.productName?.trim() || undefined,
      dosage: args.dosage?.trim() || undefined,
      fishAffected: args.fishAffected,
      withdrawalDays,
      withdrawalUntil,
      administeredBy: args.administeredBy?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      locationId: cage.locationId,
      companyId: (await writeCompanyId(user)) ?? cage.companyId,
      createdBy: user._id,
      updatedAt: Date.now(),
    })

    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'healthTreatments',
      recordId: id,
      newValues: args,
      locationId: cage.locationId,
    })
    return id
  },
})

export const remove = mutation({
  args: { id: v.id('healthTreatments') },
  handler: async (ctx, { id }) => {
    const { user } = await requireMember(ctx, { permission: 'production.records.delete' })
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Record not found')
    const allowed = await listForCompany(user, [existing])
    if (!allowed.length) throw new Error('Access denied')
    await ctx.db.delete(id)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'healthTreatments',
      recordId: id,
      previousValues: existing,
      locationId: existing.locationId,
    })
  },
})

/** Active withdrawal windows for cages at a location. */
export const activeWithdrawals = query({
  args: {
    locationId: v.optional(v.id('farmLocations')),
    asOf: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    const asOf = asOfDate(args.asOf)
    // Only treatments whose withdrawal ends on or after asOf, read through
    // by_company_and_withdrawalUntil (not the full treatment history).
    const scope = tenantScope(user)
    let rows =
      scope.kind === 'company'
        ? await ctx.db
            .query('healthTreatments')
            .withIndex('by_company_and_withdrawalUntil', (q) =>
              q.eq('companyId', scope.companyId).gte('withdrawalUntil', asOf),
            )
            .collect()
        : scope.kind === 'platform'
          ? await ctx.db.query('healthTreatments').take(PLATFORM_SCAN_LIMIT)
          : []
    rows = await listForCompanyAndLocation(user, rows, args.locationId)
    rows = rows.filter(
      (r) => r.withdrawalUntil && r.withdrawalUntil >= asOf,
    )


    const out = []
    for (const row of rows) {
      const cage = await ctx.db.get(row.cageId)
      out.push(toClient(row, cage?.name))
    }
    return out.sort((a, b) =>
      (a.withdrawal_until || '').localeCompare(b.withdrawal_until || ''),
    )
  },
})
