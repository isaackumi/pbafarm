import { describe, expect, it } from 'vitest'
import {
  actionHref,
  actionQuery,
  askHref,
  matchActions,
  matchPages,
  matches,
  moveIndex,
  normalize,
  placeOf,
  recentFromRoute,
  waterHistoryHref,
} from './commandPalette'
import { NAV_ITEMS } from './navigation'

const only = (...perms) => (p) => p == null || perms.includes(p)

describe('normalize / matches', () => {
  it('ignores case and separators', () => {
    expect(normalize('C-07')).toBe('c07')
    expect(matches('c 07', 'Cage C-07')).toBe(true)
    expect(matches('c07', 'C-07')).toBe(true)
    expect(matches('', 'anything')).toBe(false)
    expect(matches('c08', 'C-07')).toBe(false)
  })
})

describe('matchPages', () => {
  it('finds pages by label and respects permissions', () => {
    const all = matchPages('cycle').map((r) => r.item.path)
    expect(all).toContain('/cycle-planner')
    expect(matchPages('cycle', { can: only('production.view') }).map((r) => r.item.path)).not.toContain('/cycle-planner')
  })

  it('includes pages that left the sidebar (Bulk upload, Create cage)', () => {
    expect(matchPages('bulk').map((r) => r.item.path)).toContain('/bulk-upload')
    expect(matchPages('create cage').map((r) => r.item.path)).toContain('/create-cage')
  })

  it('shows a tabbed page when any tab is open', () => {
    expect(matchPages('records', { can: only('production.view') }).map((r) => r.item.path)).toContain('/records')
    expect(matchPages('records', { can: only() }).map((r) => r.item.path)).not.toContain('/records')
  })

  it('ranks prefix matches first and caps the list', () => {
    expect(matchPages('a', { limit: 3 })).toHaveLength(3)
  })
})

describe('placeOf', () => {
  it('names the section and, when it has groups, the group', () => {
    const planner = NAV_ITEMS.find((i) => i.path === '/cycle-planner')
    expect(placeOf(planner)).toBe('Production · Review & plan')
    const sales = NAV_ITEMS.find((i) => i.path === '/sales')
    expect(placeOf(sales)).toBe('Finance')
  })
})

describe('actions', () => {
  it('pre-fills the cage', () => {
    expect(actionHref('water', 'abc')).toBe('/water-entry?cage=abc')
    expect(actionHref('daily', 'abc')).toBe('/daily-entry?cage=abc')
    expect(actionHref('sampling', 'abc')).toBe('/biweekly-entry?cage=abc')
    expect(actionHref('transfer', 'abc')).toBe('/fish-transfers?source=abc')
    expect(actionHref('feed', 'abc')).toBe('/feed-issue?cage=abc')
    expect(actionHref('stock', 'abc')).toBe('/stocking')
    expect(actionHref('nope')).toBeNull()
    expect(waterHistoryHref('C-07')).toBe('/water-quality?q=C-07')
  })

  it('asks Anowa with the question', () => {
    expect(askHref("What's going on with C-07?")).toBe("/assistant?q=What's%20going%20on%20with%20C-07%3F")
    expect(askHref('  ')).toBe('/assistant')
  })

  it('reads the "> action" mode', () => {
    expect(actionQuery('> log water')).toBe('log water')
    expect(actionQuery('>')).toBe('')
    expect(actionQuery('c-07')).toBeNull()
  })

  it('matches actions the member may run', () => {
    expect(matchActions('log water').map((a) => a.key)).toEqual(['water'])
    expect(matchActions('import', { can: only() })).toEqual([])
    expect(matchActions('', { can: only('ai.use') }).map((a) => a.key)).toEqual(['ask'])
  })
})

describe('recentFromRoute', () => {
  it('remembers cages, batches and menu pages', () => {
    expect(recentFromRoute('/cages/[id]', { id: 'c1' })).toEqual({ kind: 'cage', key: 'c1' })
    expect(recentFromRoute('/batches/[id]', { id: 'b1' })).toEqual({ kind: 'batch', key: 'b1' })
    expect(recentFromRoute('/cycle-planner', {})).toEqual({ kind: 'page', key: '/cycle-planner' })
    expect(recentFromRoute('/records/[[...groupTab]]', { groupTab: ['daily'] })).toEqual({ kind: 'page', key: '/records' })
    expect(recentFromRoute('/daily-data', {})).toEqual({ kind: 'page', key: '/records' })
  })

  it('skips pages outside the menu', () => {
    expect(recentFromRoute('/login', {})).toBeNull()
    expect(recentFromRoute('/cages/[id]', {})).toBeNull()
  })
})

describe('moveIndex', () => {
  it('wraps', () => {
    expect(moveIndex(0, -1, 3)).toBe(2)
    expect(moveIndex(2, 1, 3)).toBe(0)
    expect(moveIndex(-1, 1, 3)).toBe(0)
    expect(moveIndex(0, 1, 0)).toBe(-1)
  })
})
