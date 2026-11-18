import { describe, expect, test } from 'vitest'
import { applyPhrasing, grounded, phrasingMessages } from './insightPhrasing'
import { assistantSystemPrompt, businessDateOr } from './llmServer'

const insight = {
  id: 'fcr_rising:u',
  unit_name: 'Cage B2',
  title: 'Cage B2 FCR rising 3 weeks in a row',
  detail: 'Cycle-to-date FCR went from 1.30 to 1.61 between the weeks ending 10 May and 31 May.',
  facts: { weeks: 3, fcr_from: 1.3, fcr_to: 1.61 },
}

describe('insight phrasing', () => {
  test('keeps lines that reuse the facts', () => {
    expect(grounded('Cage B2 feed efficiency has slipped for 3 weeks: FCR 1.3 to 1.61.', insight)).toBe(true)
  })

  test('rejects new numbers, a missing unit, or no text', () => {
    expect(grounded('Cage B2 FCR will hit 2.0 next week.', insight)).toBe(false)
    expect(grounded('FCR rising for 3 weeks.', insight)).toBe(false)
    expect(grounded('', insight)).toBe(false)
    expect(grounded(null, insight)).toBe(false)
  })

  test('applies a JSON reply; bad replies keep the original', () => {
    const ok = applyPhrasing([insight], 'Sure:\n["Cage B2 FCR up 3 weeks running, now 1.61."]')
    expect(ok[0].phrased).toBe('Cage B2 FCR up 3 weeks running, now 1.61.')
    expect(applyPhrasing([insight], 'not json')[0].phrased).toBeNull()
    expect(applyPhrasing([insight], '["Cage B2 FCR is 9.9"]')[0].phrased).toBeNull()
  })

  test('the prompt carries only the insight text', () => {
    const [, user] = phrasingMessages([insight])
    expect(JSON.parse(user.content)).toEqual([
      { n: 1, unit: 'Cage B2', title: insight.title, detail: insight.detail },
    ])
  })
})

describe('assistant server helpers', () => {
  test('system prompt embeds the server-loaded context', () => {
    const p = assistantSystemPrompt({ farm: 'Lake Farm', open_cycles: [] })
    expect(p).toContain('"farm":"Lake Farm"')
    expect(p).toContain('Never invent numbers')
  })

  test('business date or today', () => {
    expect(businessDateOr('2026-05-31')).toBe('2026-05-31')
    expect(businessDateOr('31/05/2026', new Date('2026-11-18T10:00:00Z'))).toBe('2026-11-18')
  })
})
