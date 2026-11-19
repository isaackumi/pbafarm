/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { buildExport, journalEntries, journalTotals, safeText, type SourceRow } from './lib/accountingExport'

const modules = import.meta.glob('./**/*.ts')

const SAMPLE: SourceRow[] = [
  { kind: 'expense', id: 'e1', date: '2026-03-02', amount: 50, category: 'labour', categoryLabel: 'Labour' },
  { kind: 'sale', id: 's1', date: '2026-03-01', amount: 1200.5, customer: 'Ama', invoiceNumber: 'INV-0001', weightKg: 100 },
  { kind: 'payment', id: 'p1', date: '2026-03-03', amount: 1000, method: 'mobile_money', customer: 'Ama' },
  { kind: 'purchase', id: 'f1', date: '2026-03-01', amount: 300.333, supplier: 'Raanan', item: 'Grower 4mm', quantityKg: 100 },
  { kind: 'expense', id: 'e2', date: '2026-03-04', amount: 20, category: 'boat_fuel', categoryLabel: 'Boat fuel' },
  { kind: 'expense', id: 'e0', date: '2026-03-04', amount: 0, category: 'other' },
]

describe('journal entries', () => {
  test('balanced, ordered, with the right accounts', () => {
    const entries = journalEntries(SAMPLE)
    expect(entries.map((e) => e.sourceId)).toEqual(['s1', 'f1', 'e1', 'p1', 'e2'])
    const totals = journalTotals(entries)
    expect(totals.debit).toBe(totals.credit)
    expect(totals.debit).toBe(2570.83)
    const sale = entries[0]
    expect(sale.reference).toBe('INV-0001')
    expect(sale.lines.map((l) => l.account.code)).toEqual(['1200', '4000'])
    expect(entries.find((e) => e.sourceId === 'p1')!.lines.map((l) => l.account.name)).toEqual([
      'Mobile money',
      'Accounts Receivable',
    ])
    expect(entries.find((e) => e.sourceId === 'f1')!.lines[0].debit).toBe(300.33)
    // A custom category goes to "other expenses" under its own name.
    const custom = entries.find((e) => e.sourceId === 'e2')!.lines[0].account
    expect(custom).toEqual({ code: '6900', name: 'Boat fuel' })
  })

  test('generic, QuickBooks and Xero layouts', () => {
    const entries = journalEntries(SAMPLE)
    const generic = buildExport(entries, { format: 'journal', currency: 'GHS' })
    expect(generic.header[0]).toBe('Date')
    expect(generic.rows).toHaveLength(10)
    expect(generic.rows[0].slice(0, 8)).toEqual(['2026-03-01', '1', 'INV-0001', '1200', 'Accounts Receivable', expect.any(String), '1200.50', ''])

    const qb = buildExport(entries, { format: 'quickbooks', currency: 'GHS' })
    expect(qb.header).toContain('Journal No')
    expect(qb.rows[0][1]).toBe('03/01/2026')
    expect(qb.rows[0][0]).toBe(qb.rows[1][0])

    const xero = buildExport(entries, { format: 'xero', currency: 'GHS' })
    expect(xero.header[0]).toBe('*Narration')
    expect(xero.rows[0][1]).toBe('01/03/2026')
    const amounts = xero.rows.map((r) => Number(r[5]))
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6)
    expect(xero.rows[1][5]).toBe('-1200.50')
  })

  test('spreadsheet formulas in text are neutralized', () => {
    expect(safeText('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`)
    expect(safeText('@cmd')).toBe(`'@cmd`)
    expect(safeText('Ama\nKofi')).toBe('Ama Kofi')
  })
})

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', { name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now })
    const companyB = await ctx.db.insert('companies', { name: 'River', code: 'RIVER', status: 'approved', createdAt: now })
    const siteA = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'North', active: true, updatedAt: now })
    const siteA2 = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'South', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: companyB, name: 'B', active: true, updatedAt: now })
    const adminA = await ctx.db.insert('users', { email: 'admin@a.com', role: 'admin', companyId: companyA })
    const staffA = await ctx.db.insert('users', { email: 'staff@a.com', role: 'user', companyId: companyA })
    // Viewer: finance.view without reports.export.
    await ctx.db.insert('memberships', { userId: staffA, companyId: companyA, roleKey: 'viewer', allLocations: true, status: 'active', updatedAt: now })
    // Manager limited to the South site.
    const southA = await ctx.db.insert('users', { email: 'south@a.com', role: 'user', companyId: companyA, locationIds: [siteA2] })
    await ctx.db.insert('memberships', {
      userId: southA, companyId: companyA, roleKey: 'manager', allLocations: false, locationIds: [siteA2], status: 'active', updatedAt: now,
    })
    const adminB = await ctx.db.insert('users', { email: 'admin@b.com', role: 'admin', companyId: companyB })
    const supplierA = await ctx.db.insert('feedSuppliers', { name: 'Raanan', companyId: companyA, updatedAt: now })
    const feedA = await ctx.db.insert('feedTypes', { name: 'Grower', currentStock: 0, minimumStock: 0, pricePerKg: 3, active: true, companyId: companyA, updatedAt: now })
    const sale = (companyId: any, locationId: any, saleDate: string, totalAmount: number) =>
      ctx.db.insert('sales', { companyId, locationId, saleDate, weightKg: 10, pricePerKg: totalAmount / 10, totalAmount, customerName: 'Ama', updatedAt: now })
    const saleA = await sale(companyA, siteA, '2026-03-01', 500)
    await sale(companyA, siteA2, '2026-03-02', 70)
    await sale(companyA, siteA, '2025-12-31', 999)
    await sale(companyB, siteB, '2026-03-01', 4444)
    const inv = await ctx.db.insert('invoices', {
      companyId: companyA, saleId: saleA, seq: 1, number: 'INV-0001', issueDate: '2026-03-01', customerName: 'Ama', amount: 500, updatedAt: now,
    })
    await ctx.db.patch(saleA, { invoiceId: inv })
    await ctx.db.insert('salePayments', { companyId: companyA, saleId: saleA, locationId: siteA, amount: 200, paidDate: '2026-03-05', method: 'bank' })
    await ctx.db.insert('salePayments', {
      companyId: companyA, saleId: saleA, locationId: siteA, amount: 50, paidDate: '2026-03-06', method: 'cash', voidedAt: now,
    })
    await ctx.db.insert('feedPurchases', {
      companyId: companyA, locationId: siteA, feedTypeId: feedA, supplierId: supplierA, quantity: 100, pricePerKg: 3, purchaseDate: '2026-03-02', updatedAt: now,
    })
    await ctx.db.insert('expenses', { companyId: companyA, locationId: siteA, category: 'labour', amount: 40, currency: 'GHS', date: '2026-03-03', updatedAt: now })
    await ctx.db.insert('expenses', {
      companyId: companyA, locationId: siteA, category: 'other', amount: 9, currency: 'GHS', date: '2026-03-03', deletedAt: now, updatedAt: now,
    })
    return { companyA, siteA, siteA2, siteB, adminA, staffA, southA, adminB }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  return { t, as, ...ids }
}

const RANGE = { from: '2026-03-01', to: '2026-03-31' }

describe('accountingExport.entries', () => {
  test('company rows in range; voided and deleted rows left out', async () => {
    const s = await setup()
    const res = await s.as(s.adminA).query(api.accountingExport.entries, RANGE)
    const kinds = res.rows.map((r) => `${r.kind}:${r.amount}`).sort()
    expect(kinds).toEqual(['expense:40', 'payment:200', 'purchase:300', 'sale:500', 'sale:70'])
    const sale = res.rows.find((r) => r.kind === 'sale' && r.amount === 500)
    expect(sale).toMatchObject({ invoiceNumber: 'INV-0001', site: 'North' })
    expect(res.rows.find((r) => r.kind === 'purchase')).toMatchObject({ supplier: 'Raanan', item: 'Grower' })
    expect(res.truncated).toEqual([])
    const totals = journalTotals(journalEntries(res.rows))
    expect(totals.debit).toBe(totals.credit)
  })

  test('site filter', async () => {
    const s = await setup()
    const res = await s.as(s.adminA).query(api.accountingExport.entries, { ...RANGE, locationId: s.siteA2 })
    expect(res.rows.map((r) => `${r.kind}:${r.amount}`)).toEqual(['sale:70'])
  })

  test('a site-limited member only exports their sites', async () => {
    const s = await setup()
    const res = await s.as(s.southA).query(api.accountingExport.entries, RANGE)
    expect(res.rows.map((r) => `${r.kind}:${r.amount}`)).toEqual(['sale:70'])
    await expect(s.as(s.southA).query(api.accountingExport.entries, { ...RANGE, locationId: s.siteA })).rejects.toThrow()
  })

  test('another company: no rows of ours, and our site is refused', async () => {
    const s = await setup()
    const res = await s.as(s.adminB).query(api.accountingExport.entries, RANGE)
    expect(res.rows.map((r) => r.amount)).toEqual([4444])
    await expect(s.as(s.adminB).query(api.accountingExport.entries, { ...RANGE, locationId: s.siteA })).rejects.toThrow()
  })

  test('needs finance permissions and a sane range', async () => {
    const s = await setup()
    await expect(s.as(s.staffA).query(api.accountingExport.entries, RANGE)).rejects.toThrow()
    await expect(s.as(s.adminA).query(api.accountingExport.entries, { from: '2026-03-31', to: '2026-03-01' })).rejects.toThrow()
    await expect(s.as(s.adminA).query(api.accountingExport.entries, { from: '2024-01-01', to: '2026-03-01' })).rejects.toThrow()
  })
})
