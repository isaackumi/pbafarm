/**
 * Speech to text for farm-bot voice notes (BOT-005, research doc §1.4).
 *
 * One `Speech` service, one Layer per vendor (CLAUDE.md, doc 19):
 * - Whisper: any OpenAI-compatible `POST {base}/audio/transcriptions`
 *   (multipart: file, model, language, response_format). English and French.
 *   `whisper-1` answers `verbose_json` with segments (avg_logprob); the
 *   gpt-4o transcribe models answer `json` with token `logprobs`. Either
 *   becomes per-word confidence.
 * - Khaya ASR (GhanaNLP): Twi, Ewe and Ga. TODO(BOT-005): the request shape
 *   below is NOT confirmed. GhanaNLP's API catalogue (developer.khaya.ai)
 *   needs a signed-in key to read; until someone checks the ASR operation
 *   there, this Layer is only enabled when both KHAYA_API_KEY and
 *   KHAYA_ASR_URL are set, and its behaviour is covered by a test double.
 *
 * Requests go through `requestJsonAs`: a per-attempt timeout, retries on
 * network errors, timeouts and 5xx only, never on 4xx, and a Schema-checked
 * body. Transcription has no side effect besides billing, so retrying is
 * safe. Keys come from Convex env vars and never appear in errors or logs.
 */
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import { Fetch, requestJsonAs, type HttpError, type HttpPolicy } from './effectHttp'

export type SpeechLanguage = 'en' | 'fr' | 'tw' | 'ee' | 'gaa'
export const SPEECH_LANGUAGES: readonly SpeechLanguage[] = ['en', 'fr', 'tw', 'ee', 'gaa']

export type Word = { readonly text: string; readonly confidence?: number }

export type Transcript = {
  readonly text: string
  readonly language: SpeechLanguage
  readonly words: readonly Word[]
  readonly vendor: 'whisper' | 'khaya'
  readonly model: string
}

export type AudioInput = { readonly bytes: Uint8Array; readonly mime: string }

export type SpeechFailure = 'rejected' | 'unavailable' | 'decode' | 'unsupported_language'

export class SpeechError extends Data.TaggedError('SpeechError')<{
  readonly reason: SpeechFailure
  readonly status?: number
  readonly message: string
}> {}

export interface SpeechApi {
  readonly vendor: 'whisper' | 'khaya'
  readonly transcribe: (audio: AudioInput, language: SpeechLanguage) => Effect.Effect<Transcript, SpeechError>
}

export class Speech extends Context.Service<Speech, SpeechApi>()('anowa/Speech') {}

// ---------------------------------------------------------------------------
// Configuration

export type WhisperConfig = { readonly apiKey: string; readonly baseUrl: string; readonly model: string }
export type KhayaConfig = { readonly apiKey: string; readonly url: string }
export type SpeechConfig = { readonly whisper: WhisperConfig | null; readonly khaya: KhayaConfig | null }

export const SPEECH_ENV = {
  openaiKey: 'SPEECH_OPENAI_API_KEY',
  openaiBaseUrl: 'SPEECH_OPENAI_BASE_URL',
  openaiModel: 'SPEECH_OPENAI_MODEL',
  khayaKey: 'KHAYA_API_KEY',
  khayaUrl: 'KHAYA_ASR_URL',
} as const

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'

function httpsUrl(raw: string | undefined): string | null {
  const value = (raw ?? '').trim().replace(/\/+$/, '')
  if (!value) return null
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password ? value : null
  } catch {
    return null
  }
}

/** Which vendors are configured. Reads env only; never logs values. */
export function speechConfigFromEnv(env: Record<string, string | undefined> = process.env): SpeechConfig {
  const openaiKey = (env[SPEECH_ENV.openaiKey] ?? '').trim()
  const baseUrl = env[SPEECH_ENV.openaiBaseUrl] ? httpsUrl(env[SPEECH_ENV.openaiBaseUrl]) : DEFAULT_OPENAI_BASE
  const khayaKey = (env[SPEECH_ENV.khayaKey] ?? '').trim()
  const khayaUrl = httpsUrl(env[SPEECH_ENV.khayaUrl])
  return {
    whisper: openaiKey && baseUrl ? { apiKey: openaiKey, baseUrl, model: (env[SPEECH_ENV.openaiModel] ?? '').trim() || 'whisper-1' } : null,
    khaya: khayaKey && khayaUrl ? { apiKey: khayaKey, url: khayaUrl } : null,
  }
}

/** The vendor for a language: Whisper has no Twi/Akan, Ewe or Ga (research doc §1.4). */
export function vendorFor(language: SpeechLanguage): 'whisper' | 'khaya' {
  return language === 'en' || language === 'fr' ? 'whisper' : 'khaya'
}

/** Whether a voice note in this language can be transcribed with the current config. */
export function speechAvailable(language: SpeechLanguage, config: SpeechConfig): boolean {
  return vendorFor(language) === 'whisper' ? !!config.whisper : !!config.khaya
}

/**
 * The spoken language for a binding: its own voice setting (VOICE command),
 * else the account locale (fr*, tw/ak/twi, ee/ewe, gaa/ga), else English.
 */
export function speechLanguage(voiceLanguage: string | undefined | null, accountLocale: string | undefined | null): SpeechLanguage {
  for (const raw of [voiceLanguage, accountLocale]) {
    const v = (raw ?? '').trim().toLowerCase()
    if (!v) continue
    const code = v.split(/[-_]/)[0]
    if (code === 'fr' || code === 'french' || code === 'francais' || code === 'français') return 'fr'
    if (code === 'tw' || code === 'ak' || code === 'twi' || code === 'akan') return 'tw'
    if (code === 'ee' || code === 'ewe') return 'ee'
    if (code === 'gaa' || code === 'ga') return 'gaa'
    if (code === 'en' || code === 'english') return 'en'
  }
  return 'en'
}

// ---------------------------------------------------------------------------
// Word confidence

/** Under this a number or cage token heard in a note is marked CHECK. */
export const LOW_CONFIDENCE = 0.6

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : undefined)

function splitWords(text: string): string[] {
  return text.split(/\s+/).map((w) => w.trim()).filter(Boolean)
}

/** Tokens with log-probabilities → words (a token starting with a space starts a word); word confidence is the product. */
export function wordsFromLogprobs(tokens: readonly { token: string; logprob: number }[]): Word[] {
  const words: { text: string; logprob: number }[] = []
  for (const t of tokens) {
    const startsWord = /^\s/.test(t.token) || !words.length
    const piece = t.token.trim()
    if (startsWord) {
      if (piece) words.push({ text: piece, logprob: t.logprob })
    } else if (piece) {
      const last = words[words.length - 1]
      last.text += piece
      last.logprob += t.logprob
    }
  }
  return words.map((w) => ({ text: w.text, confidence: clamp01(Math.exp(w.logprob)) }))
}

/** Segments with avg_logprob → words, each with its segment's confidence. */
export function wordsFromSegments(segments: readonly { text: string; avg_logprob?: number | null }[]): Word[] {
  const out: Word[] = []
  for (const seg of segments) {
    const c = typeof seg.avg_logprob === 'number' ? clamp01(Math.exp(seg.avg_logprob)) : undefined
    for (const w of splitWords(seg.text)) out.push(c === undefined ? { text: w } : { text: w, confidence: c })
  }
  return out
}

/** Words heard with confidence under `threshold` (unknown confidence is not low). */
export function lowConfidenceWords(words: readonly Word[], threshold = LOW_CONFIDENCE): string[] {
  const out: string[] = []
  for (const w of words) {
    if (w.confidence !== undefined && w.confidence < threshold) {
      const clean = w.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      if (clean && !out.includes(clean)) out.push(clean)
    }
  }
  return out.slice(0, 30)
}

/** The transcript with unsure words marked [?word?], for the agent's user turn. */
export function markedTranscript(text: string, lowConfidence: readonly string[]): string {
  const low = new Set(lowConfidence.map((w) => w.toLowerCase()))
  if (!low.size) return text
  return text
    .split(/(\s+)/)
    .map((part) => {
      const clean = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      return clean && low.has(clean.toLowerCase()) ? part.replace(clean, `[?${clean}?]`) : part
    })
    .join('')
}

/** Whether a figure was only heard as a low-confidence word (e.g. "30" in an unsure segment). */
export function figureIsUnsure(lowConfidence: readonly string[], value: number): boolean {
  return lowConfidence.some((w) => w.replace(/[^\d.]/g, '') === String(value))
}

// ---------------------------------------------------------------------------
// Vendors

/** Transcription is idempotent: retry network errors, timeouts and 5xx (never 4xx). */
export const SPEECH_POLICY: HttpPolicy = { timeoutMs: 60_000, retries: 2, retryBaseDelayMs: 500 }

function mapHttp(vendor: string) {
  return (e: HttpError): SpeechError => {
    switch (e._tag) {
      case 'HttpStatusError':
        return new SpeechError({
          reason: e.status >= 500 ? 'unavailable' : 'rejected',
          status: e.status,
          message: `${vendor} refused the audio (${e.status})`,
        })
      case 'HttpDecodeError':
        return new SpeechError({ reason: 'decode', status: e.status, message: `${vendor} sent an unexpected response` })
      case 'HttpTimeoutError':
        return new SpeechError({ reason: 'unavailable', message: `${vendor} timed out` })
      case 'HttpNetworkError':
        return new SpeechError({ reason: 'unavailable', message: `${vendor} could not be reached` })
    }
  }
}

const EXT: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
}

const WhisperResponse = Schema.Struct({
  text: Schema.String,
  language: Schema.optional(Schema.NullOr(Schema.String)),
  segments: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.Struct({ text: Schema.String, avg_logprob: Schema.optional(Schema.NullOr(Schema.Number)) }))),
  ),
  logprobs: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ token: Schema.String, logprob: Schema.Number })))),
})

export function makeWhisper(config: WhisperConfig, fetchLayerOf: Layer.Layer<Fetch>, policy: HttpPolicy = SPEECH_POLICY): SpeechApi {
  const logprobModel = config.model.startsWith('gpt-4o')
  return {
    vendor: 'whisper',
    transcribe: (audio, language) => {
      if (language !== 'en' && language !== 'fr') {
        return Effect.fail(new SpeechError({ reason: 'unsupported_language', message: `Whisper is not used for ${language}` }))
      }
      const form = new FormData()
      const bytes = new Uint8Array(audio.bytes)
      form.append('file', new Blob([bytes], { type: audio.mime }), `voice.${EXT[audio.mime] ?? 'ogg'}`)
      form.append('model', config.model)
      form.append('language', language)
      if (logprobModel) {
        form.append('response_format', 'json')
        form.append('include[]', 'logprobs')
      } else {
        form.append('response_format', 'verbose_json')
      }
      return requestJsonAs(
        WhisperResponse,
        {
          url: `${config.baseUrl}/audio/transcriptions`,
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}` },
          body: form,
        },
        policy,
      ).pipe(
        Effect.mapError(mapHttp('The speech service')),
        Effect.map((r): Transcript => {
          const words = r.logprobs?.length
            ? wordsFromLogprobs(r.logprobs)
            : r.segments?.length
              ? wordsFromSegments(r.segments)
              : splitWords(r.text).map((text) => ({ text }))
          return { text: r.text.trim(), language, words, vendor: 'whisper', model: config.model }
        }),
        Effect.provide(fetchLayerOf),
      )
    },
  }
}

/**
 * TODO(BOT-005): confirm against GhanaNLP's ASR operation on
 * developer.khaya.ai before enabling KHAYA_ASR_URL in production. Assumed
 * here: POST the raw audio to KHAYA_ASR_URL with `?language=<tw|ee|gaa>`,
 * the Azure API Management key header `Ocp-Apim-Subscription-Key`, and a
 * body that is either a JSON string or an object with `text` /
 * `transcription`. No per-word confidence is assumed.
 */
const KhayaResponse = Schema.Union([
  Schema.String,
  Schema.Struct({
    text: Schema.optional(Schema.NullOr(Schema.String)),
    transcription: Schema.optional(Schema.NullOr(Schema.String)),
  }),
])

export function makeKhaya(config: KhayaConfig, fetchLayerOf: Layer.Layer<Fetch>, policy: HttpPolicy = SPEECH_POLICY): SpeechApi {
  return {
    vendor: 'khaya',
    transcribe: (audio, language) => {
      if (language !== 'tw' && language !== 'ee' && language !== 'gaa') {
        return Effect.fail(new SpeechError({ reason: 'unsupported_language', message: `Khaya is not used for ${language}` }))
      }
      const sep = config.url.includes('?') ? '&' : '?'
      return requestJsonAs(
        KhayaResponse,
        {
          url: `${config.url}${sep}language=${language}`,
          method: 'POST',
          headers: { 'Ocp-Apim-Subscription-Key': config.apiKey, 'Content-Type': audio.mime },
          body: new Uint8Array(audio.bytes),
        },
        policy,
      ).pipe(
        Effect.mapError(mapHttp('The speech service')),
        Effect.flatMap((r) => {
          const text = (typeof r === 'string' ? r : (r.text ?? r.transcription ?? '')).trim()
          if (!text) return Effect.fail(new SpeechError({ reason: 'decode', message: 'The speech service sent no text' }))
          return Effect.succeed<Transcript>({
            text,
            language,
            words: splitWords(text).map((w) => ({ text: w })),
            vendor: 'khaya',
            model: 'khaya-asr',
          })
        }),
        Effect.provide(fetchLayerOf),
      )
    },
  }
}

/** The Speech layer for a language, or null when its vendor is not configured. */
export function speechLayer(
  language: SpeechLanguage,
  config: SpeechConfig,
  options: { policy?: HttpPolicy } = {},
): Layer.Layer<Speech, never, Fetch> | null {
  const vendor = vendorFor(language)
  const make = (build: (fetchLayerOf: Layer.Layer<Fetch>) => SpeechApi) =>
    Layer.effect(
      Speech,
      Effect.gen(function* () {
        const fetchFn = yield* Fetch
        return build(Layer.succeed(Fetch, fetchFn))
      }),
    )
  if (vendor === 'whisper') {
    const c = config.whisper
    return c ? make((f) => makeWhisper(c, f, options.policy)) : null
  }
  const c = config.khaya
  return c ? make((f) => makeKhaya(c, f, options.policy)) : null
}

/** Transcribe with whichever vendor serves the language. */
export function transcribe(audio: AudioInput, language: SpeechLanguage): Effect.Effect<Transcript, SpeechError, Speech> {
  return Effect.gen(function* () {
    const speech = yield* Speech
    return yield* speech.transcribe(audio, language)
  })
}
