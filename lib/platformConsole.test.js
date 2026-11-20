import { describe, expect, it } from 'vitest'
import { dayMonth, dayMonthTime, daysUntil, isSameDay, monthYear, nextOpenInvoice, planMix, planPrice, tenantStatus, tenantTabFilter, upcomingRenewals } from './platformConsole'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 10, 19)

describe('platform console helpers (Paper 40/44)', () => {
  it('maps tenant tabs to the existing list filters', () => {
    expect(tenantTabFilter('past_due')).toEqual({ subscriptionStatus: 'past_due' })
    expect(tenantTabFilter('suspended')).toEqual({ state: 'suspended' })
    expect(tenantTabFilter('nope')).toEqual({})
  })

  it('lets the organization state win over the subscription status', () => {
    expect(tenantStatus('suspended', 'active')).toEqual({ key: 'suspended', tone: 'alert' })
    expect(tenantStatus('active', 'past_due')).toEqual({ key: 'past_due', tone: 'warn' })
    expect(tenantStatus('active', 'none')).toEqual({ key: 'no_plan', tone: 'neutral' })
  })

  const subs = [
    { companyId: 'a', planName: 'Growth', status: 'active', currentPeriodEnd: now + 2 * DAY, trialEndsAt: null, graceEndsAt: null },
    { companyId: 'a', planName: 'Starter', status: 'cancelled', currentPeriodEnd: now + DAY, trialEndsAt: null, graceEndsAt: null },
    { companyId: 'b', planName: 'Starter', status: 'trialing', currentPeriodEnd: now + 30 * DAY, trialEndsAt: now + DAY, graceEndsAt: null },
    { companyId: 'c', planName: 'Growth', status: 'past_due', currentPeriodEnd: now - DAY, trialEndsAt: null, graceEndsAt: now + 5 * DAY },
    { companyId: 'd', planName: 'Pro', status: 'active', currentPeriodEnd: now + 20 * DAY, trialEndsAt: null, graceEndsAt: null },
    { companyId: 'e', planName: 'Pro', status: 'cancelled', currentPeriodEnd: now + DAY, trialEndsAt: null, graceEndsAt: null },
  ]

  it('lists renewals, trial ends and grace ends in the next 7 days from each company’s latest subscription', () => {
    expect(upcomingRenewals(subs, now).map((r) => [r.companyId, r.at])).toEqual([
      ['b', now + DAY],
      ['a', now + 2 * DAY],
      ['c', now + 5 * DAY],
    ])
  })

  it('counts live subscriptions per plan', () => {
    expect(planMix(subs)).toEqual([
      { plan: 'Growth', count: 2 },
      { plan: 'Pro', count: 1 },
      { plan: 'Starter', count: 1 },
    ])
  })

  it('finds the open invoice due soonest and counts days left', () => {
    const inv = [
      { id: 1, status: 'paid', totalMinor: 5, paidMinor: 5, dueAt: 1 },
      { id: 2, status: 'open', totalMinor: 5, paidMinor: 0, dueAt: 9 },
      { id: 3, status: 'open', totalMinor: 5, paidMinor: 0, dueAt: 4 },
    ]
    expect(nextOpenInvoice(inv).id).toBe(3)
    expect(nextOpenInvoice([])).toBeNull()
    expect(daysUntil(now + 3.2 * DAY, now)).toBe(4)
    expect(daysUntil(now - DAY, now)).toBe(0)
  })
})

describe('Paper 44 date and price formats', () => {
  it('formats day-month, month-year and day-month time', () => {
    const at = new Date(2026, 10, 12, 7, 5).getTime()
    expect(dayMonth(at, 'en-GB')).toBe('12 Nov')
    expect(monthYear(at, 'en-GB')).toBe('Nov 2026')
    expect(dayMonthTime(at, 'en-GB')).toBe('12 Nov 07:05')
    expect(dayMonth(null)).toBe('—')
    expect(isSameDay(at, new Date(2026, 10, 12, 23).getTime())).toBe(true)
    expect(isSameDay(at, new Date(2026, 10, 13, 1).getTime())).toBe(false)
    const plan = { interval: 'month', prices: [{ currency: 'XOF', amountMinor: 1 }, { currency: 'GHS', amountMinor: 85000 }] }
    expect(planPrice(plan, 'GHS')).toEqual({ amountMinor: 85000, currency: 'GHS', interval: 'month' })
    expect(planPrice(null, 'GHS')).toBe(null)
  })
})
