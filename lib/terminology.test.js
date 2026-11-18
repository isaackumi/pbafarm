import { afterEach, describe, expect, test } from 'vitest'
import { applyTerms, makeTerm } from './terminology'
import { setActiveTerminology, unitLabel } from './format'

afterEach(() => setActiveTerminology(null))

describe('organization words', () => {
  test('whole nouns are rewritten, longest first, and other words are untouched', () => {
    expect(applyTerms('All Cages · Feed Types · Harvest Data', { cagePlural: 'Pens', feed: 'Ration' })).toBe(
      'All Pens · Ration Types · Harvest Data',
    )
    expect(applyTerms('Hatchery tanks and Tanks', { hatcheryTankPlural: 'Nursery vats', tankPlural: 'Vats' })).toBe(
      'Nursery vats and Vats',
    )
    expect(applyTerms('Feedback and cageside notes', { cage: 'Pen', cagePlural: 'Pens' })).toBe(
      'Feedback and cageside notes',
    )
    expect(applyTerms('All cages', { cagePlural: 'Pens' })).toBe('All Pens')
    expect(applyTerms('Nothing to rename', {})).toBe('Nothing to rename')
  })

  test('a term reader falls back to the built-in label', () => {
    const plain = makeTerm({})
    expect(plain('cage', 'Cage')).toBe('Cage')
    expect(plain.text('All Cages')).toBe('All Cages')
    expect(plain.unit('pond')).toBe('Pond')
    expect(plain.unit('pond', { plural: true })).toBe('Ponds')

    const renamed = makeTerm({ cage: 'Pen', cagePlural: 'Pens', pond: 'Pondy', pondPlural: 'Pondies' })
    expect(renamed('cage', 'Cage')).toBe('Pen')
    expect(renamed('missing', 'Fallback')).toBe('Fallback')
    expect(renamed.text('All Cages')).toBe('All Pens')
    expect(renamed.unit({ unitType: 'cage' })).toBe('Pen')
    expect(renamed.unit('cage', { plural: true })).toBe('Pens')
    expect(renamed.unit('pond', { plural: true })).toBe('Pondies')
  })

  test('unitLabel follows the active organization words', () => {
    expect(unitLabel('cage')).toBe('Cage')
    expect(unitLabel('cage', { plural: true })).toBe('Cages')
    setActiveTerminology({ cage: 'Pen', cagePlural: 'Pens', pond: 'Pondy' })
    expect(unitLabel('cage')).toBe('Pen')
    expect(unitLabel('cage', { plural: true })).toBe('Pens')
    expect(unitLabel({ unitType: 'pond' })).toBe('Pondy')
    // A type without an override keeps its built-in label.
    expect(unitLabel('tank', { plural: true })).toBe('Tanks')
  })
})
