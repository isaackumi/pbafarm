import type { AutomationCondition, ConditionValue } from './validators'

/**
 * The small condition language of automation rules (D-008). Pure functions:
 * no database, no clock, so they are easy to test and safe in any runtime.
 *
 * A rule's context looks like
 *   { payload: {…event data}, check: {…schedule check result},
 *     settings: { farmRules: {…} }, date, userId? }
 * and each condition compares one dotted path with a literal (`value`) or
 * with another path (`valueFrom`, e.g. a company threshold).
 */
export type RunContext = Record<string, unknown>

export function getPath(ctx: unknown, path: string): unknown {
  let cur: unknown = ctx
  for (const part of path.split('.')) {
    if (!part) return undefined
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function asNumber(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x)
  return null
}

function isSet(x: unknown) {
  return x !== undefined && x !== null && x !== ''
}

export function evaluateCondition(c: AutomationCondition, ctx: RunContext): boolean {
  const left = getPath(ctx, c.field)
  if (c.op === 'is_set') return isSet(left)
  if (c.op === 'not_set') return !isSet(left)
  const right: unknown = c.valueFrom ? getPath(ctx, c.valueFrom) : c.value
  if (!isSet(left) || !isSet(right)) return false
  if (c.op === 'eq' || c.op === 'neq') {
    const ln = asNumber(left)
    const rn = asNumber(right)
    const same = ln !== null && rn !== null ? ln === rn : String(left) === String(right)
    return c.op === 'eq' ? same : !same
  }
  // Ordering compares numbers only: a missing or non-numeric reading never
  // trips a threshold (e.g. no DO measured is not "DO below 4").
  const ln = asNumber(left)
  const rn = asNumber(right)
  if (ln === null || rn === null) return false
  switch (c.op) {
    case 'gt':
      return ln > rn
    case 'gte':
      return ln >= rn
    case 'lt':
      return ln < rn
    case 'lte':
      return ln <= rn
  }
  return false
}

/** No conditions always match. */
export function evaluateConditions(
  conditions: AutomationCondition[],
  ctx: RunContext,
  match: 'all' | 'any' = 'all',
): boolean {
  if (!conditions.length) return true
  return match === 'any'
    ? conditions.some((c) => evaluateCondition(c, ctx))
    : conditions.every((c) => evaluateCondition(c, ctx))
}

function display(x: unknown): string {
  if (x === undefined || x === null) return ''
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) return ''
    return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100)
  }
  if (typeof x === 'string') return x
  if (typeof x === 'boolean') return x ? 'yes' : 'no'
  return ''
}

/** Replace {{path}} placeholders; unknown paths render as empty text. */
export function renderTemplate(text: string, ctx: RunContext): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => display(getPath(ctx, path)))
}

export const MAX_CONDITIONS = 10
const FIELD_RE = /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)*$/

/** Reject a malformed condition list with a message an admin can act on. */
export function validateConditions(conditions: AutomationCondition[]): string | null {
  if (conditions.length > MAX_CONDITIONS) return `At most ${MAX_CONDITIONS} conditions per rule`
  for (const c of conditions) {
    if (!FIELD_RE.test(c.field)) return `"${c.field}" is not a valid field`
    if (c.valueFrom !== undefined && !FIELD_RE.test(c.valueFrom)) return `"${c.valueFrom}" is not a valid field`
    if (c.op !== 'is_set' && c.op !== 'not_set' && c.value === undefined && !c.valueFrom) {
      return `Condition on ${c.field} needs a value`
    }
    if (['gt', 'gte', 'lt', 'lte'].includes(c.op) && c.value !== undefined && asNumber(c.value as ConditionValue) === null) {
      return `Condition on ${c.field} compares with a number`
    }
  }
  return null
}
