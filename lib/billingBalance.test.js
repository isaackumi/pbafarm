import { describe, expect, it } from 'vitest'
import { balanceDue, limitTone } from './billingBalance'

describe('balanceDue (suspended page, PLAT-104)', () => {
  it('sums what open invoices still owe, per currency', () => {
    const invoices = [
      { status: 'open', currency: 'GHS', totalMinor: 50000, paidMinor: 10000 },
      { status: 'open', currency: 'GHS', totalMinor: 20000, paidMinor: 0 },
      { status: 'paid', currency: 'GHS', totalMinor: 99999, paidMinor: 99999 },
      { status: 'open', currency: 'USD', totalMinor: 4000, paidMinor: 4000 },
      { status: 'uncollectible', currency: 'XOF', totalMinor: 1000, paidMinor: 0 },
    ]
    expect(balanceDue(invoices)).toEqual([['GHS', 60000]])
    expect(balanceDue(undefined)).toEqual([])
  })
})

describe('limitTone (billing usage bars)', () => {
  it('flags limits at 80% and at/over the cap; unlimited is fine', () => {
    expect(limitTone(3, 10)).toBe('ok')
    expect(limitTone(8, 10)).toBe('warn')
    expect(limitTone(10, 10)).toBe('alert')
    expect(limitTone(0, 0)).toBe('alert')
    expect(limitTone(500, null)).toBe('ok')
  })
})
