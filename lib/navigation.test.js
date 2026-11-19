import { describe, expect, it } from 'vitest'
import { DEFAULT_SHORTCUTS, MAX_MOBILE_SHORTCUTS, NAV_ITEMS, resolveShortcuts } from './navigation'

const paths = (items) => items.map((item) => item.path)

describe('resolveShortcuts', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(paths(resolveShortcuts(null))).toEqual(DEFAULT_SHORTCUTS)
    expect(paths(resolveShortcuts(undefined))).toEqual(DEFAULT_SHORTCUTS)
  })

  it('keeps the saved order and an empty choice', () => {
    expect(paths(resolveShortcuts(['/sales', '/dashboard']))).toEqual(['/sales', '/dashboard'])
    expect(resolveShortcuts([])).toEqual([])
  })

  it('drops pages the member may not open, unknown and repeated paths', () => {
    const can = (permission) => permission !== 'finance.view'
    expect(paths(resolveShortcuts(['/sales', '/gone', '/cages', '/cages', '/tasks'], can))).toEqual([
      '/cages',
      '/tasks',
    ])
  })

  it('stops at the maximum', () => {
    const many = NAV_ITEMS.slice(0, MAX_MOBILE_SHORTCUTS + 2).map((item) => item.path)
    expect(resolveShortcuts(many)).toHaveLength(MAX_MOBILE_SHORTCUTS)
  })

  it('never offers super-admin pages', () => {
    expect(paths(resolveShortcuts(['/admin/admin']))).toEqual([])
  })
})
