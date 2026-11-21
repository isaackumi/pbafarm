import { describe, expect, it } from 'vitest'
import {
  applyHashes,
  artboardNumber,
  diffLedger,
  formatDiff,
  hashDump,
  jsxFromDumpValue,
  renderMarkdown,
  sha256Hex,
  validateLedger,
} from './paperLedger.mjs'

const entry = (id, jsxHash, extra = {}) => ({
  id,
  name: `${id} name`,
  page: 'p-1-0',
  theme: 'dark',
  width: 1440,
  route: '/x',
  implementation: ['pages/x.js'],
  status: 'built',
  jsxHash,
  hashedAt: '2026-11-01',
  verifiedAt: '2026-11-02',
  notes: '',
  ...extra,
})

async function fixture() {
  const [a, b, c] = await Promise.all(['<div>a</div>', '<div>b</div>', '<div>c</div>'].map(sha256Hex))
  const ledger = {
    file: { id: 'F', name: 'File' },
    pages: [{ id: 'p-1-0', name: 'Desktop' }],
    artboards: [entry('A-0', a), entry('B-0', b), entry('C-0', c)],
  }
  return { ledger, hashes: { a, b, c } }
}

describe('paper ledger', () => {
  it('hashes the JSX text with sha256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('takes the JSX from a raw MCP content array (last block, after the file header)', () => {
    expect(jsxFromDumpValue(['{"file":{}}', '<div/>'])).toBe('<div/>')
    expect(jsxFromDumpValue([{ type: 'text', text: '<div/>' }])).toBe('<div/>')
    expect(() => jsxFromDumpValue(42)).toThrow()
  })

  it('reports CHANGED, NEW and REMOVED artboards', async () => {
    const { ledger, hashes } = await fixture()
    const dump = { 'A-0': '<div>a</div>', 'B-0': '<div>b changed</div>', 'N-0': '<div>new</div>' }
    const diff = diffLedger(ledger, await hashDump(dump))
    expect(diff.unchanged).toEqual(['A-0'])
    expect(diff.changed.map((c) => [c.id, c.from])).toEqual([['B-0', hashes.b]])
    expect(diff.added.map((a) => a.id)).toEqual(['N-0'])
    expect(diff.removed.map((r) => r.id)).toEqual(['C-0'])
    const text = formatDiff(diff)
    expect(text).toMatch(/^CHANGED {2}B-0/m)
    expect(text).toMatch(/^NEW {6}N-0/m)
    expect(text).toMatch(/^REMOVED {2}C-0/m)
    expect(text).toMatch(/1 changed, 1 new, 1 removed, 1 unchanged/)
  })

  it('--write records new hashes, clears verification on changed boards and stubs new ones', async () => {
    const { ledger } = await fixture()
    const hashes = await hashDump({ 'A-0': '<div>a</div>', 'B-0': '<div>b2</div>', 'C-0': '<div>c</div>', 'N-0': '<p/>' })
    const { ledger: next } = applyHashes(ledger, hashes, '2026-11-21')
    const byId = Object.fromEntries(next.artboards.map((a) => [a.id, a]))
    expect(byId['A-0']).toEqual(ledger.artboards[0])
    expect(byId['B-0']).toMatchObject({ jsxHash: hashes['B-0'], hashedAt: '2026-11-21', verifiedAt: null, status: 'built' })
    expect(byId['N-0']).toMatchObject({ status: 'not-built', jsxHash: hashes['N-0'], page: null })
    expect(diffLedger(next, hashes).changed).toEqual([])
    expect(ledger.artboards[1].verifiedAt).toBe('2026-11-02')
    expect(validateLedger(next)).toEqual([])
  })

  it('keeps removed artboards in the ledger on --write', async () => {
    const { ledger, hashes } = await fixture()
    const { ledger: next, diff } = applyHashes(ledger, { 'A-0': hashes.a }, '2026-11-21')
    expect(next.artboards.map((a) => a.id)).toEqual(['A-0', 'B-0', 'C-0'])
    expect(diff.removed.map((r) => r.id)).toEqual(['B-0', 'C-0'])
  })

  it('rejects unknown statuses, bad hashes, duplicates and built entries without files', async () => {
    const { ledger, hashes } = await fixture()
    ledger.artboards.push(
      entry('A-0', hashes.a),
      entry('X-0', 'nope', { status: 'done' }),
      entry('Y-0', hashes.a, { implementation: [] }),
    )
    expect(validateLedger(ledger)).toEqual([
      'A-0: duplicate id',
      'X-0: unknown status "done"',
      'X-0: missing or malformed jsxHash',
      'Y-0: built without implementation files',
    ])
  })

  it('renders a markdown table grouped by page with counts at the top', async () => {
    const { ledger } = await fixture()
    ledger.artboards[1] = { ...ledger.artboards[1], name: '57b Messaging | outbox', status: 'partial', notes: 'no\nfilters' }
    const md = renderMarkdown(ledger)
    expect(md).toContain('built: 2 · partial: 1 · not-built: 0 · proposal: 0 · superseded: 0')
    expect(md).toContain('## Desktop (`p-1-0`)')
    expect(md).toContain('| 57b | 57b Messaging \\| outbox | `B-0` | dark | `/x` | partial | no filters |')
  })

  it('reads the artboard number from its name', () => {
    expect(artboardNumber('01 Home')).toBe('01')
    expect(artboardNumber('57b Messaging & outbox')).toBe('57b')
    expect(artboardNumber('L · 10 Finance P&L')).toBe('10')
    expect(artboardNumber('E1 Sign-in code — Dark')).toBe('E1')
    expect(artboardNumber('_Shell (template)')).toBe('—')
  })
})
