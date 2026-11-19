import { describe, expect, it } from 'vitest'
import {
  alertText,
  decide,
  evaluateUnit,
  fcrDeterioration,
  feedDrop,
  growthStall,
  langOf,
  lowOxygen,
  missingEntries,
  mortalitySpike,
  temperatureOutOfRange,
  type DayInput,
  type UnitInput,
} from './earlyWarning'

const AS_OF = '2026-11-20'

function dateBack(n: number) {
  const d = new Date(`${AS_OF}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** `n` days ending at AS_OF; `f(i)` overrides day i (0 = oldest). */
function days(n: number, f: (i: number) => Partial<DayInput> = () => ({})): DayInput[] {
  return Array.from({ length: n }, (_, i) => ({
    date: dateBack(n - 1 - i),
    hasEntry: true,
    feedKg: 40,
    deaths: 2,
    startCount: 10_000,
    doMin: null,
    tempMin: null,
    tempMax: null,
    ...f(i),
  }))
}

function unit(over: Partial<UnitInput> = {}): UnitInput {
  return {
    unitId: 'u1',
    unitName: 'Cage 1',
    asOf: AS_OF,
    stockedOn: '2026-08-01',
    days: days(21),
    weeklyFcr: [],
    samples: [],
    thresholds: { doMin: 4, tempMin: 22, tempMax: 32 },
    ...over,
  }
}

describe('mortality spike', () => {
  it('flags a day far above the rolling baseline', () => {
    const c = mortalitySpike(unit({ days: days(21, (i) => (i === 20 ? { deaths: 40 } : { deaths: 2 + (i % 3) })) }))
    expect(c?.rule).toBe('mortality_spike')
    expect(c?.evidence.deaths).toBe(40)
    expect(c?.evidence.baseline_days).toBe(14)
    expect(Number(c?.evidence.z)).toBeGreaterThanOrEqual(3)
    expect(c?.severity).toBe('warning')
  })

  it('is critical at 1% of the fish in a day', () => {
    const c = mortalitySpike(unit({ days: days(21, (i) => (i === 20 ? { deaths: 120 } : {})) }))
    expect(c?.severity).toBe('critical')
    expect(c?.evidence.rate_pct).toBe(1.2)
  })

  it('ignores normal day-to-day noise', () => {
    expect(mortalitySpike(unit({ days: days(21, (i) => ({ deaths: 2 + (i % 4) })) }))).toBeNull()
  })

  it('min-count guard: a few deaths never alert, even from a zero baseline', () => {
    // 4 deaths from a flat zero history is an infinite z without the guard.
    expect(mortalitySpike(unit({ days: days(21, (i) => ({ deaths: i === 20 ? 4 : 0 })) }))).toBeNull()
    // 5 deaths in 100,000 fish is below the minimum daily rate.
    expect(mortalitySpike(unit({ days: days(21, (i) => ({ deaths: i === 20 ? 5 : 0, startCount: 100_000 })) }))).toBeNull()
  })

  it('without enough history only the absolute rate applies', () => {
    const short = days(4, (i) => (i === 3 ? { deaths: 30 } : {}))
    expect(mortalitySpike(unit({ stockedOn: dateBack(3), days: short }))).toBeNull()
    const big = days(4, (i) => (i === 3 ? { deaths: 60 } : {}))
    const c = mortalitySpike(unit({ stockedOn: dateBack(3), days: big }))
    expect(c?.evidence.baseline_pct).toBeNull()
    expect(c?.evidence.rate_pct).toBe(0.6)
  })

  it('needs a known fish count', () => {
    expect(mortalitySpike(unit({ days: days(21, (i) => ({ deaths: i === 20 ? 200 : 1, startCount: null })) }))).toBeNull()
  })
})

describe('feed drop', () => {
  it('flags intake well below the 7-day median', () => {
    const c = feedDrop(unit({ days: days(21, (i) => (i === 20 ? { feedKg: 25 } : {})) }))
    expect(c).toMatchObject({ rule: 'feed_drop', severity: 'warning', evidence: { feed_kg: 25, median_kg: 40, drop_pct: 38 } })
  })
  it('is critical when the fish barely eat', () => {
    expect(feedDrop(unit({ days: days(21, (i) => (i === 20 ? { feedKg: 10 } : {})) }))?.severity).toBe('critical')
  })
  it('ignores small changes, tiny rations and days without an entry', () => {
    expect(feedDrop(unit({ days: days(21, (i) => (i === 20 ? { feedKg: 35 } : {})) }))).toBeNull()
    expect(feedDrop(unit({ days: days(21, (i) => ({ feedKg: i === 20 ? 0.5 : 1.5 })) }))).toBeNull()
    expect(feedDrop(unit({ days: days(21, (i) => (i === 20 ? { hasEntry: false, feedKg: 0 } : {})) }))).toBeNull()
  })
})

describe('missing entries', () => {
  it('counts consecutive days without a record up to the evaluated day', () => {
    const c = missingEntries(unit({ days: days(21, (i) => (i >= 18 ? { hasEntry: false } : {})) }))
    expect(c?.evidence).toEqual({ days_missing: 3, last_entry: dateBack(3) })
  })
  it('one missing day is not an alert, and days before stocking do not count', () => {
    expect(missingEntries(unit({ days: days(21, (i) => (i === 20 ? { hasEntry: false } : {})) }))).toBeNull()
    expect(missingEntries(unit({ stockedOn: AS_OF, days: [] }))).toBeNull()
  })
})

describe('water quality', () => {
  it('low oxygen on 2 of 3 days is critical', () => {
    const c = lowOxygen(unit({ days: days(21, (i) => ({ doMin: i >= 19 ? 3.2 : 5.5 })) }))
    expect(c).toMatchObject({ severity: 'critical', evidence: { do_mg_l: 3.2, breach_days: 2 } })
  })
  it('a steady fall towards the minimum warns before the breach', () => {
    const c = lowOxygen(unit({ days: days(21, (i) => ({ doMin: i === 18 ? 5 : i === 19 ? 4.6 : i === 20 ? 4.3 : 6 })) }))
    expect(c).toMatchObject({ severity: 'warning', evidence: { trend: 'falling' } })
  })
  it('one mildly low reading is not an alert; no readings, no alert', () => {
    expect(lowOxygen(unit({ days: days(21, (i) => ({ doMin: i === 20 ? 3.8 : 6 })) }))).toBeNull()
    expect(lowOxygen(unit())).toBeNull()
  })
  it('temperature above the range on 2 days', () => {
    const c = temperatureOutOfRange(unit({ days: days(21, (i) => ({ tempMin: 28, tempMax: i >= 19 ? 33.5 : 30 })) }))
    expect(c?.evidence).toMatchObject({ direction: 'high', temp_c: 33.5, breach_days: 2 })
  })
  it('temperature falling towards the minimum', () => {
    const c = temperatureOutOfRange(unit({ days: days(21, (i) => ({ tempMax: 27, tempMin: i === 18 ? 25 : i === 19 ? 24 : i === 20 ? 22.5 : 26 })) }))
    expect(c?.evidence).toMatchObject({ direction: 'low', trend: 'falling' })
  })
})

describe('FCR and growth', () => {
  it('flags FCR rising 3 weeks running', () => {
    const weeklyFcr = [1.3, 1.35, 1.45, 1.6].map((fcr, i) => ({ weekEnd: dateBack(21 - i * 7), fcr }))
    expect(fcrDeterioration(unit({ weeklyFcr }))?.evidence).toMatchObject({ weeks: 3, fcr_from: 1.3, fcr_to: 1.6 })
    const flat = [1.3, 1.35, 1.3, 1.6].map((fcr, i) => ({ weekEnd: dateBack(21 - i * 7), fcr }))
    expect(fcrDeterioration(unit({ weeklyFcr: flat }))).toBeNull()
  })
  it('flags growth below half the expected SGR between samples', () => {
    const c = growthStall(unit({ samples: [{ date: dateBack(20), abwG: 150 }, { date: dateBack(2), abwG: 160 }] }))
    expect(c?.evidence).toMatchObject({ abw_from_g: 150, abw_to_g: 160, days: 18, expected_sgr_pct: 1 })
    expect(growthStall(unit({ samples: [{ date: dateBack(20), abwG: 150 }, { date: dateBack(2), abwG: 210 }] }))).toBeNull()
  })
})

describe('evaluateUnit', () => {
  it('a healthy unit raises nothing', () => {
    expect(evaluateUnit(unit({ days: days(21, () => ({ doMin: 6, tempMin: 27, tempMax: 29 })) }))).toEqual([])
  })
})

describe('dedupe and cool-down', () => {
  const c = mortalitySpike(unit({ days: days(21, (i) => (i === 20 ? { deaths: 40 } : {})) }))!
  it('re-running the same day refreshes, never duplicates', () => {
    expect(decide({ date: AS_OF, lastSeenDate: AS_OF, severity: 'warning', status: 'resolved' }, c)).toEqual({
      action: 'refresh',
      escalated: false,
    })
  })
  it('an open alert is refreshed; escalation is flagged', () => {
    const prior = { date: dateBack(1), lastSeenDate: dateBack(1), severity: 'warning' as const, status: 'open' as const }
    expect(decide(prior, c)).toEqual({ action: 'refresh', escalated: false })
    expect(decide(prior, { ...c, severity: 'critical' })).toEqual({ action: 'refresh', escalated: true })
  })
  it('a resolved alert stays quiet during the cool-down unless it gets worse', () => {
    const prior = { date: dateBack(2), lastSeenDate: dateBack(2), severity: 'warning' as const, status: 'resolved' as const }
    expect(decide(prior, c)).toEqual({ action: 'suppress' })
    expect(decide(prior, { ...c, severity: 'critical' })).toEqual({ action: 'insert' })
    expect(decide({ ...prior, lastSeenDate: dateBack(3) }, c)).toEqual({ action: 'insert' })
  })
  it('no prior alert inserts', () => {
    expect(decide(null, c)).toEqual({ action: 'insert' })
  })
})

describe('text', () => {
  it('copies evidence numbers verbatim, EN and FR', () => {
    const evidence = { deaths: 40, fish: 10000, rate_pct: 0.4, baseline_pct: 0.02, baseline_days: 14, z: 12.3, ewma_pct: 0.13 }
    const en = alertText({ rule: 'mortality_spike', unitName: 'Cage 1', evidence }, 'en')
    const fr = alertText({ rule: 'mortality_spike', unitName: 'Cage 1', evidence }, 'fr')
    for (const t of [en, fr]) {
      expect(t.title).toContain('Cage 1')
      expect(t.detail).toContain('40')
      expect(t.actions.length).toBeGreaterThan(0)
    }
    expect(fr.title).not.toEqual(en.title)
  })
  it('langOf maps locales', () => {
    expect(langOf('fr-CI')).toBe('fr')
    expect(langOf('en-GH')).toBe('en')
    expect(langOf(undefined)).toBe('en')
  })
})
