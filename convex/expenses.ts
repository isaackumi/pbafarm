import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertOwns, writeCompanyId, writeLocationId, logAudit } from './lib/tenancy'
import { tenantScope } from './lib/scope'
import { mergeSettings } from './lib/farmRules'
import { BUILT_IN_CATEGORY_KEYS, EXPENSE_CATEGORIES, categoryKey, splitExpenses } from './lib/costing'
import { requireMember } from './lib/permissions'
import { validateCustom } from './lib/customFields'
import { customValues } from './schema'

/**
 * Expenses (INV-007). Anyone in the company records an expense (field quick
 * add); editing and deleting are admin only, like feed purchases and sales.
 * Deletes are soft so the audit trail and totals stay explainable.
 */

/** Most rows one list call returns; narrow the dates to see more. */
const LIST_LIMIT = 2000

async function assertCategory(ctx: MutationCtx, companyId: Id<'companies'>, category: string) {
  if (BUILT_IN_CATEGORY_KEYS.has(category)) return
  const custom = await ctx.db
    .query('expenseCategories')
    .withIndex('by_company_and_key', (q) => q.eq('companyId', companyId).eq('key', category))
    .unique()
  if (!custom || !custom.active) throw new Error('Unknown expense category')
}

/** Validate the cost centre and fill the site from the cage when not given. */
async function costCentre(
  ctx: MutationCtx,
  user: Doc<'users'>,
  args: {
    locationId?: Id<'farmLocations'>
    cageId?: Id<'cages'>
    stockingId?: Id<'stockingHistory'>
    supplierId?: Id<'feedSuppliers'>
  },
) {
  let locationId = args.locationId
  if (args.cageId) {
    const cage = await ctx.db.get(args.cageId)
    assertOwns(user, cage, 'Cage')
    if (locationId && cage.locationId && cage.locationId !== locationId) {
      throw new Error('The cage is not at that site')
    }
    locationId = locationId ?? cage.locationId
  }
  if (args.stockingId) {
    const stocking = await ctx.db.get(args.stockingId)
    assertOwns(user, stocking, 'Stocking')
    if (!args.cageId || stocking.cageId !== args.cageId) {
      throw new Error('The production cycle belongs to another cage')
    }
  }
  if (args.supplierId) {
    assertOwns(user, await ctx.db.get(args.supplierId), 'Supplier')
  }
  if (locationId) locationId = await writeLocationId(ctx, user, locationId)
  return locationId
}

function validateAmount(amount: number) {
  if (!Number.isFinite(amount) || !(amount > 0)) {
    throw new Error('Amount must be greater than zero')
  }
}

function validateDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be YYYY-MM-DD')
}

export const listCategories = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
    const scope = tenantScope(user)
    const custom =
      scope.kind === 'company'
        ? await ctx.db
            .query('expenseCategories')
            .withIndex('by_company_and_key', (q) => q.eq('companyId', scope.companyId))
            .collect()
        : []
    return [
      ...EXPENSE_CATEGORIES.map((c) => ({ key: c.key, label: c.label, builtIn: true, active: true, id: null })),
      ...custom
        .filter((c) => args.includeInactive || c.active)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((c) => ({ key: c.key, label: c.label, builtIn: false, active: c.active, id: c._id })),
    ]
  },
})

export const createCategory = mutation({
  args: { label: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.expenses.manage' })
    const companyId = await writeCompanyId(user)
    const label = args.label.trim()
    const key = categoryKey(label)
    if (!key) throw new Error('Category name is required')
    if (BUILT_IN_CATEGORY_KEYS.has(key)) throw new Error('That category already exists')
    const existing = await ctx.db
      .query('expenseCategories')
      .withIndex('by_company_and_key', (q) => q.eq('companyId', companyId).eq('key', key))
      .unique()
    if (existing) {
      if (existing.active) throw new Error('That category already exists')
      await ctx.db.patch(existing._id, { active: true, label, updatedAt: Date.now() })
      return existing._id
    }
    const id = await ctx.db.insert('expenseCategories', {
      companyId,
      key,
      label,
      active: true,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, { actionType: 'create', tableName: 'expenseCategories', recordId: id, newValues: { key, label } })
    return id
  },
})

/** Rename or retire a custom category. Expenses keep their category key. */
export const updateCategory = mutation({
  args: {
    id: v.id('expenseCategories'),
    label: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.expenses.manage' })
    const existing = await ctx.db.get(args.id)
    assertOwns(user, existing, 'Category')
    const patch: Partial<Doc<'expenseCategories'>> = { updatedAt: Date.now() }
    if (args.label !== undefined) {
      if (!args.label.trim()) throw new Error('Category name is required')
      patch.label = args.label.trim()
    }
    if (args.active !== undefined) patch.active = args.active
    await ctx.db.patch(args.id, patch)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'expenseCategories',
      recordId: args.id,
      previousValues: existing,
      newValues: patch,
    })
    return args.id
  },
})

/**
 * The company's expenses in a date range, newest first, with names resolved
 * and totals. Filters: site, cage, category.
 */
export const list = query({
  args: {
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    cageId: v.optional(v.id('cages')),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
    const scope = tenantScope(user)
    const empty = { rows: [], total: 0, by_category: {}, truncated: false }
    if (scope.kind !== 'company') return empty

    let rows: Doc<'expenses'>[]
    if (args.cageId) {
      rows = await ctx.db
        .query('expenses')
        .withIndex('by_company_and_cage', (q) =>
          q.eq('companyId', scope.companyId).eq('cageId', args.cageId),
        )
        .collect()
      if (args.dateFrom) rows = rows.filter((e) => e.date >= args.dateFrom!)
      if (args.dateTo) rows = rows.filter((e) => e.date <= args.dateTo!)
      rows.sort((a, b) => b.date.localeCompare(a.date))
    } else {
      rows = await ctx.db
        .query('expenses')
        .withIndex('by_company_and_date', (q) => {
          const c = q.eq('companyId', scope.companyId)
          if (args.dateFrom && args.dateTo) return c.gte('date', args.dateFrom).lte('date', args.dateTo)
          if (args.dateFrom) return c.gte('date', args.dateFrom)
          if (args.dateTo) return c.lte('date', args.dateTo)
          return c
        })
        .order('desc')
        .take(LIST_LIMIT + 1)
    }
    const truncated = rows.length > LIST_LIMIT
    rows = rows.slice(0, LIST_LIMIT).filter((e) => !e.deletedAt)
    if (args.locationId) rows = rows.filter((e) => e.locationId === args.locationId)
    if (args.category) rows = rows.filter((e) => e.category === args.category)

    const names = new Map<string, string>()
    const nameOf = async (id: Id<'cages'> | Id<'farmLocations'> | Id<'feedSuppliers'> | undefined) => {
      if (!id) return null
      const key = String(id)
      if (!names.has(key)) {
        const doc = (await ctx.db.get(id)) as { name?: string } | null
        names.set(key, doc?.name ?? '')
      }
      return names.get(key) || null
    }

    const out = []
    for (const e of rows) {
      out.push({
        id: e._id,
        date: e.date,
        category: e.category,
        amount: e.amount,
        currency: e.currency,
        notes: e.notes ?? '',
        custom: e.custom ?? {},
        location_id: e.locationId ?? null,
        location_name: await nameOf(e.locationId),
        cage_id: e.cageId ?? null,
        cage_name: await nameOf(e.cageId),
        stocking_id: e.stockingId ?? null,
        supplier_id: e.supplierId ?? null,
        supplier_name: await nameOf(e.supplierId),
        created_at: e._creationTime,
      })
    }
    const split = splitExpenses(rows)
    return { rows: out, total: split.total, by_category: split.byCategory, truncated }
  },
})

const expenseFields = {
  category: v.string(),
  amount: v.number(),
  date: v.string(),
  locationId: v.optional(v.id('farmLocations')),
  cageId: v.optional(v.id('cages')),
  stockingId: v.optional(v.id('stockingHistory')),
  supplierId: v.optional(v.id('feedSuppliers')),
  notes: v.optional(v.string()),
  custom: v.optional(customValues),
}

export const create = mutation({
  args: expenseFields,
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.expenses.record' })
    const companyId = await writeCompanyId(user)
    validateAmount(args.amount)
    validateDate(args.date)
    await assertCategory(ctx, companyId, args.category)
    const locationId = await costCentre(ctx, user, args)
    const company = await ctx.db.get(companyId)
    const currency = mergeSettings(company?.settings).locale.currency
    const custom = await validateCustom(ctx, {
      companyId,
      entity: 'expenses',
      custom: args.custom,
      mode: 'create',
      context: { locationId, core: args },
    })

    const id = await ctx.db.insert('expenses', {
      custom,
      companyId,
      locationId,
      cageId: args.cageId,
      stockingId: args.stockingId,
      category: args.category,
      amount: args.amount,
      currency,
      date: args.date,
      supplierId: args.supplierId,
      notes: args.notes?.trim() || undefined,
      createdBy: user._id,
      updatedAt: Date.now(),
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'expenses',
      recordId: id,
      newValues: { ...args, currency },
      locationId,
    })
    return id
  },
})

export const update = mutation({
  args: {
    id: v.id('expenses'),
    category: v.optional(v.string()),
    amount: v.optional(v.number()),
    date: v.optional(v.string()),
    /** null clears the field. */
    locationId: v.optional(v.union(v.id('farmLocations'), v.null())),
    cageId: v.optional(v.union(v.id('cages'), v.null())),
    stockingId: v.optional(v.union(v.id('stockingHistory'), v.null())),
    supplierId: v.optional(v.union(v.id('feedSuppliers'), v.null())),
    notes: v.optional(v.string()),
    custom: v.optional(customValues),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.expenses.manage' })
    const existing = await ctx.db.get(args.id)
    assertOwns(user, existing, 'Expense')
    if (existing.deletedAt) throw new Error('Expense not found')

    const pick = <K extends 'locationId' | 'cageId' | 'stockingId' | 'supplierId'>(k: K) =>
      args[k] === undefined ? existing[k] : (args[k] ?? undefined)
    const next = {
      category: args.category ?? existing.category,
      amount: args.amount ?? existing.amount,
      date: args.date ?? existing.date,
      locationId: pick('locationId') as Id<'farmLocations'> | undefined,
      cageId: pick('cageId') as Id<'cages'> | undefined,
      stockingId: pick('stockingId') as Id<'stockingHistory'> | undefined,
      supplierId: pick('supplierId') as Id<'feedSuppliers'> | undefined,
      notes: args.notes === undefined ? existing.notes : args.notes.trim() || undefined,
    }
    validateAmount(next.amount)
    validateDate(next.date)
    if (next.category !== existing.category) {
      await assertCategory(ctx, existing.companyId, next.category)
    }
    // A new cage without a new site takes the cage's site.
    if (args.cageId && args.locationId === undefined) next.locationId = undefined
    next.locationId = await costCentre(ctx, user, next)
    const custom = await validateCustom(ctx, {
      companyId: existing.companyId,
      entity: 'expenses',
      custom: args.custom,
      previous: existing.custom,
      mode: 'update',
      context: { locationId: next.locationId, core: next },
    })

    await ctx.db.patch(args.id, { ...next, ...(custom !== undefined ? { custom } : {}), updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'expenses',
      recordId: args.id,
      previousValues: existing,
      newValues: next,
      locationId: next.locationId,
    })
    return args.id
  },
})

export const remove = mutation({
  args: { id: v.id('expenses') },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.expenses.manage' })
    const existing = await ctx.db.get(args.id)
    assertOwns(user, existing, 'Expense')
    if (existing.deletedAt) return null
    await ctx.db.patch(args.id, { deletedAt: Date.now(), updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'expenses',
      recordId: args.id,
      previousValues: existing,
      locationId: existing.locationId,
    })
    return null
  },
})
