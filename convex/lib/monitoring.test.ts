import { describe, expect, test, vi } from 'vitest'
import { buildEnvelope, parseDsn, reportError, withErrorReporting } from './monitoring'
import { userError } from './errors'

const DSN = 'https://pub123@o1.ingest.sentry.io/4507'

function fakeFetch(status = 200) {
  const calls: Array<{ url: string; body: string }> = []
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body) })
    return new Response(null, { status })
  })
  return { calls, impl }
}

describe('error monitoring', () => {
  test('parses a DSN into the envelope endpoint; rejects junk', () => {
    expect(parseDsn(DSN)?.envelopeUrl).toBe('https://o1.ingest.sentry.io/api/4507/envelope/?sentry_key=pub123&sentry_version=7')
    expect(parseDsn('https://k@host.example/prefix/9')?.envelopeUrl).toContain('/prefix/api/9/envelope/')
    expect(parseDsn('')).toBeNull()
    expect(parseDsn('not a url')).toBeNull()
    expect(parseDsn('https://host.example/9')).toBeNull()
  })

  test('the envelope carries type, message and context, nothing else', () => {
    const [header, item, event] = buildEnvelope(parseDsn(DSN)!, new TypeError('boom'), { transaction: '/cages' }).split('\n')
    expect(JSON.parse(header)).toMatchObject({ dsn: DSN })
    expect(JSON.parse(item)).toEqual({ type: 'event' })
    expect(JSON.parse(event)).toMatchObject({
      transaction: '/cages',
      exception: { values: [{ type: 'TypeError', value: 'boom' }] },
    })
  })

  test('no DSN, or a user error: nothing is sent', async () => {
    const f = fakeFetch()
    expect(await reportError(undefined, new Error('x'), {}, f.impl)).toBe(false)
    expect(await reportError(DSN, userError('VALIDATION', 'bad date'), {}, f.impl)).toBe(false)
    expect(f.calls).toHaveLength(0)
    expect(await reportError(DSN, new Error('x'), {}, f.impl)).toBe(true)
    expect(f.calls).toHaveLength(1)
  })

  test('a failing endpoint never throws', async () => {
    const throwing = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await reportError(DSN, new Error('x'), {}, throwing)).toBe(false)
    expect(await reportError(DSN, new Error('x'), {}, fakeFetch(500).impl)).toBe(false)
  })

  test('the action wrapper rethrows the original error unchanged', async () => {
    const original = new Error('kaboom')
    await expect(
      withErrorReporting('mod:fn', async () => {
        throw original
      }),
    ).rejects.toBe(original)
    expect(await withErrorReporting('mod:fn', async () => 2)).toBe(2)
  })
})
