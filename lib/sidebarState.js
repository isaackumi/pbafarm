// lib/sidebarState.js — sidebar state that outlives page navigation.
//
// Every page renders its own <Layout>, so the sidebar remounts on each route
// change. Without this store the nav jumps back to the top, collapses the
// groups the user opened and forgets the collapsed rail. Values live in
// module memory for the session; the collapsed rail is also remembered across
// reloads in localStorage (best effort: private windows may refuse it).

const COLLAPSED_KEY = 'anowa.sidebar.collapsed'

const state = {
  scrollTop: 0,
  expanded: null,
  collapsed: null,
}

export function getSidebarScroll() {
  return state.scrollTop
}

export function setSidebarScroll(value) {
  state.scrollTop = Number.isFinite(value) && value > 0 ? value : 0
}

/** Groups the user opened or closed, or `fallback` before the first change. */
export function getExpandedSections(fallback) {
  return state.expanded ? { ...state.expanded } : { ...fallback }
}

export function setExpandedSections(value) {
  state.expanded = value ? { ...value } : null
}

/**
 * Collapsed rail as known in memory, without touching storage. Safe as a
 * useState initializer: false on the server and on the first page load (so
 * hydration matches), the remembered value on later client navigations.
 */
export function peekSidebarCollapsed() {
  return state.collapsed ?? false
}

export function getSidebarCollapsed() {
  if (state.collapsed !== null) return state.collapsed
  try {
    state.collapsed = window.localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    state.collapsed = false
  }
  return state.collapsed
}

export function setSidebarCollapsed(value) {
  state.collapsed = !!value
  try {
    window.localStorage.setItem(COLLAPSED_KEY, state.collapsed ? '1' : '0')
  } catch {
    // Storage blocked: the session value above still applies.
  }
}

/**
 * Scroll offset that brings `item` (top/bottom relative to the scroll
 * container's content) into a container of `viewHeight` already scrolled to
 * `scrollTop`, with `margin` breathing room. Returns `scrollTop` unchanged
 * when the item is already fully visible.
 */
export function scrollToReveal({ scrollTop, viewHeight, itemTop, itemBottom, margin = 16 }) {
  if (itemTop - margin < scrollTop) return Math.max(0, itemTop - margin)
  if (itemBottom + margin > scrollTop + viewHeight) return itemBottom + margin - viewHeight
  return scrollTop
}

/** Test helper: forget everything. */
export function resetSidebarState() {
  state.scrollTop = 0
  state.expanded = null
  state.collapsed = null
}
