import { afterEach, describe, expect, test, vi } from 'vitest'
import { ADAPTERS } from './index'
import { SEND_TIMEOUT_MS } from './send'
import type { ChannelConfig, Credentials, ProviderAdapter, SendInput } from './types'

/**
 * PLAT-007: the Effect-based adapters keep their results and messages, and add
 * retry for transient failures (5xx, connection errors), a per-attempt
 * timeout, and Schema-checked responses. Request shapes are covered in
 * convex/messaging.test.ts.
 */

type Case = {
  adapter: ProviderAdapter
  input: SendInput
  creds: Credentials
  config: ChannelConfig
  success: { status: number; body: unknown }
  messageId: string
  /** 4xx body and the exact error the adapter reported before PLAT-007. */
  rejected: { status: number; body: unknown; error: string }
}

const sms: SendInput = { to: '+233244123456', body: 'Hello', channel: 'sms' }
const wa: SendInput = { to: '+233244123456', body: 'Code 123456', channel: 'whatsapp', otpCode: '123456' }

const CASES: Case[] = [
  {
    adapter: ADAPTERS.hubtel,
    input: sms,
    creds: { clientId: 'id', clientSecret: 'secret' },
    config: { senderId: 'PBAFarm', settings: {} },
    success: { status: 201, body: { messageId: 'h-1', status: 0 } },
    messageId: 'h-1',
    rejected: { status: 401, body: { message: 'Unauthorized' }, error: 'HTTP 401: {"message":"Unauthorized"}' },
  },
  {
    adapter: ADAPTERS.africastalking,
    input: sms,
    creds: { apiKey: 'k' },
    config: { settings: { username: 'farm' } },
    success: {
      status: 201,
      body: { SMSMessageData: { Message: 'Sent', Recipients: [{ statusCode: 101, status: 'Success', messageId: 'at-1' }] } },
    },
    messageId: 'at-1',
    rejected: { status: 401, body: 'The supplied authentication is invalid', error: 'HTTP 401: The supplied authentication is invalid' },
  },
  {
    adapter: ADAPTERS.twilio,
    input: sms,
    creds: { accountSid: 'AC1', authToken: 't' },
    config: { senderId: '+15550001111', settings: {} },
    success: { status: 201, body: { sid: 'SM1' } },
    messageId: 'SM1',
    rejected: { status: 400, body: { code: 21211, message: "Invalid 'To' Phone Number" }, error: "Twilio 21211: Invalid 'To' Phone Number" },
  },
  {
    adapter: ADAPTERS.twilio_whatsapp,
    input: wa,
    creds: { accountSid: 'AC1', authToken: 't' },
    config: { senderId: '+15550001111', settings: {} },
    success: { status: 201, body: { sid: 'SM2' } },
    messageId: 'SM2',
    rejected: { status: 401, body: { code: 20003, message: 'Authenticate' }, error: 'Twilio 20003: Authenticate' },
  },
  {
    adapter: ADAPTERS.whatsapp_cloud,
    input: wa,
    creds: { accessToken: 'EAAG' },
    config: { settings: { phoneNumberId: '1055', templateName: 'pba_login' } },
    success: { status: 200, body: { messages: [{ id: 'wamid.1' }] } },
    messageId: 'wamid.1',
    rejected: {
      status: 400,
      body: { error: { code: 131030, message: 'Recipient phone number not in allowed list' } },
      error: 'WhatsApp 131030: Recipient phone number not in allowed list',
    },
  },
  {
    adapter: ADAPTERS.resend,
    input: { to: 'a@b.com', body: 'Hi', channel: 'email' },
    creds: { apiKey: 're_1' },
    config: { senderId: 'Farm <x@farm.com>', settings: {} },
    success: { status: 200, body: { id: 'em-1' } },
    messageId: 'em-1',
    rejected: {
      status: 422,
      body: { name: 'validation_error', message: 'Invalid `from` field.' },
      error: 'Resend validation_error: Invalid `from` field.',
    },
  },
]

function respond(status: number, body: unknown) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(text, { status })
}

/** Fetch that returns each scripted step in order (last one repeats). */
function scripted(...steps: Array<{ status: number; body?: unknown } | Error | 'hang'>) {
  let i = 0
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const step = steps[Math.min(i, steps.length - 1)]
    i += 1
    if (step === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }
    if (step instanceof Error) throw step
    return respond(step.status, step.body)
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe.each(CASES)('$adapter.id', (c) => {
  /** Runs the send on fake timers so retry backoff does not slow the suite. */
  const send = async (fetchMock: ReturnType<typeof scripted>) => {
    vi.useFakeTimers()
    const pending = c.adapter.send(c.input, c.creds, c.config, fetchMock as unknown as typeof fetch)
    await vi.advanceTimersByTimeAsync(60_000)
    return pending
  }

  test('success returns the provider message id', async () => {
    const fetchMock = scripted(c.success)
    expect(await send(fetchMock)).toEqual({ ok: true, providerMessageId: c.messageId })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('5xx is retried, then succeeds', async () => {
    const fetchMock = scripted({ status: 503, body: 'busy' }, { status: 502 }, c.success)
    expect(await send(fetchMock)).toEqual({ ok: true, providerMessageId: c.messageId })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('5xx on every attempt reports the same message as before, retryable', async () => {
    const fetchMock = scripted({ status: 500, body: 'upstream   down' })
    expect(await send(fetchMock)).toEqual({ ok: false, error: 'HTTP 500: upstream down', retryable: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('4xx is not retried and keeps the provider message', async () => {
    const fetchMock = scripted(c.rejected)
    expect(await send(fetchMock)).toEqual({ ok: false, error: c.rejected.error, retryable: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('429 is not retried here but is reported retryable', async () => {
    const fetchMock = scripted({ status: 429, body: 'slow down' })
    expect(await send(fetchMock)).toEqual({ ok: false, error: 'HTTP 429: slow down', retryable: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('connection errors are retried', async () => {
    const fetchMock = scripted(new TypeError('fetch failed'), c.success)
    expect(await send(fetchMock)).toEqual({ ok: true, providerMessageId: c.messageId })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('persistent connection errors keep the old "Network error" result', async () => {
    const fetchMock = scripted(new Error('getaddrinfo ENOTFOUND'))
    expect(await send(fetchMock)).toEqual({ ok: false, error: 'Network error: getaddrinfo ENOTFOUND', retryable: true })
  })

  test('a hung provider times out, is aborted, and is NOT re-sent', async () => {
    const fetchMock = scripted('hang', c.success)
    const result = await send(fetchMock)
    expect(result).toEqual({
      ok: false,
      error: `Network error: no response within ${SEND_TIMEOUT_MS / 1000} s`,
      retryable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
  })
})

describe('response validation', () => {
  test('Hubtel: a 2xx without JSON is still accepted (as before), with no id', async () => {
    const result = await ADAPTERS.hubtel.send(
      sms, { clientId: 'id', clientSecret: 's' }, { senderId: 'X', settings: {} },
      scripted({ status: 200, body: 'OK' }) as unknown as typeof fetch,
    )
    expect(result).toEqual({ ok: true, providerMessageId: undefined })
  })

  test('a message id of the wrong type is dropped instead of passed on', async () => {
    const result = await ADAPTERS.resend.send(
      { to: 'a@b.com', body: 'Hi', channel: 'email' }, { apiKey: 'k' }, { senderId: 'x@y.z', settings: {} },
      scripted({ status: 200, body: { id: 42 } }) as unknown as typeof fetch,
    )
    expect(result).toEqual({ ok: true, providerMessageId: undefined })
  })

  test("Africa's Talking: a 201 without recipients is a non-retryable failure", async () => {
    const result = await ADAPTERS.africastalking.send(
      sms, { apiKey: 'k' }, { settings: { username: 'farm' } },
      scripted({ status: 201, body: { SMSMessageData: { Message: 'InvalidSenderId' } } }) as unknown as typeof fetch,
    )
    expect(result).toEqual({ ok: false, error: 'Not sent: InvalidSenderId', retryable: false })
  })

  test('a throw while building the request is reported, never thrown', async () => {
    // btoa rejects characters outside Latin-1.
    const fetchMock = scripted({ status: 201, body: {} })
    const result = await ADAPTERS.hubtel.send(
      sms, { clientId: 'id', clientSecret: 'sécret✓' }, { settings: {} }, fetchMock as unknown as typeof fetch,
    )
    expect(result).toMatchObject({ ok: false, retryable: true })
    expect((result as { error: string }).error).toMatch(/^Network error: /)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
