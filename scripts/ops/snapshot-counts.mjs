#!/usr/bin/env node
// Per-table row counts of a `convex export` ZIP (<table>/documents.jsonl).
//   node scripts/ops/snapshot-counts.mjs a.zip            → JSON counts
//   node scripts/ops/snapshot-counts.mjs a.zip b.zip      → diff; exit 1 on mismatch
// Uses the system `unzip`; reads only line counts, never prints document data.
import { execFileSync } from 'node:child_process'

export function countsOf(zip) {
  const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n')
    .filter((e) => /^[^/]+\/documents\.jsonl$/.test(e) && !e.startsWith('_'))
  const counts = {}
  for (const entry of entries.sort()) {
    const buf = execFileSync('unzip', ['-p', zip, entry], { maxBuffer: 4 << 30 })
    let n = 0
    for (const byte of buf) if (byte === 10) n++
    if (buf.length && buf[buf.length - 1] !== 10) n++
    counts[entry.split('/')[0]] = n
  }
  return counts
}

export function diffCounts(a, b) {
  const tables = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  return tables
    .filter((t) => (a[t] ?? 0) !== (b[t] ?? 0))
    .map((t) => ({ table: t, before: a[t] ?? 0, after: b[t] ?? 0 }))
}

const [, , first, second] = process.argv
if (!first) {
  console.error('usage: snapshot-counts.mjs <export.zip> [<other.zip>]')
  process.exit(2)
}
const a = countsOf(first)
if (!second) {
  console.log(JSON.stringify(a, null, 2))
} else {
  const diff = diffCounts(a, countsOf(second))
  const total = Object.values(a).reduce((s, n) => s + n, 0)
  if (diff.length) {
    console.error(`MISMATCH in ${diff.length} table(s):`)
    console.table(diff)
    process.exit(1)
  }
  console.log(`OK: ${Object.keys(a).length} tables, ${total} rows match.`)
}
