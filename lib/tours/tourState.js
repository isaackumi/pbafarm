/**
 * Tour progress in browser storage. Kept apart from tourEngine.js so the app
 * shell can check "is a tour running?" without loading driver.js (MOBILE-008).
 */

export const SYSTEM_WALKTHROUGH_ID = 'system-walkthrough'

const STORAGE_KEY = 'pbafarm:tour:v1'
const COMPLETED_KEY = 'pbafarm:tour:completed'

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
