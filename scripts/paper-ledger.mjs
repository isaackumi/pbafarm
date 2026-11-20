#!/usr/bin/env node
// Compare a Paper JSX dump with docs/design/paper-ledger.json (no network).
//
//   node scripts/paper-ledger.mjs <dump.json>           print CHANGED / NEW / REMOVED
//   node scripts/paper-ledger.mjs <dump.json> --write   also record the new hashes
//   node scripts/paper-ledger.mjs --md                  regenerate docs/design/paper-ledger.md
//   node scripts/paper-ledger.mjs --validate            check the ledger's shape
//
// The dump is {"<artboardId>": "<get_jsx output>"} made by an agent from the Paper MCP:
// see scripts/paper-ledger-check.md. Exits 1 when anything changed, is new or was removed
// (without --write), or when the ledger is invalid.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyHashes, diffLedger, formatDiff, hashDump, renderMarkdown, validateLedger } from '../lib/paperLedger.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const ledgerPath = resolve(option('--ledger') ?? `${root}/docs/design/paper-ledger.json`)
const mdPath = resolve(option('--md-out') ?? ledgerPath.replace(/\.json$/, '.md'))
const dumpPath = args.find((a, i) => !a.startsWith('--') && !['--ledger', '--md-out'].includes(args[i - 1]))

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const saveLedger = (ledger) => writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`)
const saveMarkdown = (ledger) => writeFileSync(mdPath, `${renderMarkdown(ledger)}\n`)

let ledger = readJson(ledgerPath)
const errors = validateLedger(ledger)
if (errors.length) {
  console.error(`Ledger is invalid:\n  ${errors.join('\n  ')}`)
  process.exit(1)
}

if (dumpPath) {
  const hashes = await hashDump(readJson(dumpPath))
  if (flag('--write')) {
    const today = new Date().toISOString().slice(0, 10)
    const result = applyHashes(ledger, hashes, today)
    ledger = result.ledger
    saveLedger(ledger)
    saveMarkdown(ledger)
    console.log(formatDiff(result.diff))
    console.log(`Wrote ${ledgerPath} and ${mdPath}`)
  } else {
    const diff = diffLedger(ledger, hashes)
    console.log(formatDiff(diff))
    if (diff.changed.length || diff.added.length || diff.removed.length) process.exit(1)
  }
} else if (flag('--md')) {
  saveMarkdown(ledger)
  console.log(`Wrote ${mdPath}`)
} else if (flag('--validate')) {
  console.log(`Ledger OK: ${ledger.artboards.length} artboards`)
} else {
  console.error('Usage: node scripts/paper-ledger.mjs <dump.json> [--write] | --md | --validate [--ledger <path>]')
  process.exit(2)
}
