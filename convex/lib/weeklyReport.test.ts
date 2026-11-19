import { describe, expect, it } from 'vitest'
import {
  acceptReply,
  financeText,
  groundingProblems,
  numbersIn,
  packFigures,
  templateReport,
  weekEndOn,
  weekStartOf,
  type ReportPack,
} from './weeklyReport'

const pack: ReportPack = {
  company: 'Lakeside',
  site: 'North',
  weekStart: '2026-03-02',
  weekEnd: '2026-03-08',
  week: packFigures(
    {
      occupancies: 4,
      fish_end: 37680,
      biomass_kg: 6782.4,
      gain_kg: 1204.5,
      feed_kg: 1450.2,
      fcr: 1.2,
      survival_pct: 94.2,
      mortality: 312,
      mortality_pct: 0.8,
      harvested_kg: 0,
      sgr_pct_day: 1.35,
    },
    1500,
  ),
  previous: { feed_kg: 1380, gain_kg: 1100, fcr: 1.25, mortality: 150 },
  units: [{ name: 'Cage 3', mortality: 210, feed_kg: 400, gain_kg: 300, fcr: 1.33 }],
  alerts: { raised: 2, critical: 1, open: 1, items: [{ unit: 'Cage 3', title: 'Mortality spike', severity: 'critical' }] },
}

describe('weekly report (AI-003)', () => {
  it('derives feed vs suggested from the pack', () => {
    expect(pack.week.suggested_feed_kg).toBe(1500)
    expect(pack.week.feed_vs_suggested_pct).toBe(97)
    expect(packFigures({ ...pack.week, occupancies: 1 } as never, 0).suggested_feed_kg).toBeNull()
  })

  it('renders a grounded template in EN and FR', () => {
    for (const lang of ['en', 'fr'] as const) {
      const text = templateReport(pack, lang)
      expect(text).toContain('Cage 3')
      expect(groundingProblems(text, pack, lang)).toEqual([])
      expect(acceptReply(text, pack, lang)).not.toBeNull()
    }
    expect(templateReport(pack, 'fr')).toMatch(/survie|Survie/)
  })

  it('reads EN and FR number formats', () => {
    expect(numbersIn('Fed 1,450.2 kg, FCR 1.2', 'en')).toEqual(expect.arrayContaining([1450.2, 1.2]))
    expect(numbersIn('1 450,2 kg, ICA 1,2', 'fr')).toEqual(expect.arrayContaining([1450.2, 1.2]))
  })

  it('rejects a reply with an invented figure', () => {
    const ok = 'This week 312 fish died (0.8%) and the farm used 1,450.2 kg of feed for 1,204.5 kg of gain, FCR 1.2.'
    expect(acceptReply(ok, pack, 'en')).not.toBeNull()
    const bad = ok + ' Survival should reach 97.5% next week.'
    expect(groundingProblems(bad, pack, 'en')).toContain(97.5)
    expect(acceptReply(bad, pack, 'en')).toBeNull()
    expect(acceptReply('Too short.', pack, 'en')).toBeNull()
  })

  it('renders costs only in the finance text', () => {
    const fin = { currency: 'GHS', feed_cost: 21753, other_cost: 1200, total_cost: 22953, cost_per_kg_gain: 19.06 }
    expect(financeText(fin, 'en')).toContain('22,953')
    expect(financeText(fin, 'fr')).toMatch(/22\s953/)
    expect(templateReport(pack, 'en')).not.toContain('GHS')
  })

  it('finds the week of a date', () => {
    expect(weekEndOn('2026-03-08')).toBe('2026-03-08')
    expect(weekEndOn('2026-03-11')).toBe('2026-03-08')
    expect(weekStartOf('2026-03-08')).toBe('2026-03-02')
  })
})
