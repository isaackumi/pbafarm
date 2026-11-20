import { afterEach, describe, expect, it } from 'vitest'
import {
  getExpandedSections,
  getSidebarScroll,
  resetSidebarState,
  scrollToReveal,
  setExpandedSections,
  setSidebarScroll,
} from './sidebarState'

afterEach(() => resetSidebarState())

describe('sidebar state across page remounts', () => {
  it('remembers the scroll offset', () => {
    expect(getSidebarScroll()).toBe(0)
    setSidebarScroll(420)
    expect(getSidebarScroll()).toBe(420)
    setSidebarScroll(-5)
    expect(getSidebarScroll()).toBe(0)
    setSidebarScroll(Number.NaN)
    expect(getSidebarScroll()).toBe(0)
  })

  it('uses the fallback until a group is toggled, then remembers it', () => {
    expect(getExpandedSections({ production: true })).toEqual({ production: true })
    setExpandedSections({ production: false, finance: true })
    expect(getExpandedSections({ production: true })).toEqual({ production: false, finance: true })
  })

  it('returns copies so callers cannot mutate the store', () => {
    setExpandedSections({ finance: true })
    const got = getExpandedSections({})
    got.finance = false
    expect(getExpandedSections({})).toEqual({ finance: true })
  })
})

describe('scrollToReveal', () => {
  const view = { viewHeight: 500 }
  it('keeps the offset when the item is visible', () => {
    expect(scrollToReveal({ ...view, scrollTop: 300, itemTop: 400, itemBottom: 440 })).toBe(300)
  })
  it('scrolls down to an item below the fold', () => {
    expect(scrollToReveal({ ...view, scrollTop: 0, itemTop: 700, itemBottom: 740 })).toBe(256)
  })
  it('scrolls up to an item above the fold', () => {
    expect(scrollToReveal({ ...view, scrollTop: 600, itemTop: 100, itemBottom: 140 })).toBe(84)
  })
  it('never goes below zero', () => {
    expect(scrollToReveal({ ...view, scrollTop: 50, itemTop: 4, itemBottom: 40 })).toBe(0)
  })
})

describe('collapsed rail', () => {
  it('peeks false before anything is known, then the remembered value', async () => {
    const { peekSidebarCollapsed, setSidebarCollapsed } = await import('./sidebarState')
    expect(peekSidebarCollapsed()).toBe(false)
    setSidebarCollapsed(true)
    expect(peekSidebarCollapsed()).toBe(true)
  })
})
