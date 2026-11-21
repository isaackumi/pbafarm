import { describe, expect, it } from 'vitest'
import { DEFAULT_SHORTCUTS, MAX_MOBILE_SHORTCUTS, NAV_ITEMS, activeTabPath, resolveShortcuts } from './navigation'

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

describe('phone tab bar (Paper 54/55)', () => {
  it('defaults to Home, Tasks, Scan, Cages', () => {
    expect(paths(resolveShortcuts(null))).toEqual(['/dashboard', '/tasks', '/scan', '/cages'])
  })

  it('marks the current tab, daily entry under Tasks and / under Home', () => {
    const tabs = resolveShortcuts(null)
    expect(activeTabPath(tabs, '/scan')).toBe('/scan')
    expect(activeTabPath(tabs, '/cages/[id]')).toBe('/cages')
    expect(activeTabPath(tabs, '/daily-entry')).toBe('/tasks')
    expect(activeTabPath(tabs, '/tasks')).toBe('/tasks')
    expect(activeTabPath(tabs, '/')).toBe('/dashboard')
    expect(activeTabPath(tabs, '/dashboard')).toBe('/dashboard')
    expect(activeTabPath(tabs, '/sales')).toBeNull()
  })

  it('a custom bar with its own Daily entry tab marks that tab, not Tasks', () => {
    const tabs = resolveShortcuts(['/tasks', '/daily-entry'])
    expect(activeTabPath(tabs, '/daily-entry')).toBe('/daily-entry')
    expect(activeTabPath(resolveShortcuts(['/sales']), '/daily-entry')).toBeNull()
  })
})
