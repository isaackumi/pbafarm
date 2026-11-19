import { describe, expect, it } from 'vitest'
import { salePill, summarizeSales, topCustomers } from './salesSummary'

const sale = (o) => ({ total_amount: 100, amount_paid: 0, balance: 100, payment_status: 'pending', ...o })

describe('summarizeSales', () => {
  it('compares the month with the previous one and ages receivables', () => {
    const s = summarizeSales(
      [
        sale({ sale_date: '2025-11-02', total_amount: 300, amount_paid: 150 }),
        sale({ sale_date: '2025-11-10', total_amount: 100, amount_paid: 100 }),
        sale({ sale_date: '2025-10-20', total_amount: 200 }),
      ],
      {
        total: 500,
        sales: [
          { balance: 150, days_overdue: 0 },
          { balance: 200, days_overdue: 12 },
          { balance: 150, days_overdue: 45 },
        ],
      },
      '2025-11-18',
    )
    expect(s).toMatchObject({
      total: 400,
      changePct: 100,
      collected: 250,
      collectedPct: 63,
      outstanding: 500,
      outstandingCount: 3,
      overdue: 350,
      overdue30Count: 1,
    })
  })

  it('handles January and an empty previous month', () => {
    const s = summarizeSales([sale({ sale_date: '2026-01-05' }), sale({ sale_date: '2025-12-05', total_amount: 50 })], undefined, '2026-01-10')
    expect(s.changePct).toBe(100)
    expect(s.outstanding).toBeNull()
    expect(summarizeSales([], undefined, '2026-01-10').changePct).toBeNull()
  })
})

describe('topCustomers', () => {
  it('ranks customers inside the window', () => {
    const rows = topCustomers(
      [
        sale({ customer_id: 'a', customer_name: 'A', sale_date: '2025-11-01', total_amount: 50 }),
        sale({ customer_id: 'a', customer_name: 'A', sale_date: '2025-10-01', total_amount: 80, balance: 0 }),
        sale({ customer_name: 'Walk-in', sale_date: '2025-11-01', total_amount: 100 }),
        sale({ customer_id: 'b', customer_name: 'B', sale_date: '2025-01-01', total_amount: 999 }),
      ],
      '2025-11-18',
    )
    expect(rows.map((r) => [r.name, r.total, r.count, r.open])).toEqual([
      ['A', 130, 2, 1],
      ['Walk-in', 100, 1, 1],
    ])
  })
})

describe('salePill', () => {
  it('picks the right state', () => {
    expect(salePill(sale({ payment_status: 'paid', balance: 0 })).key).toBe('paid')
    expect(salePill(sale({ amount_paid: 60, balance: 40 }), 5)).toEqual({ key: 'overdue', tone: 'red', days: 5 })
    expect(salePill(sale({ amount_paid: 60, balance: 40, payment_status: 'partial' }))).toEqual({ key: 'partial', tone: 'amber', pct: 60 })
    expect(salePill(sale({ invoice_id: 'i' })).key).toBe('invoiced')
    expect(salePill(sale({})).key).toBe('unpaid')
  })
})
