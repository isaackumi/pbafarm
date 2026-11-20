/**
 * Pure helpers for the active organization (farm) indicator, switcher and
 * the post-sign-in farm chooser. No React, no Convex: unit-tested.
 */
import { safeNextPath } from './safeRedirect'

/** sessionStorage key: the farm chooser was shown (or skipped) for this sign-in. */
export const ORG_CHOSEN_KEY = 'anowa:orgChosen'

export const CHOOSER_PATH = '/choose-organization'

/** Up to two initials for an avatar: "Lake Farm" → "LF", "Volta" → "VO". */
export function orgInitials(name = '') {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Organizations a member can switch into (approved companies). */
export function switchableOrgs(orgs) {
  return (orgs || []).filter((o) => o.companyStatus === 'approved')
}

/** Split listMine into the active org and the others. */
export function splitOrgs(orgs) {
  const list = orgs || []
  const active = list.find((o) => o.isActive) || null
  const others = list.filter((o) => !o.isActive)
  return { active, others, isMulti: list.length > 1 }
}

/** The chooser is worth showing only with more than one approved farm. */
export function shouldShowChooser(orgs) {
  return switchableOrgs(orgs).length > 1
}

/** Browser tab title: "Cages · Lake Farm", or "Cages · Anowa" without an active org. */
export function documentTitle(pageTitle, farmName) {
  const page = typeof pageTitle === 'string' && pageTitle.trim() ? pageTitle.trim() : 'Anowa'
  const suffix = typeof farmName === 'string' && farmName.trim() ? farmName.trim() : 'Anowa'
  return page === suffix ? page : `${page} · ${suffix}`
}

function readFlag(session) {
  try {
    return session?.getItem(ORG_CHOSEN_KEY) === '1'
  } catch {
    return false
  }
}

/** Remember that this sign-in has picked (or skipped) its farm. */
export function markOrgChosen(session) {
  try {
    session?.setItem(ORG_CHOSEN_KEY, '1')
  } catch {
    // storage blocked: the chooser may show again, which is harmless
  }
}

function browserSession() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Where to go right after signing in: the farm chooser once per sign-in
 * (it passes single-farm members straight through), then `next`.
 */
export function postSignInPath(next, { session = browserSession(), fallback = '/dashboard' } = {}) {
  const target = safeNextPath(next, fallback)
  if (readFlag(session)) return target
  return `${CHOOSER_PATH}?next=${encodeURIComponent(target)}`
}
