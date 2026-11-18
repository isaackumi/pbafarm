import { describe, expect, test } from 'vitest'
import {
  aggregate,
  checkDefinition,
  defaultDefinition,
  periodKey,
  reportCsv,
  resolveRange,
  type Fact,
  type ReportDefinition,
} from './reportCatalog'
import { checkTiming, nextReportRun } from './reportSchedule'
import { base64Utf8, reportEmail, slugify } from './reportEmail'

const def = (over: Partial<ReportDefinition>): ReportDefinition => ({ ...defaultDefinition('sales'), ...over })

describe('ranges and periods', () => {
  test('presets resolve to inclusive business dates', () => {
    expect(resolveRange({ preset: 'last_7_days' }, '2026-03-05')).toEqual({ from: '2026-02-27', to: '2026-03-05' })
    expect(resolveRange({ preset: 'last_month' }, '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(resolveRange({ preset: 'quarter_to_date' }, '2026-05-20')).toEqual({ from: '2026-04-01', to: '2026-05-20' })
    expect(resolveRange({ preset: 'year_to_date' }, '2026-05-20')).toEqual({ from: '2026-01-01', to: '2026-05-20' })
  })

  test('weeks start on Monday; quarters and months key by date', () => {
    expect(periodKey('2026-11-22', 'week')).toBe('2026-11-16') // Sunday → previous Monday
    expect(periodKey('2026-11-16', 'week')).toBe('2026-11-16')
    expect(periodKey('2026-08-31', 'quarter')).toBe('2026-Q3')
    expect(periodKey('2026-08-31', 'month')).toBe('2026-08')
  })
})

describe('checkDefinition', () => {
  test('rejects unavailable dimensions, long ranges, bad sort and limits', () => {
    expect(checkDefinition(def({}))).toBeNull()
    expect(checkDefinition(def({ dimensions: ['species'] }))).toMatch(/not available/)
    expect(checkDefinition(def({ measures: [] }))).toMatch(/at least one measure/)
    expect(checkDefinition(def({ range: { preset: 'custom', from: '2024-01-01', to: '2026-12-31' } }))).toMatch(/at most 731/)
    expect(checkDefinition(def({ range: { preset: 'custom', from: '2026-02-30', to: '2026-03-01' } }))).toMatch(/start and end/)
    expect(checkDefinition(def({ sort: { by: 'customer', dir: 'asc' } }))).toMatch(/Sort by/)
    expect(checkDefinition(def({ limit: 5000 }))).toMatch(/Row limit/)
    expect(checkDefinition(def({ filters: [{ dimension: 'period', values: ['x'] }] }))).toMatch(/date range/)
  })
})

describe('aggregate', () => {
  const facts: Fact[] = [
    { dims: { customer: 'a', payment_status: 'paid' }, date: '2026-01-05', values: { revenue: 100, weight_kg: 10 } },
    { dims: { customer: 'a', payment_status: 'pending' }, date: '2026-01-20', values: { revenue: 300, weight_kg: 10 } },
    { dims: { customer: 'b', payment_status: 'paid' }, date: '2026-02-02', values: { revenue: 50, weight_kg: 0 } },
  ]

  test('ratios are ratios of sums; counts and sums per group; sorted by first measure desc', () => {
    const { rows } = aggregate(facts, def({ dimensions: ['customer'], measures: ['revenue', 'avg_price_kg', 'sales'] }))
    expect(rows).toEqual([
      { keys: { customer: 'a' }, values: { revenue: 400, avg_price_kg: 20, sales: 2 } },
      { keys: { customer: 'b' }, values: { revenue: 50, avg_price_kg: null, sales: 1 } },
    ])
  })

  test('filters, period grouping and the row cap', () => {
    const d = def({
      dimensions: ['period'],
      granularity: 'month',
      measures: ['revenue'],
      filters: [{ dimension: 'payment_status', values: ['paid'] }],
    })
    expect(aggregate(facts, d).rows.map((r) => [r.keys.period, r.values.revenue])).toEqual([
      ['2026-01', 100],
      ['2026-02', 50],
    ])
    const capped = aggregate(facts, { ...d, filters: [], limit: 1 })
    expect(capped).toMatchObject({ truncated: true, rows: [{ keys: { period: '2026-01' } }] })
  })
})

describe('CSV and email', () => {
  test('quotes and neutralises spreadsheet formulas', () => {
    const csv = reportCsv(
      [
        { id: 'customer', label: 'Customer', kind: 'dimension' },
        { id: 'revenue', label: 'Revenue', kind: 'measure' },
      ],
      [{ customer: '=HYPERLINK("x")', revenue: -5 }, { customer: 'A, "B"', revenue: null }],
    )
    expect(csv).toBe('Customer,Revenue\r\n"\'=HYPERLINK(""x"")",-5\r\n"A, ""B""",\r\n')
  })

  test('email has a preview, the CSV attachment and a safe file name', () => {
    const email = reportEmail({
      name: 'Monthly sales: Ghana / Togo',
      dataset: 'sales',
      link: 'https://app.example/reports?report=1',
      result: {
        columns: [{ id: 'customer', label: 'Customer', kind: 'dimension' }, { id: 'revenue', label: 'Revenue', kind: 'measure' }],
        rows: [{ customer: 'Ama', revenue: 12.5 }],
        sourceTruncated: true,
        rowsTruncated: false,
        from: '2026-01-01',
        to: '2026-01-31',
        today: '2026-02-01',
      },
    })
    expect(email.subject).toBe('Report: Monthly sales: Ghana / Togo (2026-01-01 to 2026-01-31)')
    expect(email.filename).toBe('monthly-sales-ghana-togo-2026-01-31.csv')
    expect(email.attach).toBe(true)
    expect(email.body).toContain('Ama | 12.50')
    expect(email.body).toContain('totals are partial')
    expect(slugify('***')).toBe('report')
    expect(atob(base64Utf8('Café'))).toBe('Caf\u00c3\u00a9') // UTF-8 bytes
  })
})

describe('schedule timing', () => {
  test('validates weekday and day of month', () => {
    expect(checkTiming({ frequency: 'daily', localTime: '25:00' })).toMatch(/HH:MM/)
    expect(checkTiming({ frequency: 'weekly', localTime: '07:00' })).toMatch(/weekday/)
    expect(checkTiming({ frequency: 'monthly', localTime: '07:00', dayOfMonth: 31 })).toMatch(/1 and 28/)
    expect(checkTiming({ frequency: 'monthly', localTime: '07:00', dayOfMonth: 28 })).toBeNull()
  })

  test('next run in the schedule time zone', () => {
    const after = Date.parse('2026-01-31T12:00:00Z')
    // Monthly on the 1st at 07:00 in Paris (UTC+1 in winter).
    const monthly = nextReportRun({ frequency: 'monthly', localTime: '07:00', dayOfMonth: 1 }, 'Europe/Paris', after)
    expect(new Date(monthly!).toISOString()).toBe('2026-02-01T06:00:00.000Z')
    // The 28th of January has passed → February.
    const later = nextReportRun({ frequency: 'monthly', localTime: '07:00', dayOfMonth: 28 }, 'UTC', after)
    expect(new Date(later!).toISOString()).toBe('2026-02-28T07:00:00.000Z')
    // Weekly on Monday (1) at 08:30 in Accra (UTC).
    const weekly = nextReportRun({ frequency: 'weekly', localTime: '08:30', weekday: 1 }, 'Africa/Accra', after)
    expect(new Date(weekly!).toISOString()).toBe('2026-02-02T08:30:00.000Z')
  })
})
