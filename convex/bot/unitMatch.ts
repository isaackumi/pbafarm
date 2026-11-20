/**
 * Matching a unit code read off a handwritten logbook to the member's units
 * (BOT-006). Pure. Stricter than a typed message would need in one way (a
 * match must be unique) and looser in another (common handwriting/OCR
 * confusions and one wrong character are tolerated, at lower confidence).
 *
 * Confidence:
 *   1.0  same name or code (after unitKey normalisation)
 *   0.85 the only unit whose name/code contains what was read
 *   0.8  equal after folding look-alike characters (O/0, I/l/1, S/5, B/8, Z/2, G/6)
 *   0.6  one edit away (keys of 4+ characters), and the only such unit
 * Below MIN_CONFIDENCE, or ambiguous: unmatched, the row is flagged.
 */
import { unitKey } from './scope'

export const MIN_CONFIDENCE = 0.6
/** Under this the draft says what was read, so the worker can check. */
export const CHECK_CONFIDENCE = 0.95

export type MatchableUnit = { _id: string; name: string; code?: string | null }

export type UnitMatch<U> =
  | { unit: U; confidence: number }
  | { unit: null; confidence: 0; candidates: string[] }

const LOOKALIKE: Record<string, string> = { o: '0', i: '1', l: '1', s: '5', b: '8', z: '2', g: '6' }

export function foldLookalikes(key: string): string {
  return key.replace(/[oilsbzg]/g, (c) => LOOKALIKE[c] ?? c)
}

/** Levenshtein distance, capped: returns limit + 1 as soon as it is exceeded. */
export function editDistance(a: string, b: string, limit = 2): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      rowMin = Math.min(rowMin, cur[j])
    }
    if (rowMin > limit) return limit + 1
    prev = cur
  }
  return prev[b.length]
}

function keysOf(u: MatchableUnit): string[] {
  const keys = [unitKey(u.name)]
  if (u.code) keys.push(unitKey(u.code))
  return keys.filter(Boolean)
}

function only<U>(list: U[]): U | null {
  return list.length === 1 ? list[0] : null
}

export function fuzzyMatchUnit<U extends MatchableUnit>(units: U[], read: string): UnitMatch<U> {
  const key = unitKey(read)
  if (!key) return { unit: null, confidence: 0, candidates: [] }
  const exact = units.filter((u) => keysOf(u).includes(key))
  if (exact.length === 1) return { unit: exact[0], confidence: 1 }
  if (exact.length > 1) return { unit: null, confidence: 0, candidates: exact.slice(0, 5).map((u) => u.name) }

  // What was read is part of one unit's name ("A3" → "Cage A3 North"); never the other way round, so "A12" is not "A1".
  const partial = key.length >= 2 ? units.filter((u) => keysOf(u).some((k) => k.includes(key))) : []
  const p = only(partial)
  if (p) return { unit: p, confidence: 0.85 }

  const folded = foldLookalikes(key)
  const look = only(units.filter((u) => keysOf(u).some((k) => foldLookalikes(k) === folded)))
  if (look) return { unit: look, confidence: 0.8 }

  if (key.length >= 4) {
    const near = units.filter((u) => keysOf(u).some((k) => k.length >= 4 && editDistance(foldLookalikes(k), folded, 1) <= 1))
    const n = only(near)
    if (n) return { unit: n, confidence: 0.6 }
    if (near.length > 1) return { unit: null, confidence: 0, candidates: near.slice(0, 5).map((u) => u.name) }
  }
  return { unit: null, confidence: 0, candidates: partial.slice(0, 5).map((u) => u.name) }
}

/**
 * All units ranked by how close they are to what was heard (BOT-005 cage
 * picker), best first, score in [0, 1]. Unlike fuzzyMatchUnit this never
 * refuses: it orders the choices a worker picks from.
 */
export function rankUnits<U extends MatchableUnit>(units: U[], heard: string, limit = 10): Array<{ unit: U; score: number }> {
  const key = unitKey(heard)
  if (!key) return []
  const folded = foldLookalikes(key)
  const digits = key.replace(/\D/g, '')
  const scoreKey = (k: string): number => {
    if (k === key) return 1
    if (key.length >= 2 && k.includes(key)) return 0.85
    if (foldLookalikes(k) === folded) return 0.8
    const fk = foldLookalikes(k)
    const d = editDistance(fk, folded, 3)
    let s = d <= 3 ? Math.max(0, 0.75 - 0.15 * d - 0.02 * Math.abs(fk.length - folded.length)) : 0
    // Same number heard ("cage seven" vs "C-07"): a weak but useful hint.
    if (digits && Number(k.replace(/\D/g, '') || NaN) === Number(digits)) s = Math.max(s, 0.5)
    return s
  }
  return units
    .map((unit) => ({ unit, score: Math.max(0, ...keysOf(unit).map(scoreKey)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.unit.name.localeCompare(b.unit.name))
    .slice(0, limit)
}
