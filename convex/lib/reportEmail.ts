import { DATASETS, measureDef, reportCsv, type DatasetId, type ReportColumn } from './reportCatalog'
import { emailContext, fmtNum, scheduledReportEmail, type EmailLocale } from './emailTemplates'

/** Email of a scheduled report (ANLY-007, Paper E7): HTML + plain text with a preview, the full data as CSV. */

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
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  return value
}

/** Measures whose column total is meaningful (sums and counts of kg, fish, items). */
const SUMMABLE = new Set(['count', 'kg', 'quantity'])

/**
 * Up to 3 headline numbers (Paper E7): the row count, then the totals of the
 * first two summable measures. Totals are left out when the data is partial.
 */
export function headlineNumbers(
  dataset: DatasetId,
  result: Pick<Result, 'columns' | 'rows' | 'sourceTruncated' | 'rowsTruncated'>,
  locale: EmailLocale,
): Array<{ label: string; value: string }> {
  const out = [{ label: locale === 'fr' ? 'Lignes' : 'Rows', value: fmtNum(result.rows.length, locale, 0) }]
  if (result.sourceTruncated || result.rowsTruncated) return out
  for (const c of result.columns) {
    if (out.length >= 3) break
    if (c.kind !== 'measure') continue
    const m = measureDef(dataset, c.id)
    if (!m || (m.kind !== 'sum' && m.kind !== 'count') || !SUMMABLE.has(m.format)) continue
    let total = 0
    for (const row of result.rows) {
      const v = row[c.id]
      if (typeof v === 'number' && Number.isFinite(v)) total += v
    }
    out.push({ label: c.label, value: fmtNum(total, locale, m.format === 'kg' ? 1 : 0) })
  }
  return out
}

export function reportEmail(opts: {
  name: string
  dataset: DatasetId
  result: Result
  /** App path of the report, e.g. "/reports?report=<id>". */
  path: string
  locale?: EmailLocale
  ownerName?: string
  orgName?: string
  env?: Record<string, string | undefined>
}): { subject: string; body: string; html: string; csv: string; filename: string; attach: boolean } {
  const { result } = opts
  const ctx = emailContext(opts.locale ?? 'en', opts.env)
  const fr = ctx.locale === 'fr'
  const csv = '\uFEFF' + reportCsv(result.columns, result.rows)
  const attach = new TextEncoder().encode(csv).length <= MAX_CSV_BYTES
  const filename = `${slugify(opts.name)}-${result.to ?? result.today}.csv`
  const notes: string[] = []
  if (result.sourceTruncated) {
    notes.push(
      fr
        ? 'Le rapport a atteint sa limite de données : les totaux sont partiels. Réduisez la période ou filtrez par site.'
        : 'The report reached its data limit; totals are partial. Narrow the period or filter by site.',
    )
  }
  if (result.rowsTruncated) {
    notes.push(
      fr
        ? 'Seules les premières lignes sont incluses ; augmentez la limite de lignes ou regroupez moins finement.'
        : 'Only the first rows are included; raise the row limit or group less finely.',
    )
  }
  const mail = scheduledReportEmail(ctx, {
    name: opts.name,
    datasetLabel: DATASETS[opts.dataset].label,
    period: result.from && result.to ? { from: result.from, to: result.to } : { asOf: result.today },
    numbers: headlineNumbers(opts.dataset, result, ctx.locale),
    rows: result.rows.length,
    attachment: result.rows.length ? { filename, attached: attach } : null,
    notes,
    preview: {
      columns: result.columns.map((c) => c.label),
      rows: result.rows.slice(0, PREVIEW_ROWS).map((row) => result.columns.map((c) => fmt(row[c.id]))),
      more: Math.max(0, result.rows.length - PREVIEW_ROWS),
    },
    path: opts.path,
    ownerName: opts.ownerName,
    orgName: opts.orgName ?? '',
  })
  return { subject: mail.subject, body: mail.text, html: mail.html, csv, filename, attach }
}
