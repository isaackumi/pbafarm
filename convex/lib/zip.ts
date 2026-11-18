/**
 * Minimal zip writer (store method, no compression) for organization data
 * exports (ENT-005). No dependencies: CRC-32, local headers, central
 * directory, end record. Files must stay under 4 GB in total (no ZIP64).
 */

let CRC_TABLE: Uint32Array | null = null

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  CRC_TABLE = table
  return table
}

export function crc32(bytes: Uint8Array): number {
  const table = crcTable()
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export type ZipEntry = { name: string; data: Uint8Array | string }

/** DOS date/time for the entries (UTC). */
function dosDateTime(date: Date) {
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2)
  const day =
    ((Math.max(1980, date.getUTCFullYear()) - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
  return { time, day }
}

export function buildZip(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  const enc = new TextEncoder()
  const { time, day } = dosDateTime(now)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = enc.encode(entry.name)
    const data = typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data
    const crc = crc32(data)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(10, time, true)
    lv.setUint16(12, day, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, day, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)

    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + centralSize + end.length)
  let pos = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, pos)
    pos += part.length
  }
  return out
}

/** Read back a stored zip (tests and verification only). */
export function readZip(bytes: Uint8Array): Array<{ name: string; data: Uint8Array; crcOk: boolean }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let endAt = bytes.length - 22
  while (endAt >= 0 && view.getUint32(endAt, true) !== 0x06054b50) endAt -= 1
  if (endAt < 0) throw new Error('Not a zip file')
  const count = view.getUint16(endAt + 10, true)
  let pos = view.getUint32(endAt + 16, true)
  const dec = new TextDecoder()
  const out = []
  for (let i = 0; i < count; i += 1) {
    const crc = view.getUint32(pos + 16, true)
    const size = view.getUint32(pos + 20, true)
    const nameLen = view.getUint16(pos + 28, true)
    const extra = view.getUint16(pos + 30, true)
    const comment = view.getUint16(pos + 32, true)
    const localAt = view.getUint32(pos + 42, true)
    const name = dec.decode(bytes.subarray(pos + 46, pos + 46 + nameLen))
    const localName = view.getUint16(localAt + 26, true)
    const localExtra = view.getUint16(localAt + 28, true)
    const start = localAt + 30 + localName + localExtra
    const data = bytes.subarray(start, start + size)
    out.push({ name, data, crcOk: crc32(data) === crc })
    pos += 46 + nameLen + extra + comment
  }
  return out
}

/** RFC 4180 CSV of rows; columns are the union of keys, objects as JSON. */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  const cell = (value: unknown) => {
    if (value === undefined || value === null) return ''
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [columns.map(cell).join(',')]
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','))
  return lines.join('\r\n') + '\r\n'
}
