import { describe, expect, it } from 'vitest'
import { summarizeProcurement, supplierSpend } from './procurementSummary'

const po = (o) => ({ lines: [{ quantity_kg: 1000 }], ordered_value: 100, received_value: 0, ...o })

describe('summarizeProcurement', () => {
  it('counts open, arriving, month spend and on-time', () => {
    const s = summarizeProcurement(
      [
        po({ status: 'draft' }),
        po({ status: 'ordered', expected_date: '2025-11-20' }),
        po({ status: 'ordered', expected_date: '2025-12-30' }),
        po({ status: 'received', expected_date: '2025-11-10', received_date: '2025-11-09', received_value: 500 }),
        po({ status: 'received', expected_date: '2025-11-01', received_date: '2025-11-03', received_value: 300 }),
        po({ status: 'received', received_date: '2025-10-01', received_value: 50 }),
        po({ status: 'cancelled' }),
      ],
      '2025-11-18',
    )
    expect(s).toEqual({
      openCount: 3,
      openValue: 300,
      arrivingCount: 1,
      arrivingKg: 1000,
      spendMonth: 800,
      onTimePct: 50,
    })
  })

  it('has no on-time figure without dated receipts', () => {
    expect(summarizeProcurement([], '2025-11-18').onTimePct).toBeNull()
  })
})

describe('supplierSpend', () => {
  it('sums received value per supplier, largest first', () => {
    const rows = supplierSpend([
      po({ status: 'received', supplier_name: 'A', received_value: 10 }),
      po({ status: 'received', supplier_name: 'B', received_value: 30, expected_date: '2025-01-02', received_date: '2025-01-01' }),
      po({ status: 'ordered', supplier_name: 'A' }),
    ])
    expect(rows.map((r) => [r.name, r.spend, r.onTime, r.timed])).toEqual([
      ['B', 30, 1, 1],
      ['A', 10, 0, 0],
    ])
  })
})
