// Paper design ledger: pure helpers shared by scripts/paper-ledger.mjs and its tests.
// See docs/design/README.md for the rules and scripts/paper-ledger-check.md for the procedure.

export const STATUSES = ['built', 'partial', 'not-built', 'proposal', 'superseded']

const encoder = new TextEncoder()

export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// A dump maps artboard id -> get_jsx output. Accept the raw MCP content array too:
// the JSX is the last text block (the first one is the file header).
export function jsxFromDumpValue(value) {
  if (Array.isArray(value)) value = value[value.length - 1]
  if (value && typeof value === 'object' && typeof value.text === 'string') value = value.text
  if (typeof value !== 'string') throw new Error('Dump values must be the get_jsx text output')
  return value
}

export async function hashDump(dump) {
  const hashes = {}
  for (const [id, value] of Object.entries(dump)) {
    hashes[id] = await sha256Hex(jsxFromDumpValue(value))
  }
  return hashes
}

export function diffLedger(ledger, hashes) {
  const known = new Map(ledger.artboards.map((a) => [a.id, a]))
  const changed = []
  const unchanged = []
  const added = []
  for (const [id, hash] of Object.entries(hashes)) {
    const entry = known.get(id)
    if (!entry) added.push({ id, jsxHash: hash })
    else if (entry.jsxHash !== hash) {
      changed.push({ id, name: entry.name, status: entry.status, from: entry.jsxHash, to: hash })
    } else unchanged.push(id)
  }
  const removed = ledger.artboards
    .filter((a) => !(a.id in hashes))
    .map((a) => ({ id: a.id, name: a.name, status: a.status }))
  return { changed, added, removed, unchanged }
}

// Records new hashes. A changed artboard loses its verification (it must be re-checked
// in the browser); its status is left for the person rebuilding it to decide.
// New artboards are appended as stubs to be filled in by hand. Removed ones are kept.
export function applyHashes(ledger, hashes, today) {
  const diff = diffLedger(ledger, hashes)
  const changedIds = new Set(diff.changed.map((c) => c.id))
  const artboards = ledger.artboards.map((a) =>
    changedIds.has(a.id) ? { ...a, jsxHash: hashes[a.id], hashedAt: today, verifiedAt: null } : a,
  )
  for (const { id, jsxHash } of diff.added) {
    artboards.push({
      id,
      name: id,
      page: null,
      theme: null,
      width: null,
      route: null,
      implementation: [],
      status: 'not-built',
      jsxHash,
      hashedAt: today,
      verifiedAt: null,
      notes: 'New in Paper: fill in name, page, theme, width and route.',
    })
  }
  return { ledger: { ...ledger, artboards }, diff }
}

export function validateLedger(ledger) {
  const errors = []
  const seen = new Set()
  for (const a of ledger.artboards) {
    if (seen.has(a.id)) errors.push(`${a.id}: duplicate id`)
    seen.add(a.id)
    if (!STATUSES.includes(a.status)) errors.push(`${a.id}: unknown status "${a.status}"`)
    if (!/^[0-9a-f]{64}$/.test(a.jsxHash || '')) errors.push(`${a.id}: missing or malformed jsxHash`)
    if (a.status === 'built' && !(a.implementation || []).length) errors.push(`${a.id}: built without implementation files`)
  }
  return errors
}

export function formatDiff({ changed, added, removed, unchanged }) {
  const lines = []
  for (const c of changed) lines.push(`CHANGED  ${c.id}  ${c.name}  (${c.status}): needs a rebuild`)
  for (const a of added) lines.push(`NEW      ${a.id}  in Paper, not in the ledger`)
  for (const r of removed) lines.push(`REMOVED  ${r.id}  ${r.name}  (${r.status}): in the ledger, not in Paper`)
  lines.push(`${changed.length} changed, ${added.length} new, ${removed.length} removed, ${unchanged.length} unchanged`)
  return lines.join('\n')
}

export function artboardNumber(name) {
  const m = /^(?:L · )?([A-Z]?\d+[a-z]?)\b/.exec(name || '')
  return m ? m[1] : '—'
}

function cell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
}

export function renderMarkdown(ledger) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]))
  for (const a of ledger.artboards) counts[a.status] = (counts[a.status] || 0) + 1
  const out = [
    '# Paper design ledger',
    '',
    '<!-- Generated from paper-ledger.json by `node scripts/paper-ledger.mjs --md`. Do not edit by hand. -->',
    '',
    `Paper file \`${ledger.file.id}\` (${ledger.file.name}). Rules: [README.md](./README.md). Check procedure: [scripts/paper-ledger-check.md](../../scripts/paper-ledger-check.md).`,
    '',
    `**${ledger.artboards.length} artboards** · ${STATUSES.map((s) => `${s}: ${counts[s]}`).join(' · ')}`,
    '',
  ]
  const pages = [...ledger.pages]
  const extra = [...new Set(ledger.artboards.map((a) => a.page))].filter((p) => !pages.some((x) => x.id === p))
  for (const id of extra) pages.push({ id, name: id === null ? 'Unassigned (new in Paper)' : id })
  for (const page of pages) {
    const rows = ledger.artboards.filter((a) => a.page === page.id)
    if (!rows.length) continue
    out.push(`## ${page.name}${page.id ? ` (\`${page.id}\`)` : ''}`, '')
    out.push('| # | name | id | theme | route | status | notes |', '|---|---|---|---|---|---|---|')
    for (const a of rows) {
      const route = a.route ? `\`${a.route}\`` : '—'
      out.push(
        `| ${cell(artboardNumber(a.name))} | ${cell(a.name)} | \`${a.id}\` | ${cell(a.theme)} | ${route} | ${a.status} | ${cell(a.notes)} |`,
      )
    }
    out.push('')
  }
  return out.join('\n')
}
