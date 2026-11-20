import { describe, expect, it } from 'vitest'
import {
  assistantRefusal,
  MAX_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_TOTAL_CHARS,
  clampTemperature,
  createRateLimiter,
  validateMessages,
} from './llmProxyGuard'
import { safeNextPath } from './safeRedirect'

describe('validateMessages', () => {
  it('accepts a normal assistant request and strips extra fields', () => {
    const r = validateMessages([
      { role: 'system', content: 'ctx', extra: 1 },
      { role: 'user', content: 'hi' },
    ])
    expect(r.messages).toEqual([
      { role: 'system', content: 'ctx' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('rejects empty, too many, bad roles and oversize content', () => {
    expect(validateMessages([]).error).toBeTruthy()
    expect(validateMessages('x').error).toBeTruthy()
    const many = Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'a' }))
    expect(validateMessages(many).error).toMatch(/Too many/)
    expect(validateMessages([{ role: 'tool', content: 'a' }]).error).toBeTruthy()
    expect(validateMessages([{ role: 'user', content: 5 }]).error).toBeTruthy()
    expect(
      validateMessages([{ role: 'user', content: 'a'.repeat(MAX_MESSAGE_CHARS + 1) }]).error,
    ).toMatch(/too long/)
    const big = 'a'.repeat(MAX_MESSAGE_CHARS)
    const total = Math.ceil(MAX_TOTAL_CHARS / MAX_MESSAGE_CHARS) + 1
    expect(
      validateMessages(Array.from({ length: total }, () => ({ role: 'user', content: big }))).error,
    ).toMatch(/Conversation is too long/)
  })
})

describe('clampTemperature', () => {
  it('clamps and defaults', () => {
    expect(clampTemperature(undefined)).toBe(0.3)
    expect(clampTemperature(5)).toBe(1)
    expect(clampTemperature(-1)).toBe(0)
    expect(clampTemperature(Number.NaN)).toBe(0.3)
  })
})

describe('assistantRefusal (role gate)', () => {
  it('allows only when the company switch is on and the member holds ai.use', () => {
    expect(assistantRefusal({ enabled: true, canUse: true })).toBeNull()
    expect(assistantRefusal({ enabled: true, canUse: false })).toMatch(/role/)
    expect(assistantRefusal({ enabled: true })).toMatch(/role/)
    expect(assistantRefusal({ enabled: false, canUse: true })).toMatch(/disabled/)
    expect(assistantRefusal(null)).toMatch(/disabled/)
  })
})

describe('createRateLimiter', () => {
  it('blocks after the limit and resets after the window', () => {
    let t = 0
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t })
    expect(rl.check('u1').ok).toBe(true)
    expect(rl.check('u1').ok).toBe(true)
    const blocked = rl.check('u1')
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfterSec).toBe(1)
    expect(rl.check('u2').ok).toBe(true)
    t = 1000
    expect(rl.check('u1').ok).toBe(true)
  })
})

describe('safeNextPath (login ?next=)', () => {
  it('keeps same-origin paths', () => {
    expect(safeNextPath('/register-company')).toBe('/register-company')
    expect(safeNextPath('/cages/abc?tab=x#y')).toBe('/cages/abc?tab=x#y')
  })
  it('rejects open redirects', () => {
    for (const bad of [
      '//evil.com',
      '//evil.com/dashboard',
      '/\\evil.com',
      '\\\\evil.com',
      'https://evil.com',
      'javascript:alert(1)',
      '/\t/evil.com',
      ' /dashboard',
      '',
      undefined,
      ['/dashboard'],
    ]) {
      expect(safeNextPath(bad)).toBe('/dashboard')
    }
  })
})
