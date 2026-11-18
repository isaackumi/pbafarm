/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', { name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now } as any)
    const otherId = await ctx.db.insert('companies', { name: 'Other', code: 'OTH', status: 'approved', createdAt: now } as any)
    const adminId = await ctx.db.insert('users', { email: 'a@x.com', role: 'admin', companyId })
    const outsiderId = await ctx.db.insert('users', { email: 'o@x.com', role: 'admin', companyId: otherId })
    const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'Site A', active: true, updatedAt: now })
    const cageId = await ctx.db.insert('cages', { name: 'A1', status: 'active', companyId, locationId: siteA, updatedAt: now } as any)
    const harvestId = await ctx.db.insert('harvestRecords', {
      cageId, harvestDate: '2026-05-01', averageBodyWeight: 400, totalWeight: 1000, estimatedCount: 2500, fcr: 1.5,
      companyId, locationId: siteA,
    } as any)
    return { adminId, outsiderId, siteA, harvestId }
  })
  const admin = t.withIdentity({ subject: `${ids.adminId}|s` })
  const outsider = t.withIdentity({ subject: `${ids.outsiderId}|s` })
  const customerId = await admin.mutation(api.sales.createCustomer, { name: 'Market Queen' })
  const sell = (weightKg: number, extra: Record<string, unknown> = {}) =>
    admin.mutation(api.sales.createSale, {
      saleDate: '2026-05-02', weightKg, pricePerKg: 10, paymentStatus: 'pending', customerId,
      locationId: ids.siteA, ...extra,
    })
  return { t, admin, outsider, customerId, sell, ...ids }
}

const saleRow = async (as: any, id: string) => (await as.query(api.sales.listSales, {})).find((s: any) => s.id === id)

describe('sale payments (INV-009)', () => {
  test('payments drive the status; overpaying is refused; removing reopens the balance', async () => {
    const { admin, sell } = await setup()
    const saleId = await sell(100) // 1000 due

    await admin.mutation(api.invoices.recordPayment, { saleId, amount: 400, paidDate: '2026-05-03', method: 'cash' })
    let sale = await saleRow(admin, saleId)
    expect(sale).toMatchObject({ payment_status: 'partial', amount_paid: 400, balance: 600 })

    await expect(
      admin.mutation(api.invoices.recordPayment, { saleId, amount: 700, paidDate: '2026-05-03', method: 'cash' }),
    ).rejects.toThrow()
    await expect(
      admin.mutation(api.invoices.recordPayment, { saleId, amount: 10, paidDate: '3 May', method: 'cash' }),
    ).rejects.toThrow()

    await admin.mutation(api.invoices.markSalePaid, { saleId, paidDate: '2026-05-04', method: 'mobile_money' })
    sale = await saleRow(admin, saleId)
    expect(sale).toMatchObject({ payment_status: 'paid', amount_paid: 1000, balance: 0 })

    const payments = await admin.query(api.invoices.listPayments, { saleId })
    expect(payments.map((p: any) => p.amount)).toEqual([400, 600])
    await expect(admin.mutation(api.invoices.removePayment, { paymentId: payments[1].id, reason: ' ' })).rejects.toThrow()
    await admin.mutation(api.invoices.removePayment, { paymentId: payments[1].id, reason: 'Bounced' })
    sale = await saleRow(admin, saleId)
    expect(sale).toMatchObject({ payment_status: 'partial', amount_paid: 400, balance: 600 })

    // A sale with money received cannot be deleted, nor its total cut below it.
    await expect(admin.mutation(api.sales.removeSale, { id: saleId })).rejects.toThrow()
    await expect(admin.mutation(api.sales.updateSale, { id: saleId, patch: { weightKg: 30 } })).rejects.toThrow(/Remove a payment/)
  })

  test('invoices are numbered per company, one live invoice per sale, and lock the amount', async () => {
    const { admin, sell } = await setup()
    const s1 = await sell(10)
    const s2 = await sell(20)
    const inv1 = await admin.mutation(api.invoices.issueInvoice, { saleId: s1, issueDate: '2026-05-02', dueDate: '2026-05-30' })
    const inv2 = await admin.mutation(api.invoices.issueInvoice, { saleId: s2, issueDate: '2026-05-02' })
    expect((await admin.query(api.invoices.getInvoice, { invoiceId: inv1 }))?.number).toBe('INV-0001')
    expect((await admin.query(api.invoices.getInvoice, { invoiceId: inv2 }))?.number).toBe('INV-0002')

    await expect(admin.mutation(api.invoices.issueInvoice, { saleId: s1, issueDate: '2026-05-02' })).rejects.toThrow()
    await expect(admin.mutation(api.sales.updateSale, { id: s1, patch: { pricePerKg: 12 } })).rejects.toThrow()
    await expect(
      admin.mutation(api.invoices.issueInvoice, { saleId: s1, issueDate: '2026-05-02', dueDate: '2026-04-01' }),
    ).rejects.toThrow()

    await admin.mutation(api.invoices.voidInvoice, { invoiceId: inv1 })
    expect((await admin.query(api.invoices.getInvoice, { invoiceId: inv1 }))?.voided).toBe(true)
    await admin.mutation(api.sales.updateSale, { id: s1, patch: { pricePerKg: 12 } })
    const inv3 = await admin.mutation(api.invoices.issueInvoice, { saleId: s1, issueDate: '2026-05-05' })
    const reissued = await admin.query(api.invoices.getInvoice, { invoiceId: inv3 })
    expect(reissued).toMatchObject({ number: 'INV-0003', amount: 120, balance: 120 })
  })

  test('editing weight re-checks what is left of the harvest', async () => {
    const { admin, sell, harvestId } = await setup()
    await sell(600, { harvestId })
    const second = await sell(300, { harvestId })
    await expect(admin.mutation(api.sales.updateSale, { id: second, patch: { weightKg: 450 } })).rejects.toThrow(
      /exceeds remaining harvest weight/,
    )
    await admin.mutation(api.sales.updateSale, { id: second, patch: { weightKg: 400 } })
    expect((await saleRow(admin, second)).weight_kg).toBe(400)
  })

  test('receivables age open balances by customer', async () => {
    const { admin, sell } = await setup()
    const old = await sell(10) // sold 2026-05-02, 100 due
    const recent = await sell(5, { saleDate: '2026-06-25' }) // 50 due
    await admin.mutation(api.invoices.recordPayment, { saleId: old, amount: 40, paidDate: '2026-05-10', method: 'bank' })
    await admin.mutation(api.invoices.issueInvoice, { saleId: recent, issueDate: '2026-06-25', dueDate: '2026-07-10' })

    const r = await admin.query(api.invoices.listReceivables, { asOf: '2026-07-01' })
    expect(r.total).toBe(110)
    expect(r.customers).toHaveLength(1)
    expect(r.customers[0]).toMatchObject({ customer_name: 'Market Queen', balance: 110, sale_count: 2 })
    // 60 is 60 days past the sale date; 50 is not yet due.
    expect(r.customers[0].aging).toMatchObject({ current: 50, d31_60: 60 })
  })

  test('another company cannot see or touch payments and invoices', async () => {
    const { admin, outsider, sell } = await setup()
    const saleId = await sell(10)
    const invoiceId = await admin.mutation(api.invoices.issueInvoice, { saleId, issueDate: '2026-05-02' })
    await admin.mutation(api.invoices.recordPayment, { saleId, amount: 10, paidDate: '2026-05-03', method: 'cash' })
    const [payment] = await admin.query(api.invoices.listPayments, { saleId })

    expect(await outsider.query(api.invoices.getInvoice, { invoiceId })).toBeNull()
    expect((await outsider.query(api.invoices.listReceivables, { asOf: '2026-07-01' })).total).toBe(0)
    await expect(outsider.query(api.invoices.listPayments, { saleId })).rejects.toThrow(/not found/i)
    await expect(
      outsider.mutation(api.invoices.recordPayment, { saleId, amount: 1, paidDate: '2026-05-03', method: 'cash' }),
    ).rejects.toThrow(/not found/i)
    await expect(outsider.mutation(api.invoices.removePayment, { paymentId: payment.id, reason: 'x' })).rejects.toThrow(/not found/i)
    await expect(outsider.mutation(api.invoices.voidInvoice, { invoiceId })).rejects.toThrow(/not found/i)
    await expect(outsider.mutation(api.invoices.issueInvoice, { saleId, issueDate: '2026-05-02' })).rejects.toThrow(/not found/i)
  })
})
