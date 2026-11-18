import { describe, expect, it } from 'vitest'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import { ConvexError } from 'convex/values'
import { UserFacingError, runEffect, runEffectSync } from './effect'
import { isUserError, userError } from './errors'

class ProviderDown extends Data.TaggedError('ProviderDown')<{ readonly message: string }> {}

describe('runEffect', () => {
  it('returns the success value', async () => {
    await expect(runEffect(Effect.succeed(42))).resolves.toBe(42)
  })

  it('maps UserFacingError to a userError ConvexError', async () => {
    const err = await runEffect(
      Effect.fail(new UserFacingError({ code: 'VALIDATION', message: 'Bad phone', details: { field: 'phone' } })),
    ).catch((e) => e)
    expect(isUserError(err)).toBe(true)
    expect(err.data).toEqual({ code: 'VALIDATION', message: 'Bad phone', details: { field: 'phone' } })
  })

  it('uses toUserError for other typed failures', async () => {
    const err = await runEffect(Effect.fail(new ProviderDown({ message: 'boom' })), {
      toUserError: (e) => userError('CONFLICT', `Provider unavailable: ${e.message}`),
    }).catch((e) => e)
    expect(isUserError(err)).toBe(true)
    expect(err.data.message).toBe('Provider unavailable: boom')
  })

  it('throws a plain Error for unmapped typed failures', async () => {
    const err = await runEffect(Effect.fail(new ProviderDown({ message: 'boom' }))).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ConvexError)
    expect(err.message).toBe('boom')
  })

  it('rethrows a ConvexError thrown inside the program intact', async () => {
    const thrown = userError('NOT_FOUND', 'Cage not found')
    const err = await runEffect(
      Effect.promise(async () => {
        throw thrown
      }),
    ).catch((e) => e)
    expect(err).toBe(thrown)
  })

  it('rethrows defects as the original Error', async () => {
    const boom = new Error('defect')
    const err = await runEffect(
      Effect.sync(() => {
        throw boom
      }),
    ).catch((e) => e)
    expect(err).toBe(boom)
  })
})

describe('runEffectSync', () => {
  it('runs pure programs synchronously', () => {
    const program = Effect.gen(function* () {
      const a = yield* Effect.succeed(2)
      return a * 21
    })
    expect(runEffectSync(program)).toBe(42)
  })

  it('maps failures like runEffect', () => {
    expect(() =>
      runEffectSync(Effect.fail(new UserFacingError({ code: 'CONFLICT', message: 'Cage not active' }))),
    ).toThrowError(ConvexError)
  })

  it('refuses programs that go async (timers) so queries stay deterministic', () => {
    expect(() => runEffectSync(Effect.sleep('1 millis'))).toThrow()
  })
})
