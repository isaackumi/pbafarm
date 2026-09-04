/**
 * Multi-page Driver.js tour engine (one step at a time).
 * Steps may include `route` — we navigate, persist index, and resume on the next page.
 */

import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

const STORAGE_KEY = 'pbafarm:tour:v1'
const COMPLETED_KEY = 'pbafarm:tour:completed'

let activeDriver = null
let navigateFn = null
let catalogRef = null

export function setTourNavigator(fn) {
  navigateFn = fn
}

export function setTourCatalog(catalog) {
  catalogRef = catalog
}

export function getTourState() {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setTourState(state) {
  if (typeof window === 'undefined') return
  try {
    if (!state) sessionStorage.removeItem(STORAGE_KEY)
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export function clearTourState() {
  setTourState(null)
}

export function destroyActiveTour() {
  if (activeDriver) {
    try {
      activeDriver.destroy()
    } catch {
      // ignore
    }
    activeDriver = null
  }
}

export function hasCompletedTour(tourId) {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(COMPLETED_KEY) === tourId
  } catch {
    return false
  }
}

export function markTourCompleted(tourId) {
  try {
    localStorage.setItem(COMPLETED_KEY, tourId)
  } catch {
    // ignore
  }
}

function expandSidebarForTour() {
  document.querySelectorAll('[data-tour-section][aria-expanded="false"]').forEach((btn) => {
    try {
      btn.click()
    } catch {
      // ignore
    }
  })
}

/**
 * Tour copy helpers: **bold** and ==highlight== (or raw HTML).
 */
export function formatTourDescription(text) {
  if (!text) return ''
  if (/<[a-z][\s\S]*>/i.test(text)) return text
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="tour-em">$1</strong>')
    .replace(/==(.+?)==/g, '<mark class="tour-mark">$1</mark>')
}

function waitForElement(selector, timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!selector) {
      resolve(true)
      return
    }
    if (document.querySelector(selector)) {
      resolve(true)
      return
    }
    const start = Date.now()
    const timer = setInterval(() => {
      if (document.querySelector(selector)) {
        clearInterval(timer)
        resolve(true)
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        resolve(false)
      }
    }, 80)
  })
}

function pathMatches(route) {
  if (!route) return true
  const path = window.location.pathname
  return path === route || path.startsWith(`${route}/`)
}

function goTo(route) {
  if (typeof navigateFn === 'function') navigateFn(route)
  else window.location.assign(route)
}

/**
 * Start or continue a named tour from the catalog.
 */
export async function startTour(tourId, startIndex = 0) {
  if (typeof window === 'undefined') return
  const def = catalogRef?.[tourId]
  if (!def?.steps?.length) {
    console.warn('[tour] Unknown tour', tourId)
    return
  }

  destroyActiveTour()
  setTourState({
    tourId,
    index: startIndex,
    total: def.steps.length,
    active: true,
  })
  await showCurrentStep()
}

async function showCurrentStep() {
  const state = getTourState()
  if (!state?.active || !catalogRef) return

  const def = catalogRef[state.tourId]
  if (!def) {
    clearTourState()
    return
  }

  const steps = def.steps
  let index = state.index ?? 0
  if (index < 0) index = 0
  if (index >= steps.length) {
    markTourCompleted(state.tourId)
    clearTourState()
    destroyActiveTour()
    return
  }

  const step = steps[index]

  if (step.route && !pathMatches(step.route)) {
    setTourState({ ...state, index, active: true, navigating: true })
    goTo(step.route)
    return
  }

  expandSidebarForTour()
  // Brief settle after navigation / expand
  await new Promise((r) => setTimeout(r, 120))
  const found = await waitForElement(step.element)
  const element = found && step.element ? step.element : undefined

  destroyActiveTour()

  const isFirst = index === 0
  const isLast = index >= steps.length - 1

  activeDriver = driver({
    showProgress: true,
    animate: true,
    allowClose: true,
    overlayOpacity: 0.55,
    stagePadding: 10,
    stageRadius: 12,
    popoverOffset: 12,
    popoverClass: 'pbafarm-tour-popover',
    nextBtnText: isLast ? 'Finish →' : 'Next →',
    prevBtnText: '← Back',
    doneBtnText: 'Finish',
    progressText: `${index + 1} of ${steps.length}`,
    steps: [
      {
        element,
        popover: {
          title: step.popover?.title || def.title,
          description: formatTourDescription(step.popover?.description || ''),
          side: step.popover?.side || 'bottom',
          align: step.popover?.align || 'start',
          showButtons: isFirst
            ? ['next', 'close']
            : ['next', 'previous', 'close'],
          onNextClick: (_el, _s, { driver: d }) => {
            d.destroy()
            activeDriver = null
            if (isLast) {
              markTourCompleted(state.tourId)
              clearTourState()
              return
            }
            setTourState({
              tourId: state.tourId,
              index: index + 1,
              total: steps.length,
              active: true,
            })
            showCurrentStep()
          },
          onPrevClick: (_el, _s, { driver: d }) => {
            if (isFirst) return
            d.destroy()
            activeDriver = null
            setTourState({
              tourId: state.tourId,
              index: index - 1,
              total: steps.length,
              active: true,
            })
            showCurrentStep()
          },
          onCloseClick: (_el, _s, { driver: d }) => {
            clearTourState()
            d.destroy()
            activeDriver = null
          },
        },
      },
    ],
  })

  // Clear navigating flag
  setTourState({
    tourId: state.tourId,
    index,
    total: steps.length,
    active: true,
  })

  activeDriver.drive(0)
}

/**
 * Call after client route changes (Layout / TourProvider).
 */
export async function resumeTourIfNeeded() {
  const state = getTourState()
  if (!state?.active || !state.tourId) return
  if (document.querySelector('.driver-popover')) return
  await showCurrentStep()
}
