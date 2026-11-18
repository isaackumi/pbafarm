import { describe, expect, it } from 'vitest'
import { ConvexError } from 'convex/values'
import { ERROR_CODES, isUserError, userError } from './errors'
// Client helpers (plain JS) live outside convex/; tested here so CI covers them.
import { errorCode, errorMessage } from '../../lib/errorMessage'
import { cleanError } from '../../lib/offlineOutbox'

describe('userError', () => {
  it('builds a ConvexError carrying code and message', () => {
    const err = userError('DUPLICATE', 'A record for this cage and date already exists.')
    expect(err).toBeInstanceOf(ConvexError)
    expect(err.data).toEqual({
      code: 'DUPLICATE',
      message: 'A record for this cage and date already exists.',
    })
    expect(isUserError(err)).toBe(true)
  })

  it('keeps details when given', () => {
    const err = userError('INSUFFICIENT_STOCK', 'Not enough feed.', { availableKg: 12 })
    expect(err.data.details).toEqual({ availableKg: 12 })
  })

  it('is not confused with plain errors', () => {
    expect(isUserError(new Error('x'))).toBe(false)
    expect(isUserError(new ConvexError('x'))).toBe(false)
  })

  it('lists unique codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})

describe('errorMessage (client)', () => {
  it('prefers ConvexError data.message', () => {
    const err = userError('VALIDATION', 'Feed amount must be positive.')
    expect(errorMessage(err)).toBe('Feed amount must be positive.')
    expect(errorCode(err)).toBe('VALIDATION')
    expect(cleanError(err)).toBe('Feed amount must be positive.')
  })

  it('uses string ConvexError data', () => {
    expect(errorMessage(new ConvexError('Cage is not active'))).toBe('Cage is not active')
  })

  it('strips Convex request noise from plain errors', () => {
    const err = new Error(
      '[CONVEX M(dailyRecords:create)] [Request ID: abc123] Server Error\nUncaught Error: Duplicate record for cage C1\n    at handler (../convex/dailyRecords.ts:241:11)',
    )
    expect(errorMessage(err)).toBe('Duplicate record for cage C1')
    expect(cleanError(err)).toBe('Duplicate record for cage C1')
    expect(errorCode(err)).toBe(null)
  })

  it('falls back when there is nothing to show', () => {
    expect(errorMessage(null)).toBe('Something went wrong')
    expect(errorMessage('Offline')).toBe('Offline')
    expect(errorMessage(undefined, 'Could not load')).toBe('Could not load')
  })
})
