/**
 * Organization words (CUSTOM-003, D-007): the labels an organization can
 * rename without code, e.g. Cage → Pen or Harvest → Catch. Stored on the
 * company as a flat key/value record; unknown keys and empty values are
 * dropped, so old or hand-edited data never breaks a screen.
 */
import { userError } from './errors'

export const TERM_KEYS = [
  'unit',
  'unitPlural',
  'cage',
  'cagePlural',
  'pond',
  'pondPlural',
  'tank',
  'tankPlural',
  'raceway',
  'racewayPlural',
  'hatcheryTank',
  'hatcheryTankPlural',
  'incubator',
  'incubatorPlural',
  'hapa',
  'hapaPlural',
  'feed',
  'feedPlural',
  'harvest',
  'harvestPlural',
  'batch',
  'batchPlural',
  'site',
  'sitePlural',
  'stocking',
  'stockingPlural',
  'sampling',
  'samplingPlural',
] as const

export type TermKey = (typeof TERM_KEYS)[number]
export type Terminology = Partial<Record<TermKey, string>>

export const TERM_MAX_LENGTH = 40

const KNOWN = new Set<string>(TERM_KEYS)

/** True for a key the editor and the server both know. */
export function isTermKey(key: string): key is TermKey {
  return KNOWN.has(key)
}

/**
 * Validate input for writing. Unknown keys, non-string values, control
 * characters and over-long labels are refused with a user-facing error.
 */
export function normalizeTerminology(input: unknown): Terminology {
  if (input == null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw userError('VALIDATION', 'Words must be a set of key/value pairs')
  }
  const out: Terminology = {}
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!isTermKey(key)) throw userError('VALIDATION', `Unknown word setting: ${key}`, { field: key })
    if (typeof raw !== 'string') throw userError('VALIDATION', `Word ${key} must be text`, { field: key })
    const value = raw.trim().replace(/\s+/g, ' ')
    if (!value) continue
    if (/[\u0000-\u001f]/.test(value)) {
      throw userError('VALIDATION', `Word ${key} contains a control character`, { field: key })
    }
    if (value.length > TERM_MAX_LENGTH) {
      throw userError('VALIDATION', `Word ${key} is longer than ${TERM_MAX_LENGTH} characters`, { field: key })
    }
    out[key] = value
  }
  return out
}

/** Read stored words defensively: never throws, drops what it does not know. */
export function terminologyOf(
  company: { terminology?: unknown } | null | undefined,
): Terminology {
  const raw = company?.terminology
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Terminology = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isTermKey(key) || typeof value !== 'string') continue
    const text = value.trim().slice(0, TERM_MAX_LENGTH)
    if (text) out[key] = text
  }
  return out
}
