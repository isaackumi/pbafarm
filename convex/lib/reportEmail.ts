import { DATASETS, reportCsv, type DatasetId, type ReportColumn } from './reportCatalog'

/** Email of a scheduled report (ANLY-007): plain text with a preview, the full data as CSV. */

export const PREVIEW_ROWS = 10
/** Above this the CSV is not attached (Resend allows 40 MB; keep mail small). */
export const MAX_CSV_BYTES = 5 * 1024 * 1024

type Result = {
  columns: ReportColumn[]
  rows: Array<Record<string, string | number | null>>
  sourceTruncated: boolean
  rowsTruncated: boolean
  from: string | null
  to: string | null
  today: string
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .slice(0, 60) || 'report'
  )
}

/** UTF-8 → base64 (no Buffer in the Convex default runtime). */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function fmt(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  return value
}

export function reportEmail(opts: {
  name: string
  dataset: DatasetId
  result: Result
  link: string
}): { subject: string; body: string; csv: string; filename: string; attach: boolean } {
  const { result } = opts
  const period = result.from && result.to ? `${result.from} to ${result.to}` : `stock on ${result.today}`
  const csv = '\uFEFF' + reportCsv(result.columns, result.rows)
  const attach = new TextEncoder().encode(csv).length <= MAX_CSV_BYTES
  const lines = [
    opts.name,
    `${DATASETS[opts.dataset].label}, ${period}.`,
    '',
    attach
      ? `${result.rows.length} row(s), attached as CSV.`
      : `${result.rows.length} row(s); too large to attach. Open the report in the app.`,
  ]
  if (result.sourceTruncated) lines.push('Note: the report reached its data limit; totals are partial. Narrow the period or filter by site.')
  if (result.rowsTruncated) lines.push('Note: only the first rows are included; raise the row limit or group less finely.')
  if (result.rows.length) {
    lines.push('', 'Preview:')
    lines.push(result.columns.map((c) => c.label).join(' | '))
    for (const row of result.rows.slice(0, PREVIEW_ROWS)) {
      lines.push(result.columns.map((c) => fmt(row[c.id])).join(' | '))
    }
    if (result.rows.length > PREVIEW_ROWS) lines.push(`… ${result.rows.length - PREVIEW_ROWS} more in the attachment.`)
  } else {
    lines.push('', 'No data for this period.')
  }
  lines.push(
    '',
    `Open the report: ${opts.link}`,
    'You receive this because you are a recipient of this scheduled report. Turn off email in your notification preferences, or ask the schedule owner to remove you.',
  )
  return {
    subject: `Report: ${opts.name} (${period})`.slice(0, 200),
    body: lines.join('\n'),
    csv,
    filename: `${slugify(opts.name)}-${result.to ?? result.today}.csv`,
    attach,
  }
}
