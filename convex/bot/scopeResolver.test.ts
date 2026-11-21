import { describe, expect, it } from 'vitest'
import { decide, isFollowUp, isSummaryAsk, matchRange, rangeDates, resolveScope, unitRefs } from './scopeResolver'

const sites = [
  { _id: 'off', name: 'Offshore cages', code: 'OFF' },
  { _id: 'shore', name: 'Shore hatchery' },
  { _id: 'lv1', name: 'Lake Volta North' },
  { _id: 'lv2', name: 'Lake Volta South' },
]
const units = [
  { _id: 'u7', name: 'Cage 7', code: 'C-07', locationId: 'off' },
  { _id: 'u12', name: 'Cage 12', code: 'C-12', locationId: 'off' },
  { _id: 'p3', name: 'Pond 3', code: 'P-03', locationId: 'shore' },
  { _id: 'n7', name: 'North 7', code: 'N-07', locationId: 'lv1' },
]
const reach = sites.map((s) => s._id)

describe('scope resolver', () => {
  it('"get me summary from offshore" → that site, answered directly', () => {
    const r = resolveScope('get me summary from offshore', sites, units)
    expect(r.sites).toEqual(['off'])
    expect(decide(r, { sitesInReach: reach, units })).toEqual({ kind: 'answer', scope: { kind: 'site', siteId: 'off' }, range: 'today' })
  })

  it('matches case-insensitively, by prefix and with one typo', () => {
    expect(resolveScope('OFFSH report', sites, units).sites).toEqual(['off'])
    expect(resolveScope('summary ofshore', sites, units).sites).toEqual(['off'])
    expect(resolveScope('how is the hatchery doing', sites, units).sites).toEqual(['shore'])
  })

  it('"c7" → C-07; "cage 7" and "C-07" too', () => {
    for (const text of ['summary c7', 'how is cage 7', 'report C-07', 'c07 yesterday']) {
      const r = resolveScope(text, sites, units)
      expect(r.units, text).toContain('u7')
    }
    const d = decide(resolveScope('summary c7', sites, units), { sitesInReach: reach, units })
    expect(d).toEqual({ kind: 'answer', scope: { kind: 'unit', unitId: 'u7' }, range: 'today' })
  })

  it('a bare number matching two sites\' units asks which', () => {
    const r = resolveScope('cage 7', sites, units)
    expect(r.units.sort()).toEqual(['n7', 'u7'])
    expect(decide(r, { sitesInReach: reach, units })).toMatchObject({ kind: 'clarify', reason: 'ambiguous', units: expect.arrayContaining(['u7', 'n7']) })
  })

  it('ambiguous site → clarify with those sites', () => {
    const d = decide(resolveScope('summary lake volta', sites, units), { sitesInReach: reach, units })
    expect(d).toMatchObject({ kind: 'clarify', reason: 'ambiguous', sites: ['lv1', 'lv2'] })
  })

  it('no scope → clarify with every site in reach; one site in reach → answer', () => {
    const r = resolveScope('get me summary', sites, units)
    expect(decide(r, { sitesInReach: reach, units })).toMatchObject({ kind: 'clarify', reason: 'none', sites: reach })
    expect(decide(r, { sitesInReach: ['shore'], units })).toEqual({ kind: 'answer', scope: { kind: 'site', siteId: 'shore' }, range: 'today' })
  })

  it('"all sites" / "everywhere" → all', () => {
    for (const text of ['summary all sites', 'how are we doing everywhere', 'bilan partout']) {
      expect(decide(resolveScope(text, sites, units), { sitesInReach: reach, units }), text).toMatchObject({ scope: { kind: 'all' } })
    }
  })

  it('remembers the last scope for a follow-up ("and yesterday?")', () => {
    const r = resolveScope('and yesterday?', sites, units)
    expect(isFollowUp('and yesterday?')).toBe(true)
    expect(decide(r, { sitesInReach: reach, units, remembered: { scope: { kind: 'site', siteId: 'off' }, range: 'today' } })).toEqual({
      kind: 'answer',
      scope: { kind: 'site', siteId: 'off' },
      range: 'yesterday',
    })
  })

  it('never returns a site outside the candidates in reach', () => {
    const r = resolveScope('summary offshore', sites.filter((s) => s._id !== 'off'), units)
    expect(r.sites).toEqual([])
  })

  it('an unknown cage code asks for the code again', () => {
    const d = decide(resolveScope('summary c99', sites, units), { sitesInReach: reach, units })
    expect(d).toMatchObject({ kind: 'clarify', reason: 'unknown_unit' })
  })

  it('does not read times and amounts as cage codes', () => {
    expect(unitRefs('summary for the last 7 days')).toEqual([])
    expect(unitRefs('report at 7')).toEqual([])
    expect(unitRefs('fed 20kg at 7am')).toEqual([])
  })

  it('ranges and summary intent', () => {
    expect(matchRange('summary yesterday')).toBe('yesterday')
    expect(matchRange('report for the last 7 days')).toBe('last_7_days')
    expect(matchRange('bilan cette semaine')).toBe('this_week')
    expect(matchRange('this month please')).toBe('this_month')
    expect(isSummaryAsk('get me summary')).toBe(true)
    expect(isSummaryAsk('How are we doing?')).toBe(true)
    expect(isSummaryAsk('/summary')).toBe(true)
    expect(isSummaryAsk('how is c7 this week?')).toBe(true)
    expect(isSummaryAsk('fed c7 20kg')).toBe(false)
    expect(isSummaryAsk('how much feed is left')).toBe(false)
    expect(rangeDates('this_week', '2026-11-19')).toEqual({ from: '2026-11-16', to: '2026-11-19' })
    expect(rangeDates('last_7_days', '2026-11-03')).toEqual({ from: '2026-10-28', to: '2026-11-03' })
    expect(rangeDates('this_month', '2026-11-19')).toEqual({ from: '2026-11-01', to: '2026-11-19' })
  })
})
