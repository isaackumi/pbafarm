import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { scopedRows } from './lib/scope'
import { assertOwns, listForCompany, logAudit } from './lib/tenancy'
import { requireMember } from './lib/permissions'
import { userError } from './lib/errors'

/**
 * Sale payments, invoices and receivables (INV-009, d08 §10).
 *
 * A payment is money received against one sale; `sales.amountPaid` keeps
 * their Σ and the payment status follows it (nothing paid → pending, part →
 * partial, all → paid). A sale without recorded payments keeps its manual
 * status flag. An invoice is a numbered document for one sale; a void
 * invoice keeps its number and the sale can be invoiced again.
 */

export const PAYMENT_METHODS = ['cash', 'mobile_money', 'bank', 'cheque', 'other'] as const
const paymentMethod = v.union(...PAYMENT_METHODS.map((m) => v.literal(m)))

const CENT = 0.005
const round2 = (n: number) => Math.round(n * 100) / 100
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function checkDate(value: string, label: string) {
  if (!DATE_RE.test(value)) throw userError('VALIDATION', `${label} must be a date (YYYY-MM-DD)`)
}

export type PaymentStatus = 'pending' | 'partial' | 'paid'

/** Status implied by the amount received against the total. */
export function statusFor(amountPaid: number, totalAmount: number): PaymentStatus {
  if (amountPaid <= CENT) return 'pending'
  return amountPaid + CENT >= totalAmount ? 'paid' : 'partial'
}

/**
 * What has been received on a sale: recorded payments when there are any,
 * otherwise the manual flag (a sale flagged paid counts as fully paid).
 */
export function amountPaidOf(sale: Doc<'sales'>) {
  if (sale.amountPaid !== undefined) return sale.amountPaid
  return sale.paymentStatus === 'paid' ? sale.totalAmount : 0
}

async function livePayments(ctx: QueryCtx | MutationCtx, saleId: Id<'sales'>) {
  const rows = await ctx.db
    .query('salePayments')
    .withIndex('by_sale', (q) => q.eq('saleId', saleId))
    .collect()
  return rows.filter((p) => !p.voidedAt)
}

/** Re-total the sale's live payments and set its status from them. */
async function syncPayments(ctx: MutationCtx, sale: Doc<'sales'>) {
  const paid = round2((await livePayments(ctx, sale._id)).reduce((s, p) => s + p.amount, 0))
  const paymentStatus = statusFor(paid, sale.totalAmount)
  await ctx.db.patch(sale._id, { amountPaid: paid, paymentStatus, updatedAt: Date.now() })
  return { amountPaid: paid, paymentStatus }
}

async function loadSale(ctx: QueryCtx | MutationCtx, user: Doc<'users'>, id: Id<'sales'>) {
  const sale = await ctx.db.get(id)
  assertOwns(user, sale, 'Sale')
  return sale
}

function toClientPayment(p: Doc<'salePayments'>) {
  return {
    id: p._id,
    _id: p._id,
    sale_id: p.saleId,
    amount: p.amount,
    paid_date: p.paidDate,
    method: p.method,
    reference: p.reference ?? null,
    notes: p.notes ?? null,
    voided: Boolean(p.voidedAt),
    void_reason: p.voidReason ?? null,
    created_by: p.createdBy ?? null,
    created_at: p._creationTime,
  }
}

function toClientInvoice(i: Doc<'invoices'>) {
  return {
    id: i._id,
    _id: i._id,
    sale_id: i.saleId,
    number: i.number,
    issue_date: i.issueDate,
    due_date: i.dueDate ?? null,
    customer_id: i.customerId ?? null,
    customer_name: i.customerName,
    amount: i.amount,
    notes: i.notes ?? null,
    voided: Boolean(i.voidedAt),
    created_at: i._creationTime,
  }
}

async function insertPayment(
  ctx: MutationCtx,
  user: Doc<'users'>,
  sale: Doc<'sales'>,
  args: {
    amount: number
    paidDate: string
    method: (typeof PAYMENT_METHODS)[number]
    reference?: string
    notes?: string
  },
) {
  checkDate(args.paidDate, 'Payment date')
  if (!Number.isFinite(args.amount) || !(args.amount > 0)) {
    throw userError('VALIDATION', 'Payment amount must be greater than zero')
  }
  const amount = round2(args.amount)
  const received = round2((await livePayments(ctx, sale._id)).reduce((s, p) => s + p.amount, 0))
  const balance = round2(sale.totalAmount - received)
  if (amount > balance + CENT) {
    throw userError(
      'VALIDATION',
      `Payment is more than the balance due (${balance} of ${sale.totalAmount})`,
      { balance, total: sale.totalAmount },
    )
  }
  const id = await ctx.db.insert('salePayments', {
    companyId: sale.companyId ?? user.companyId!,
    saleId: sale._id,
    locationId: sale.locationId,
    amount,
    paidDate: args.paidDate,
    method: args.method,
    reference: args.reference?.trim() || undefined,
    notes: args.notes?.trim() || undefined,
    createdBy: user._id,
  })
  const next = await syncPayments(ctx, sale)
  await logAudit(ctx, {
    actionType: 'create',
    tableName: 'salePayments',
    recordId: id,
    newValues: { saleId: sale._id, amount, paidDate: args.paidDate, method: args.method, ...next },
    locationId: sale.locationId,
  })
  return id
}

const salePaymentRow = v.object({
  id: v.id('salePayments'),
  _id: v.id('salePayments'),
  sale_id: v.id('sales'),
  amount: v.number(),
  paid_date: v.string(),
  method: v.union(
    v.literal('other'),
    v.literal('cash'),
    v.literal('mobile_money'),
    v.literal('bank'),
    v.literal('cheque'),
  ),
  reference: v.union(v.string(), v.null()),
  notes: v.union(v.string(), v.null()),
  voided: v.boolean(),
  void_reason: v.union(v.string(), v.null()),
  created_by: v.union(v.id('users'), v.null()),
  created_at: v.number(),
})

export const listPayments = query({
  args: { saleId: v.id('sales') },
  returns: v.array(salePaymentRow),
  handler: async (ctx, { saleId }) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
    await loadSale(ctx, user, saleId)
    const rows = await ctx.db
      .query('salePayments')
      .withIndex('by_sale', (q) => q.eq('saleId', saleId))
      .collect()
    return rows.map(toClientPayment).sort((a, b) => a.paid_date.localeCompare(b.paid_date))
  },
})

/** Record money received against a sale. Never more than the balance due. */
export const recordPayment = mutation({
  args: {
    saleId: v.id('sales'),
    amount: v.number(),
    paidDate: v.string(),
    method: paymentMethod,
    reference: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.id('salePayments'),
  handler: async (ctx, { saleId, ...args }) => {
    // Payment status is a financial edit (doc 07 V9).
    const { user } = await requireMember(ctx, { permission: 'finance.sales.correct' })
    const sale = await loadSale(ctx, user, saleId)
    return await insertPayment(ctx, user, sale, args)
  },
})

/** Mark a sale paid: records one payment for whatever is still due. */
export const markSalePaid = mutation({
  args: {
    saleId: v.id('sales'),
    paidDate: v.string(),
    method: paymentMethod,
    reference: v.optional(v.string()),
  },
  returns: v.union(v.id('salePayments'), v.null()),
  handler: async (ctx, { saleId, ...args }) => {
    const { user } = await requireMember(ctx, { permission: 'finance.sales.correct' })
    const sale = await loadSale(ctx, user, saleId)
    const received = (await livePayments(ctx, sale._id)).reduce((s, p) => s + p.amount, 0)
    const balance = round2(sale.totalAmount - received)
    if (!(balance > CENT)) {
      // Nothing due: settle the status (e.g. a zero-value sale) without a payment.
      await syncPayments(ctx, sale)
      return null
    }
    return await insertPayment(ctx, user, sale, { ...args, amount: balance })
  },
})

/** Void a payment (kept for the audit trail); the sale's balance reopens. */
export const removePayment = mutation({
  args: { paymentId: v.id('salePayments'), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { paymentId, reason }) => {
    const { user } = await requireMember(ctx, { permission: 'finance.sales.correct' })
    if (!reason.trim()) throw userError('VALIDATION', 'A reason is required')
    const payment = await ctx.db.get(paymentId)
    assertOwns(user, payment, 'Payment')
    if (payment.voidedAt) throw userError('CONFLICT', 'This payment was already removed')
    const sale = await loadSale(ctx, user, payment.saleId)
    await ctx.db.patch(paymentId, { voidedAt: Date.now(), voidReason: reason.trim() })
    const next = await syncPayments(ctx, sale)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'salePayments',
      recordId: paymentId,
      previousValues: payment,
      newValues: { reason: reason.trim(), ...next },
      locationId: sale.locationId,
    })
  },
})

/** Issue a numbered invoice for a sale (INV-0001, INV-0002… per company). */
export const issueInvoice = mutation({
  args: {
    saleId: v.id('sales'),
    issueDate: v.string(),
    dueDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.id('invoices'),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.sales.record' })
    const sale = await loadSale(ctx, user, args.saleId)
    checkDate(args.issueDate, 'Invoice date')
    if (args.dueDate) {
      checkDate(args.dueDate, 'Due date')
      if (args.dueDate < args.issueDate) throw userError('VALIDATION', 'The due date is before the invoice date')
    }
    if (sale.invoiceId) {
      const current = await ctx.db.get(sale.invoiceId)
      if (current && !current.voidedAt) {
        throw userError('CONFLICT', `This sale already has invoice ${current.number}`)
      }
    }
    const companyId = sale.companyId ?? user.companyId!
    // Sequential per company; concurrent issues conflict and retry.
    const latest = await ctx.db
      .query('invoices')
      .withIndex('by_company_and_seq', (q) => q.eq('companyId', companyId))
      .order('desc')
      .first()
    const seq = (latest?.seq ?? 0) + 1
    const number = `INV-${String(seq).padStart(4, '0')}`
    const id = await ctx.db.insert('invoices', {
      companyId,
      saleId: sale._id,
      seq,
      number,
      issueDate: args.issueDate,
      dueDate: args.dueDate || undefined,
      customerId: sale.customerId,
      customerName: sale.customerName || '—',
      amount: sale.totalAmount,
      notes: args.notes?.trim() || undefined,
      locationId: sale.locationId,
      createdBy: user._id,
      updatedAt: Date.now(),
    })
    await ctx.db.patch(sale._id, { invoiceId: id, updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'invoices',
      recordId: id,
      newValues: { ...args, number, amount: sale.totalAmount },
      locationId: sale.locationId,
    })
    return id
  },
})

export const voidInvoice = mutation({
  args: { invoiceId: v.id('invoices') },
  returns: v.null(),
  handler: async (ctx, { invoiceId }) => {
    const { user } = await requireMember(ctx, { permission: 'finance.sales.correct' })
    const invoice = await ctx.db.get(invoiceId)
    assertOwns(user, invoice, 'Invoice')
    if (invoice.voidedAt) throw userError('CONFLICT', 'This invoice is already void')
    await ctx.db.patch(invoiceId, { voidedAt: Date.now(), updatedAt: Date.now() })
    const sale = await ctx.db.get(invoice.saleId)
    if (sale?.invoiceId === invoiceId) await ctx.db.patch(sale._id, { invoiceId: undefined, updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'invoices',
      recordId: invoiceId,
      previousValues: invoice,
      locationId: invoice.locationId,
    })
  },
})

/** Everything the printable invoice shows. */
export const getInvoice = query({
  args: { invoiceId: v.id('invoices') },
  returns: v.union(
    v.object({
      company: v.union(
        v.object({
          name: v.string(),
          address: v.union(v.string(), v.null()),
          phone: v.union(v.string(), v.null()),
          email: v.union(v.string(), v.null()),
        }),
        v.null(),
      ),
      customer: v.union(
        v.object({
          name: v.string(),
          contact_name: v.union(v.string(), v.null()),
          phone: v.union(v.string(), v.null()),
          email: v.union(v.string(), v.null()),
        }),
        v.null(),
      ),
      site_name: v.union(v.string(), v.null()),
      sale: v.union(
        v.object({
          id: v.id('sales'),
          sale_date: v.string(),
          weight_kg: v.number(),
          price_per_kg: v.number(),
          unit_count: v.union(v.number(), v.null()),
          price_per_unit: v.union(v.number(), v.null()),
          total_amount: v.number(),
          notes: v.union(v.string(), v.null()),
        }),
        v.null(),
      ),
      payments: v.array(salePaymentRow),
      amount_paid: v.number(),
      balance: v.number(),
      id: v.id('invoices'),
      _id: v.id('invoices'),
      sale_id: v.id('sales'),
      number: v.string(),
      issue_date: v.string(),
      due_date: v.union(v.string(), v.null()),
      customer_id: v.union(v.id('customers'), v.null()),
      customer_name: v.string(),
      amount: v.number(),
      notes: v.union(v.string(), v.null()),
      voided: v.boolean(),
      created_at: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { invoiceId }) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
    const invoice = await ctx.db.get(invoiceId)
    if (!invoice || !(await listForCompany(user, [invoice])).length) return null
    const sale = await ctx.db.get(invoice.saleId)
    const company = await ctx.db.get(invoice.companyId)
    const customer = invoice.customerId ? await ctx.db.get(invoice.customerId) : null
    const site = invoice.locationId ? await ctx.db.get(invoice.locationId) : null
    const payments = sale ? await livePayments(ctx, sale._id) : []
    const amountPaid = sale ? amountPaidOf(sale) : 0
    return {
      ...toClientInvoice(invoice),
      company: company
        ? {
            name: company.name,
            address: company.address ?? null,
            phone: company.contactPhone ?? null,
            email: company.contactEmail ?? null,
          }
        : null,
      customer: customer
        ? { name: customer.name, contact_name: customer.contactName ?? null, phone: customer.phone ?? null, email: customer.email ?? null }
        : null,
      site_name: site?.name ?? null,
      sale: sale
        ? {
            id: sale._id,
            sale_date: sale.saleDate,
            weight_kg: sale.weightKg,
            price_per_kg: sale.pricePerKg,
            unit_count: sale.unitCount ?? null,
            price_per_unit: sale.pricePerUnit ?? null,
            total_amount: sale.totalAmount,
            notes: sale.notes ?? null,
          }
        : null,
      payments: payments.map(toClientPayment),
      amount_paid: amountPaid,
      balance: round2((sale?.totalAmount ?? invoice.amount) - amountPaid),
    }
  },
})

/**
 * Money still owed, by customer (receivables). `asOf` (YYYY-MM-DD) dates the
 * ageing: days past the invoice due date, or past the sale date when the sale
 * has no invoice with a due date.
 */
export const listReceivables = query({
  args: {
    asOf: v.string(),
    locationId: v.optional(v.id('farmLocations')),
  },
  returns: v.object({
    total: v.number(),
    customers: v.array(
      v.object({
        customer_id: v.union(v.id('customers'), v.null()),
        customer_name: v.string(),
        balance: v.number(),
        sale_count: v.number(),
        oldest_days: v.number(),
        aging: v.object({
          current: v.number(),
          d1_30: v.number(),
          d31_60: v.number(),
          d61_90: v.number(),
          d90_plus: v.number(),
        }),
      }),
    ),
    sales: v.array(
      v.object({
        sale_id: v.id('sales'),
        sale_date: v.string(),
        customer_id: v.union(v.id('customers'), v.null()),
        customer_name: v.string(),
        total_amount: v.number(),
        amount_paid: v.number(),
        balance: v.number(),
        invoice_id: v.union(v.id('invoices'), v.null()),
        invoice_number: v.union(v.string(), v.null()),
        due_date: v.union(v.string(), v.null()),
        days_overdue: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'finance.view' })
    const sales = await scopedRows(ctx, user, 'sales', { locationId: args.locationId })
    const asOfMs = Date.parse(`${args.asOf}T00:00:00Z`)
    const days = (date: string) => Math.max(0, Math.floor((asOfMs - Date.parse(`${date}T00:00:00Z`)) / 86400000))

    type Row = {
      sale_id: Id<'sales'>
      sale_date: string
      customer_id: Id<'customers'> | null
      customer_name: string
      total_amount: number
      amount_paid: number
      balance: number
      invoice_id: Id<'invoices'> | null
      invoice_number: string | null
      due_date: string | null
      days_overdue: number
    }
    const open: Row[] = []
    for (const sale of sales) {
      const paid = amountPaidOf(sale)
      const balance = round2(sale.totalAmount - paid)
      if (!(balance > CENT)) continue
      const invoice = sale.invoiceId ? await ctx.db.get(sale.invoiceId) : null
      const live = invoice && !invoice.voidedAt ? invoice : null
      const dueDate = live?.dueDate ?? null
      open.push({
        sale_id: sale._id,
        sale_date: sale.saleDate,
        customer_id: sale.customerId ?? null,
        customer_name: sale.customerName || '—',
        total_amount: sale.totalAmount,
        amount_paid: paid,
        balance,
        invoice_id: live?._id ?? null,
        invoice_number: live?.number ?? null,
        due_date: dueDate,
        days_overdue: days(dueDate ?? sale.saleDate),
      })
    }

    const bucket = (d: number) => (d === 0 ? 'current' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90_plus')
    type CustomerBalance = {
      customer_id: Id<'customers'> | null
      customer_name: string
      balance: number
      sale_count: number
      oldest_days: number
      aging: Record<ReturnType<typeof bucket>, number>
    }
    const byCustomer = new Map<string, CustomerBalance>()
    for (const r of open) {
      const key = r.customer_id ?? `name:${r.customer_name.toLowerCase()}`
      if (!byCustomer.has(key)) {
        byCustomer.set(key, {
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          balance: 0,
          sale_count: 0,
          oldest_days: 0,
          aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
        })
      }
      const c = byCustomer.get(key)!
      c.balance = round2(c.balance + r.balance)
      c.sale_count += 1
      c.oldest_days = Math.max(c.oldest_days, r.days_overdue)
      c.aging[bucket(r.days_overdue)] = round2(c.aging[bucket(r.days_overdue)] + r.balance)
    }
    return {
      total: round2(open.reduce((s, r) => s + r.balance, 0)),
      customers: [...byCustomer.values()].sort((a, b) => b.balance - a.balance),
      sales: open.sort((a, b) => a.sale_date.localeCompare(b.sale_date)),
    }
  },
})
