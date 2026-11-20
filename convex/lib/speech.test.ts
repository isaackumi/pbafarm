import { describe, expect, it } from 'vitest'
import * as Effect from 'effect/Effect'
import { type FetchFn, fetchLayer } from './effectHttp'
import {
  figureIsUnsure,
  lowConfidenceWords,
  markedTranscript,
  speechAvailable,
  speechConfigFromEnv,
  speechLanguage,
  speechLayer,
  transcribe,
  wordsFromLogprobs,
  wordsFromSegments,
  type SpeechConfig,
  type SpeechLanguage,
} from './speech'

type Step = { status: number; body?: unknown } | { hang: true } | { throws: unknown }

function scripted(steps: Step[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetch: FetchFn = (url, init) => {
    calls.push({ url, init })
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]
    if ('throws' in step) return Promise.reject(step.throws)
    if ('hang' in step) {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    const text = step.body === undefined ? '' : typeof step.body === 'string' ? step.body : JSON.stringify(step.body)
    return Promise.resolve(new Response(text, { status: step.status }))
  }
  return { fetch, calls }
}

const CONFIG: SpeechConfig = {
  whisper: { apiKey: 'sk-secret', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' },
  khaya: { apiKey: 'khaya-secret', url: 'https://khaya.test/asr/v1/transcribe' },
}
const fast = { timeoutMs: 50, retries: 2, retryBaseDelayMs: 1 }
const OGG = { bytes: new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0]), mime: 'audio/ogg' }

function run(language: SpeechLanguage, fetch: FetchFn, config = CONFIG) {
  const layer = speechLayer(language, config, { policy: fast })
  if (!layer) throw new Error('no layer')
  return Effect.runPromise(Effect.result(transcribe(OGG, language).pipe(Effect.provide(layer), Effect.provide(fetchLayer(fetch)))))
}

const VERBOSE = {
  text: 'Cage C7 fed 42 kg, B12 thirty kg',
  language: 'english',
  segments: [
    { text: 'Cage C7 fed 42 kg,', avg_logprob: -0.1 },
    { text: 'B12 thirty kg', avg_logprob: -1.2 },
  ],
}

describe('BOT-005 speech adapter: Whisper', () => {
  it('sends a multipart upload with model and language, and returns words with confidence', async () => {
    const { fetch, calls } = scripted([{ status: 200, body: VERBOSE }])
    const r = await run('en', fetch)
    expect(r._tag).toBe('Success')
    if (r._tag !== 'Success') return
    expect(r.success.text).toBe(VERBOSE.text)
    expect(r.success.vendor).toBe('whisper')
    expect(r.success.words[0]).toMatchObject({ text: 'Cage' })
    expect(r.success.words[0].confidence).toBeCloseTo(Math.exp(-0.1))
    expect(lowConfidenceWords(r.success.words)).toEqual(['B12', 'thirty', 'kg'])
    expect(calls[0].url).toBe('https://api.openai.com/v1/audio/transcriptions')
    const body = calls[0].init?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('model')).toBe('whisper-1')
    expect(body.get('language')).toBe('en')
    expect(body.get('response_format')).toBe('verbose_json')
    expect((body.get('file') as File).type).toBe('audio/ogg')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret')
  })

  it('reads token logprobs from the gpt-4o transcribe models', async () => {
    const { fetch, calls } = scripted([
      {
        status: 200,
        body: { text: 'A1 30', logprobs: [{ token: 'A', logprob: -0.01 }, { token: '1', logprob: -0.01 }, { token: ' 30', logprob: -2 }] },
      },
    ])
    const r = await run('fr', fetch, { ...CONFIG, whisper: { ...CONFIG.whisper!, model: 'gpt-4o-mini-transcribe' } })
    expect(r._tag).toBe('Success')
    if (r._tag === 'Success') expect(lowConfidenceWords(r.success.words)).toEqual(['30'])
    const body = calls[0].init?.body as FormData
    expect(body.get('response_format')).toBe('json')
    expect(body.get('include[]')).toBe('logprobs')
  })

  it('a 4xx is not retried and never echoes the key', async () => {
    const { fetch, calls } = scripted([{ status: 401, body: { error: { message: 'bad key sk-secret' } } }])
    const r = await run('en', fetch)
    expect(calls).toHaveLength(1)
    expect(r._tag).toBe('Failure')
    if (r._tag === 'Failure') {
      expect(r.failure).toMatchObject({ _tag: 'SpeechError', reason: 'rejected', status: 401 })
      expect(r.failure.message).not.toContain('sk-secret')
    }
  })

  it('a 5xx is retried, then succeeds', async () => {
    const { fetch, calls } = scripted([{ status: 503 }, { status: 502 }, { status: 200, body: VERBOSE }])
    const r = await run('en', fetch)
    expect(r._tag).toBe('Success')
    expect(calls).toHaveLength(3)
  })

  it('a timeout is retried and then reported as unavailable', async () => {
    const { fetch, calls } = scripted([{ hang: true }])
    const r = await run('en', fetch)
    expect(calls).toHaveLength(3)
    expect(r._tag).toBe('Failure')
    if (r._tag === 'Failure') expect(r.failure).toMatchObject({ reason: 'unavailable' })
  })

  it('a body that does not match the schema is a decode failure (not retried)', async () => {
    const { fetch, calls } = scripted([{ status: 200, body: { transcript: 'no text field' } }])
    const r = await run('en', fetch)
    expect(calls).toHaveLength(1)
    expect(r._tag).toBe('Failure')
    if (r._tag === 'Failure') expect(r.failure).toMatchObject({ reason: 'decode' })
  })
})

describe('BOT-005 speech adapter: Khaya (test double for the unconfirmed API)', () => {
  it('posts the raw audio with the language and reads a plain string or {text}', async () => {
    const a = scripted([{ status: 200, body: JSON.stringify('C-07 aduane kilo aduanan mmienu') }])
    const r = await run('tw', a.fetch)
    expect(r._tag).toBe('Success')
    if (r._tag === 'Success') expect(r.success).toMatchObject({ vendor: 'khaya', language: 'tw', text: 'C-07 aduane kilo aduanan mmienu' })
    expect(a.calls[0].url).toBe('https://khaya.test/asr/v1/transcribe?language=tw')
    expect((a.calls[0].init?.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe('khaya-secret')
    expect(a.calls[0].init?.body).toBeInstanceOf(Uint8Array)

    const b = scripted([{ status: 200, body: { text: 'Ewe text' } }])
    const r2 = await run('ee', b.fetch)
    expect(r2._tag === 'Success' && r2.success.text).toBe('Ewe text')
  })

  it('4xx is not retried; 5xx is; empty text is a decode failure', async () => {
    const a = scripted([{ status: 400 }])
    expect((await run('gaa', a.fetch))._tag).toBe('Failure')
    expect(a.calls).toHaveLength(1)
    const b = scripted([{ status: 500 }, { status: 200, body: { text: 'ok' } }])
    expect((await run('gaa', b.fetch))._tag).toBe('Success')
    expect(b.calls).toHaveLength(2)
    const c = scripted([{ status: 200, body: { text: '' } }])
    const r = await run('gaa', c.fetch)
    expect(r._tag === 'Failure' && r.failure.reason).toBe('decode')
  })
})

describe('BOT-005 speech config and helpers', () => {
  it('needs a key per vendor; Khaya also needs its https URL', () => {
    expect(speechConfigFromEnv({})).toEqual({ whisper: null, khaya: null })
    const c = speechConfigFromEnv({ SPEECH_OPENAI_API_KEY: 'k', KHAYA_API_KEY: 'k2' })
    expect(c.whisper).toMatchObject({ baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' })
    expect(c.khaya).toBeNull()
    expect(speechAvailable('en', c)).toBe(true)
    expect(speechAvailable('tw', c)).toBe(false)
    expect(speechLayer('tw', c)).toBeNull()
    expect(speechConfigFromEnv({ KHAYA_API_KEY: 'k', KHAYA_ASR_URL: 'http://insecure.test' }).khaya).toBeNull()
    expect(speechConfigFromEnv({ SPEECH_OPENAI_API_KEY: 'k', SPEECH_OPENAI_BASE_URL: 'ftp://x' }).whisper).toBeNull()
  })

  it('language: VOICE setting, then account locale, then English', () => {
    expect(speechLanguage('tw', 'fr')).toBe('tw')
    expect(speechLanguage(undefined, 'fr-FR')).toBe('fr')
    expect(speechLanguage(undefined, 'ak')).toBe('tw')
    expect(speechLanguage('ewe', null)).toBe('ee')
    expect(speechLanguage('ga', null)).toBe('gaa')
    expect(speechLanguage(undefined, undefined)).toBe('en')
  })

  it('marks unsure words for the agent and spots unsure figures', () => {
    expect(markedTranscript('B12 30 kg, A1 5 kg', ['30', 'B12'])).toBe('[?B12?] [?30?] kg, A1 5 kg')
    expect(figureIsUnsure(['30', 'kg'], 30)).toBe(true)
    expect(figureIsUnsure(['30'], 5)).toBe(false)
    expect(wordsFromSegments([{ text: 'a b', avg_logprob: null }])).toEqual([{ text: 'a' }, { text: 'b' }])
    expect(wordsFromLogprobs([{ token: 'he', logprob: 0 }, { token: 'llo', logprob: 0 }]).map((w) => w.text)).toEqual(['hello'])
  })
})
