import { describe, expect, it } from 'vitest'
import {
  buildBiweeklyRecords,
  buildDailyRecords,
  parseCsv,
  parseNumber,
  toServerRecords,
} from './csvImport'

describe('parseCsv (MOBILE-009)', () => {
  it('handles quoted commas, escaped quotes, line breaks in quotes, CRLF and BOM', () => {
    const text = '\uFEFFCage_Name,Notes\r\n"Cage 1","Fed late, ""rough"" water"\r\nCage 2,"two\nlines"\r\n\r\nCage 3,plain\r\n'
    const { headers, rows } = parseCsv(text)
    expect(headers).toEqual(['cage_name', 'notes'])
    expect(rows).toEqual([
      { line: 2, values: { cage_name: 'Cage 1', notes: 'Fed late, "rough" water' } },
      { line: 3, values: { cage_name: 'Cage 2', notes: 'two\nlines' } },
      { line: 6, values: { cage_name: 'Cage 3', notes: 'plain' } },
    ])
  })

  it('reads semicolon files with decimal commas', () => {
    const { rows } = parseCsv('cage;feed_amount\nC1;12,5\n')
    expect(rows[0].values).toEqual({ cage: 'C1', feed_amount: '12,5' })
    expect(parseNumber(rows[0].values.feed_amount)).toBe(12.5)
  })

  it('reports an unclosed quote and an empty file', () => {
    expect(() => parseCsv('a,b\n1,"oops\n')).toThrow(expect.objectContaining({ code: 'UNCLOSED_QUOTE', line: 2 }))
    expect(() => parseCsv('\n\n')).toThrow(expect.objectContaining({ code: 'EMPTY' }))
  })

  it('parseNumber rejects junk and uses the fallback for blanks', () => {
    expect(parseNumber('', 3)).toBe(3)
    expect(parseNumber('1,234,5')).toBeNaN()
    expect(parseNumber('12kg')).toBeNaN()
    expect(parseNumber(' 7 ')).toBe(7)
  })
})

const cages = [{ _id: 'c1', name: 'Cage 1' }, { _id: 'c2', name: 'Cage 2' }]
const feedTypes = [{ _id: 'f1', name: 'Grower 4mm', price_per_kg: 2 }]
const today = '2026-11-18'

describe('buildDailyRecords', () => {
  it('builds records and reports every skipped row with its line', () => {
    const { rows } = parseCsv(
      [
        'cage_name,date,feed_amount,feed_type,feed_price,mortality,notes',
        'cage 1,2026-11-17,10,Grower 4mm,,2,"ok, fine"',
        'Cage 9,2026-11-17,10,Grower 4mm,,0,',
        'Cage 2,2026-02-30,10,Grower 4mm,,0,',
        'Cage 2,2026-12-01,10,Grower 4mm,,0,',
        'Cage 2,2026-11-17,10,,,0,',
        'Cage 2,2026-11-17,0,,,1.5,',
        'Cage 2,2026-11-17,-1,,,0,',
        'Cage 2,2026-11-17,0,,,0,',
        'Cage 1,2026-11-17,5,Grower 4mm,,0,',
        'Cage 2,2026-11-16,1,Starter,,0,',
      ].join('\n'),
    )
    const { records, skipped } = buildDailyRecords(rows, { cages, feedTypes, today })
    expect(toServerRecords(records)).toEqual([
      { cageId: 'c1', date: '2026-11-17', feedAmount: 10, feedTypeId: 'f1', feedType: 'Grower 4mm', feedPrice: 2, feedCost: 20, mortality: 2, notes: 'ok, fine' },
      { cageId: 'c2', date: '2026-11-17', feedAmount: 0, feedTypeId: undefined, feedType: undefined, feedPrice: 0, feedCost: 0, mortality: 0, notes: undefined },
    ])
    expect(skipped.map((s) => [s.line, s.reason.key])).toEqual([
      [3, 'csvImport.reason.unknownCage'],
      [4, 'csvImport.reason.badDate'],
      [5, 'csvImport.reason.futureDate'],
      [6, 'csvImport.reason.feedTypeRequired'],
      [7, 'csvImport.reason.badWholeNumber'],
      [8, 'csvImport.reason.badNumber'],
      [10, 'csvImport.reason.duplicateRow'],
      [11, 'csvImport.reason.unknownFeedType'],
    ])
  })
})

describe('buildBiweeklyRecords', () => {
  it('computes total weight, requires ABW and de-duplicates batch codes', () => {
    const { rows } = parseCsv(
      [
        'cage_name,date,batch_code,average_body_weight,total_fish_count,total_weight',
        'Cage 1,2026-11-10,B1,250,1000,',
        'Cage 2,2026-11-10,,0,1000,',
        'Cage 2,2026-11-10,B1,100,10,',
        'Cage 2,2026-11-10,,100,10.5,',
        ',2026-11-10,,100,10,',
      ].join('\n'),
    )
    const { records, skipped } = buildBiweeklyRecords(rows, { cages, today })
    expect(toServerRecords(records)).toEqual([
      { cageId: 'c1', date: '2026-11-10', batchCode: 'B1', averageBodyWeight: 250, totalFishCount: 1000, totalWeight: 250 },
    ])
    expect(skipped.map((s) => [s.line, s.reason.key])).toEqual([
      [3, 'csvImport.reason.badPositive'],
      [4, 'csvImport.reason.duplicateRow'],
      [5, 'csvImport.reason.badWholeNumber'],
      [6, 'csvImport.reason.missingCage'],
    ])
  })
})
