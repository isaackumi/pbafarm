/** CSV text from a header row and rows of cells (RFC 4180 quoting). */
export function toCsv(header, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header, ...rows].map((line) => line.map(esc).join(',')).join('\n')
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
