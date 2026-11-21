import { describe, expect, it } from 'vitest'
import {
  formatFileSize,
  missingColumns,
  parseCsv,
  parseNumber,
  summarizeCheck,
  templateCsv,
  toImportRows,
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

describe('import rows (Paper 53)', () => {
  it('maps template and older header names to row fields, dropping blanks', () => {
    const { headers, rows } = parseCsv('cage_name,date,feed_amount,feed_type,dead,do_mgl,temp_c,extra\nC-01,2026-11-01,42,Grower,2,,28.5,x\n')
    expect(missingColumns('daily', headers)).toEqual([])
    expect(toImportRows(rows)).toEqual([
      { line: 2, cage: 'C-01', date: '2026-11-01', feed: '42', feedType: 'Grower', mortality: '2', tempC: '28.5' },
    ])
  })

  it('names the required columns a file lacks', () => {
    expect(missingColumns('stocking', ['date', 'cage', 'abw'])).toEqual(['fish_count'])
    expect(missingColumns('biweekly', ['date', 'cage_name', 'average_body_weight'])).toEqual([])
  })

  it('templates carry the Paper columns', () => {
    expect(templateCsv('daily')).toBe('date,cage,feed_kg,feed_type,mortality,do_mgl,temp_c\n')
  })

  it('summarizes counts, the date span and cages of rows to import', () => {
    const rows = [
      { line: 2, date: '2026-11-01' },
      { line: 3, date: '2026-11-14' },
      { line: 4, date: '2026-10-01' },
      { line: 5, date: '2026-11-05' },
    ]
    const results = [
      { line: 2, status: 'ok', cageId: 'a' },
      { line: 3, status: 'warning', cageId: 'b' },
      { line: 4, status: 'error' },
      { line: 5, status: 'ok', cageId: 'a' },
    ]
    expect(summarizeCheck(results, rows)).toEqual({
      all: 4, ok: 2, warning: 1, error: 1, ready: 3, from: '2026-11-01', to: '2026-11-14', cages: 2,
    })
  })

  it('formats file sizes', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(18 * 1024)).toBe('18 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
