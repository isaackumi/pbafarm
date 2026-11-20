import { describe, expect, test } from 'vitest'
import {
  MAX_CHART_POINTS,
  abwChart,
  bucketOf,
  capPoints,
  feedChart,
  forecastChart,
  moneyChart,
  validateChart,
  waterChart,
} from './answerCharts'
import { sanitizeAnswer, sanitizeStreaming } from './llmAnswer'

const good = {
  type: 'line',
  title: 'ABW trend, C-07',
  xKind: 'date',
  series: [{ key: 'abw', label: 'ABW', unit: 'g', points: [{ x: '2026-11-01', y: 120 }, { x: '2026-11-15', y: 150 }] }],
}

describe('chart schema', () => {
  test('a well-formed chart passes; unknown fields are dropped', () => {
    const c = validateChart({ ...good, onClick: 'alert(1)', series: [{ ...good.series[0], html: '<b>' }] })
    expect(c).toEqual(good)
  })

  test('rejects oversize, non-numeric, unsafe text and unknown types', () => {
    const many = Array.from({ length: MAX_CHART_POINTS + 1 }, (_, i) => ({ x: `p${i}`, y: i }))
    expect(validateChart({ ...good, series: [{ ...good.series[0], points: many }] })).toBeNull()
    expect(validateChart({ ...good, series: Array.from({ length: 5 }, (_, i) => ({ ...good.series[0], key: `s${i}` })) })).toBeNull()
    expect(validateChart({ ...good, type: 'pie' })).toBeNull()
    expect(validateChart({ ...good, title: '<img src=x onerror=alert(1)>' })).toBeNull()
    expect(validateChart({ ...good, title: 'x'.repeat(81) })).toBeNull()
    expect(validateChart({ ...good, series: [{ ...good.series[0], points: [{ x: '2026-11-01', y: 'NaN' }] }] })).toBeNull()
    expect(validateChart({ ...good, series: [{ ...good.series[0], points: [{ x: '2026-11-01', y: Infinity }] }] })).toBeNull()
    expect(validateChart({ ...good, series: [{ ...good.series[0], key: '__proto__' }] })).toBeNull()
    expect(validateChart({ ...good, series: [] })).toBeNull()
    expect(validateChart('{"type":"line"}')).toBeNull()
    expect(validateChart(null)).toBeNull()
  })

  test('capPoints keeps the first and last and at most the cap', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i)
    const capped = capPoints(xs)
    expect(capped).toHaveLength(MAX_CHART_POINTS)
    expect(capped[0]).toBe(0)
    expect(capped[capped.length - 1]).toBe(999)
    expect(capPoints([1, 2, 3])).toEqual([1, 2, 3])
  })
})

describe('chart builders (server-drawn from records)', () => {
  test('forecast keeps the band; ABW trend; nothing to draw gives null', () => {
    const f = forecastChart('C-07', [
      { date: '2026-11-20', low: 300, expected: 312.34, high: 330 },
      { date: '2026-11-27', low: 330, expected: 345, high: 362 },
    ])
    expect(f?.series[0]).toMatchObject({ band: true, unit: 'g', points: [{ x: '2026-11-20', y: 312.3, lo: 300, hi: 330 }, { x: '2026-11-27' }] })
    expect(abwChart('C-07', [{ date: '2026-11-01', abwG: 120 }])?.type).toBe('line')
    expect(abwChart('C-07', [{ date: '2026-11-01', abwG: null }])).toBeNull()
    expect(abwChart('C-07', [])).toBeNull()
  })

  test('water averages per day, two units; a long history is capped', () => {
    const w = waterChart('C-07', [
      { date: '2026-11-02', doMgL: 5, tempC: 28 },
      { date: '2026-11-01', doMgL: 4, tempC: 27 },
      { date: '2026-11-01', doMgL: 6, tempC: null },
    ])
    expect(w?.series.map((s) => s.unit)).toEqual(['mg/L', '°C'])
    expect(w?.series[0].points).toEqual([{ x: '2026-11-01', y: 5 }, { x: '2026-11-02', y: 5 }])
    const days = Array.from({ length: 400 }, (_, i) => ({ date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, feedKg: 10 }))
    expect(feedChart(days)?.series[0].points.length).toBeLessThanOrEqual(MAX_CHART_POINTS)
  })

  test('money buckets by week (Monday), by month past 93 days, every bucket present', () => {
    expect(bucketOf('2026-11-20', 'week')).toBe('2026-11-16')
    expect(bucketOf('2026-11-20', 'month')).toBe('2026-11')
    const m = moneyChart('2026-11-01', '2026-11-20', 'GHS', [
      { date: '2026-11-03', revenue: 1000 },
      { date: '2026-11-04', cost: 400 },
      { date: '2026-11-18', cost: 100 },
    ])
    expect(m?.series.map((s) => s.key)).toEqual(['revenue', 'costs', 'profit'])
    expect(m?.series[0].points.map((p) => p.x)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'])
    expect(m?.series[2].points.map((p) => p.y)).toEqual([0, 600, 0, -100])
    const year = moneyChart('2026-01-01', '2026-11-20', 'GHS', [])
    expect(year?.xKind).toBe('category')
    expect(year?.series[0].points).toHaveLength(11)
  })
})

describe('incremental sanitising (streaming display)', () => {
  const full = 'C-07 is <b>fine</b>. See [the log](https://evil.example/x?d=secret) <think>plan</think>now.'

  test('no prefix ever shows markup, a link target or reasoning', () => {
    for (let i = 1; i <= full.length; i++) {
      const shown = sanitizeStreaming(full.slice(0, i))
      expect(shown).not.toMatch(/[<>]|evil\.example|secret|plan|\]\(/)
    }
  })

  test('the last frame equals the saved answer', () => {
    expect(sanitizeStreaming(full)).toBe(sanitizeAnswer(full))
    expect(sanitizeAnswer(full)).toBe('C-07 is fine. See the log now.')
  })

  test('an unclosed reasoning block stays hidden', () => {
    expect(sanitizeStreaming('<think>secret steps')).toBe('')
    expect(sanitizeStreaming('Answer first. <thinking>more')).toBe('Answer first.')
  })
})
