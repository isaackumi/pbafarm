import { v } from 'convex/values'
import { query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { AUTH_ERROR_MESSAGES } from './lib/authErrors'
import { userError } from './lib/errors'
import { mergeSettings } from './lib/farmRules'
import { EXPENSE_CATEGORIES } from './lib/costing'
import { requireMember, requirePermission } from './lib/permissions'
import { inSiteScope, scopedRowsInRange } from './lib/scope'
import type { SourceRow } from './lib/accountingExport'

/**
 * Accounting export (INT-008): the rows behind the journal CSV. The page
 * turns them into a generic journal, QuickBooks or Xero CSV with
 * convex/lib/accountingExport.ts. Needs finance.view and reports.export;
 * company and site scoped. Live sync with an accounting system is a
 * follow-up (doc 09 §11).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_SPAN_DAYS = 366
/** Per source; past it the export is cut and `truncated` is set. */
export const MAX_ROWS_PER_SOURCE = 2000
/** Feed purchases have no date index: rows scanned before the date filter. */
const MAX_PURCHASES_SCANNED = 4000

const CATEGORY_LABELS = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [c.key, c.label]))
const humanize = (key: string) => {
  const s = key.replace(/_/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : key
}

function daysBetween(from: string, to: string) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
}

function makeLookup<T extends 'feedSuppliers' | 'customers' | 'feedTypes' | 'farmLocations' | 'invoices' | 'sales'>(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
) {
  const cache = new Map<string, Doc<T> | null>()
  return async (id: Id<T> | undefined | null): Promise<Doc<T> | null> => {
    if (!id) return null
    if (!cache.has(id)) {
      const row = (await ctx.db.get(id)) as Doc<T> | null
      // Never name another company's record.
      cache.set(id, row && (row as { companyId?: Id<'companies'> }).companyId === companyId ? row : null)
    }
    return cache.get(id) ?? null
  }
}

export const entries = query({
  args: {
    from: v.string(),
    to: v.string(),
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'finance.view', locationId: args.locationId })
    requirePermission(m, 'reports.export')
    const user = m.user
    const companyId = user.companyId
    if (!companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
    if (!DATE_RE.test(args.from) || !DATE_RE.test(args.to)) throw userError('VALIDATION', 'Dates must be YYYY-MM-DD')
    const span = daysBetween(args.from, args.to)
    if (!(span >= 0)) throw userError('VALIDATION', 'The start date must be on or before the end date')
    if (span > MAX_SPAN_DAYS) throw userError('VALIDATION', `Export at most ${MAX_SPAN_DAYS} days at a time`)

    const company = await ctx.db.get(companyId)
    const currency = mergeSettings(company?.settings).locale.currency
    const site = makeLookup<'farmLocations'>(ctx, companyId)
    const supplier = makeLookup<'feedSuppliers'>(ctx, companyId)
    const customer = makeLookup<'customers'>(ctx, companyId)
    const feedType = makeLookup<'feedTypes'>(ctx, companyId)
    const invoice = makeLookup<'invoices'>(ctx, companyId)
    const saleById = makeLookup<'sales'>(ctx, companyId)
    const siteName = async (id?: Id<'farmLocations'>) => (await site(id))?.name
    const atSite = <T extends { locationId?: Id<'farmLocations'> }>(rows: T[]) =>
      inSiteScope(user, args.locationId ? rows.filter((r) => r.locationId === args.locationId) : rows)
    const truncated: string[] = []
    const out: SourceRow[] = []

    // Sales (invoice number as the reference).
    const sales = await scopedRowsInRange(ctx, user, 'sales', {
      from: args.from,
      to: args.to,
      locationId: args.locationId,
      limit: MAX_ROWS_PER_SOURCE + 1,
      order: 'asc',
    })
    if (sales.length > MAX_ROWS_PER_SOURCE) truncated.push('sales')
    for (const s of sales.slice(0, MAX_ROWS_PER_SOURCE)) {
      const inv = await invoice(s.invoiceId)
      out.push({
        kind: 'sale',
        id: s._id,
        date: s.saleDate,
        amount: s.totalAmount,
        customer: s.customerName || (await customer(s.customerId))?.name,
        invoiceNumber: inv && !inv.voidedAt ? inv.number : undefined,
        weightKg: s.weightKg,
        site: await siteName(s.locationId),
      })
    }

    // Payments (voided ones left out).
    const payments = await ctx.db
      .query('salePayments')
      .withIndex('by_company_and_paidDate', (q) => q.eq('companyId', companyId).gte('paidDate', args.from).lte('paidDate', args.to))
      .take(MAX_ROWS_PER_SOURCE + 1)
    if (payments.length > MAX_ROWS_PER_SOURCE) truncated.push('payments')
    for (const p of atSite(payments.slice(0, MAX_ROWS_PER_SOURCE))) {
      if (p.voidedAt) continue
      const sale = await saleById(p.saleId)
      const inv = sale ? await invoice(sale.invoiceId) : null
      out.push({
        kind: 'payment',
        id: p._id,
        date: p.paidDate,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        customer: sale?.customerName || (await customer(sale?.customerId))?.name,
        invoiceNumber: inv && !inv.voidedAt ? inv.number : undefined,
        site: await siteName(p.locationId ?? sale?.locationId),
      })
    }

    // Feed purchases (also the ones received on purchase orders).
    const purchasesQ = args.locationId
      ? ctx.db
          .query('feedPurchases')
          .withIndex('by_company_location', (q) => q.eq('companyId', companyId).eq('locationId', args.locationId))
      : ctx.db.query('feedPurchases').withIndex('by_company', (q) => q.eq('companyId', companyId))
    const scanned = await purchasesQ.order('desc').take(MAX_PURCHASES_SCANNED)
    if (scanned.length >= MAX_PURCHASES_SCANNED) truncated.push('purchases')
    const purchases = atSite(
      scanned.filter((p) => !p.deletedAt && p.purchaseDate >= args.from && p.purchaseDate <= args.to),
    ).slice(0, MAX_ROWS_PER_SOURCE)
    for (const p of purchases) {
      out.push({
        kind: 'purchase',
        id: p._id,
        date: p.purchaseDate,
        amount: p.quantity * p.pricePerKg,
        supplier: (await supplier(p.supplierId))?.name,
        item: (await feedType(p.feedTypeId))?.name,
        quantityKg: p.quantity,
        site: await siteName(p.locationId),
      })
    }

    // Expenses.
    const expenses = await ctx.db
      .query('expenses')
      .withIndex('by_company_and_date', (q) => q.eq('companyId', companyId).gte('date', args.from).lte('date', args.to))
      .take(MAX_ROWS_PER_SOURCE + 1)
    if (expenses.length > MAX_ROWS_PER_SOURCE) truncated.push('expenses')
    for (const e of atSite(expenses.slice(0, MAX_ROWS_PER_SOURCE))) {
      if (e.deletedAt) continue
      out.push({
        kind: 'expense',
        id: e._id,
        date: e.date,
        amount: e.amount,
        category: e.category,
        categoryLabel: CATEGORY_LABELS.get(e.category) ?? humanize(e.category),
        supplier: (await supplier(e.supplierId))?.name,
        notes: e.notes,
        site: await siteName(e.locationId),
      })
    }

    return { currency, from: args.from, to: args.to, rows: out, truncated }
  },
})
