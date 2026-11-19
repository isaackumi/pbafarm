import { csvCell } from '../convex/lib/csvCell'

/** CSV text from a header row and rows of cells (RFC 4180 quoting, formula-leading text neutralised). */
export function toCsv(header, rows) {
  return [header, ...rows].map((line) => line.map((v) => csvCell(v)).join(',')).join('\n')
}

/** Save CSV text as a file in the browser. */
export function downloadCsv(filename, header, rows) {
  const url = URL.createObjectURL(
    new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
