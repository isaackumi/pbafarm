/**
 * One RFC 4180 CSV cell, safe to open in a spreadsheet. Pure; shared by the
 * server exports (reports, governance) and the browser ones (lib/csv.js).
 *
 * Formula injection: a string starting with = + - @ tab or CR would run as a
 * formula, so it gets a leading `'`. Numbers, and strings that are only a
 * number (e.g. "-12.50" from toFixed), are left alone so amounts still import.
 */
const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return ''
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (typeof value === 'string' && FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
