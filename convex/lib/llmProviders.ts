/**
 * LLM provider calls on Effect (PLAT-006, D-019 doc 19 §8). Server only:
 * used by the Next API routes (pages/api/llm/*), reusable from a Convex
 * action. lib/llmClient.js (bundled for the browser) no longer calls
 * providers; it posts to the proxy.
 *
 * - Request body envelope of /api/llm/chat validated with Schema
 *   (`decodeChatBody`); lib/llmProxyGuard#validateMessages stays the
 *   authority for message caps and their messages.
 * - Per-attempt timeout 30 s; 2 retries with jittered backoff on network
 *   errors, timeouts and 5xx (a chat completion is safe to repeat); 4xx
 *   never retried.
 * - Each provider's 2xx body validated with Schema; a body without text is
 *   "Empty response from …" as before. Error texts are unchanged
 *   (`Gemini request failed (status)`, the provider's own message, …).
 * - URLs in errors are redacted by effectHttp (Gemini's key is in the query).
 */
import * as Cause from 'effect/Cause'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import {
  type Fetch,
  type FetchFn,
  type HttpPolicy,
  type HttpResponse,
  fetchLayer,
  requestJson,
} from './effectHttp'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type { ProviderKind } from './llmModels'
import type { ProviderKind } from './llmModels'

/** A provider failed or answered without text; `message` is shown to the user. */
export class LlmError extends Data.TaggedError('LlmError')<{
  readonly message: string
  readonly status?: number
}> {}

export const LLM_TIMEOUT_MS = 30_000

export const LLM_POLICY: HttpPolicy = {
  timeoutMs: LLM_TIMEOUT_MS,
  retries: 2,
  retryBaseDelayMs: 500,
}

/** Body of POST /api/llm/chat. Messages are checked by validateMessages. */
export const ChatBody = Schema.Struct({
  provider: Schema.optional(Schema.NullOr(Schema.String)),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  messages: Schema.optional(Schema.Unknown),
  temperature: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Client's today (YYYY-MM-DD) for the farm context. */
  asOf: Schema.optional(Schema.NullOr(Schema.String)),
  /** Ask Anowa scope (artboard 47): one site, a window in days, deep analysis. */
  locationId: Schema.optional(Schema.NullOr(Schema.String)),
  days: Schema.optional(Schema.NullOr(Schema.Number)),
  deep: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /** The member's app language (`en` | `fr`); Anowa answers in it. */
  lang: Schema.optional(Schema.NullOr(Schema.String)),
})
export type ChatBody = typeof ChatBody.Type

/** The request envelope, or a 400 message. */
export function decodeChatBody(
  body: unknown,
): { ok: true; value: ChatBody } | { ok: false; error: string } {
  const decoded = Schema.decodeUnknownOption(ChatBody)(body ?? {})
  return Option.isSome(decoded)
    ? { ok: true, value: decoded.value }
    : { ok: false, error: 'Invalid request: provider, model, asOf and locationId must be text, temperature and days numbers, deep true or false' }
}

const Text = Schema.optional(Schema.NullOr(Schema.String))

const Count = Schema.optional(Schema.NullOr(Schema.Number))

const OpenAiResponse = Schema.Struct({
  usage: Schema.optional(
    Schema.NullOr(Schema.Struct({ prompt_tokens: Count, completion_tokens: Count })),
  ),
  choices: Schema.optional(
    Schema.Array(
      Schema.Struct({ message: Schema.optional(Schema.NullOr(Schema.Struct({ content: Text }))) }),
    ),
  ),
})

const GeminiResponse = Schema.Struct({
  usageMetadata: Schema.optional(
    Schema.NullOr(Schema.Struct({ promptTokenCount: Count, candidatesTokenCount: Count })),
  ),
  candidates: Schema.optional(
    Schema.Array(
      Schema.Struct({
        content: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              parts: Schema.optional(Schema.Array(Schema.Struct({ text: Text }))),
            }),
          ),
        ),
      }),
    ),
  ),
})

const AnthropicResponse = Schema.Struct({
  usage: Schema.optional(
    Schema.NullOr(Schema.Struct({ input_tokens: Count, output_tokens: Count })),
  ),
  content: Schema.optional(
    Schema.Array(Schema.Struct({ type: Schema.optional(Schema.String), text: Text })),
  ),
})

const asObject = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' ? (v as Record<string, any>) : {}

/** POST and map transport failures to LlmError with the provider's message. */
function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  describe: (status: number, json: Record<string, any>) => string,
  policy: HttpPolicy = LLM_POLICY,
): Effect.Effect<HttpResponse, LlmError, Fetch> {
  return requestJson({ url, method: 'POST', headers, body }, policy).pipe(
    Effect.catchTags({
      HttpStatusError: (e) =>
        Effect.fail(new LlmError({ message: describe(e.status, asObject(e.body)), status: e.status })),
      HttpNetworkError: (e) => Effect.fail(new LlmError({ message: e.message })),
      HttpTimeoutError: (e) =>
        Effect.fail(
          new LlmError({ message: `The model did not answer within ${e.timeoutMs / 1000} seconds` }),
        ),
    }),
  )
}

function decode<S extends Schema.Decoder<unknown>>(schema: S, res: HttpResponse): S['Type'] | undefined {
  return Option.getOrUndefined(Schema.decodeUnknownOption(schema)(res.body))
}

/** Token counts as the provider reported them (INT-009 usage log). */
export type ChatUsage = { inputTokens?: number; outputTokens?: number }
export type ChatReply = { text: string; usage: ChatUsage }

const count = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined

export type ChatOptions = {
  kind: ProviderKind
  /** Provider id (openrouter adds its attribution headers). */
  providerId: string
  /** OpenAI-compatible base URL (unused for gemini and anthropic). */
  baseUrl?: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  temperature?: number
  /** Sent as OpenRouter's HTTP-Referer. */
  referer?: string
  /** Override of LLM_POLICY (tests). */
  policy?: HttpPolicy
}

function chatOpenAi(o: ChatOptions) {
  return Effect.gen(function* () {
    const base = (o.baseUrl ?? '').trim().replace(/\/$/, '')
    if (!base) {
      return yield* Effect.fail(
        new LlmError({ message: 'Custom provider needs a base URL (e.g. https://host/v1)' }),
      )
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${o.apiKey}` }
    if (o.providerId === 'openrouter') {
      headers['HTTP-Referer'] = o.referer || 'https://localhost'
      headers['X-Title'] = 'Anowa Assistant'
    }
    const res = yield* post(
      `${base}/chat/completions`,
      headers,
      { model: o.model, temperature: o.temperature ?? 0.3, messages: o.messages },
      (status, b) =>
        b?.error?.message || b?.error?.metadata?.raw || b?.message || `LLM request failed (${status})`,
      o.policy,
    )
    const body = decode(OpenAiResponse, res)
    const text = body?.choices?.[0]?.message?.content?.trim()
    if (!text) return yield* Effect.fail(new LlmError({ message: 'Empty response from model' }))
    return {
      text,
      usage: { inputTokens: count(body?.usage?.prompt_tokens), outputTokens: count(body?.usage?.completion_tokens) },
    } satisfies ChatReply
  })
}

function chatGemini(o: ChatOptions) {
  return Effect.gen(function* () {
    const system = o.messages.find((m) => m.role === 'system')?.content
    const contents = o.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const payload: Record<string, unknown> = {
      contents,
      generationConfig: { temperature: o.temperature ?? 0.3 },
    }
    if (system) payload.systemInstruction = { parts: [{ text: system }] }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent?key=${encodeURIComponent(o.apiKey)}`
    const res = yield* post(
      url,
      {},
      payload,
      (status, b) => b?.error?.message || `Gemini request failed (${status})`,
      o.policy,
    )
    const body = decode(GeminiResponse, res)
    const text = body?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('')
      .trim()
    if (!text) return yield* Effect.fail(new LlmError({ message: 'Empty response from Gemini' }))
    return {
      text,
      usage: {
        inputTokens: count(body?.usageMetadata?.promptTokenCount),
        outputTokens: count(body?.usageMetadata?.candidatesTokenCount),
      },
    } satisfies ChatReply
  })
}

function chatAnthropic(o: ChatOptions) {
  return Effect.gen(function* () {
    const system = o.messages.find((m) => m.role === 'system')?.content
    const res = yield* post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: o.model,
        // Current Claude models think before answering, and thinking counts
        // toward max_tokens, so leave room for it. No temperature: current
        // models reject sampling parameters with a 400.
        max_tokens: 16000,
        system: system || undefined,
        messages: o.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      },
      (status, b) => b?.error?.message || `Anthropic request failed (${status})`,
      o.policy,
    )
    const body = decode(AnthropicResponse, res)
    const text = body?.content
      ?.filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join('')
      .trim()
    if (!text) return yield* Effect.fail(new LlmError({ message: 'Empty response from Claude' }))
    return {
      text,
      usage: { inputTokens: count(body?.usage?.input_tokens), outputTokens: count(body?.usage?.output_tokens) },
    } satisfies ChatReply
  })
}

/** One chat completion with the provider's token counts. */
export function chatWithUsage(o: ChatOptions): Effect.Effect<ChatReply, LlmError, Fetch> {
  if (!o.apiKey.trim()) return Effect.fail(new LlmError({ message: 'API key is required' }))
  if (!o.model.trim()) return Effect.fail(new LlmError({ message: 'Model is required' }))
  if (o.kind === 'gemini') return chatGemini(o)
  if (o.kind === 'anthropic') return chatAnthropic(o)
  return chatOpenAi(o)
}

/** One chat completion. */
export function chat(o: ChatOptions): Effect.Effect<string, LlmError, Fetch> {
  return chatWithUsage(o).pipe(Effect.map((r) => r.text))
}

/**
 * Run `chatWithUsage` at the route edge: text and token counts, or an Error
 * with the user-facing message (and `status` when the provider answered).
 */
export async function runChatWithUsage(o: ChatOptions, fetchImpl?: FetchFn): Promise<ChatReply> {
  const impl: FetchFn = fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  const exit = await Effect.runPromiseExit(chatWithUsage(o).pipe(Effect.provide(fetchLayer(impl))))
  if (Exit.isSuccess(exit)) return exit.value
  throw failureToError(exit.cause)
}

/**
 * Run `chat` at the route edge: the reply text, or an Error with the
 * user-facing message (and `status` when the provider answered).
 */
export async function runChat(o: ChatOptions, fetchImpl?: FetchFn): Promise<string> {
  return (await runChatWithUsage(o, fetchImpl)).text
}

function failureToError(cause: Cause.Cause<LlmError>): Error {
  const failure = Cause.findError(cause)
  if (Result.isSuccess(failure)) {
    const err = new Error(failure.success.message) as Error & { status?: number }
    err.status = failure.success.status
    return err
  }
  const squashed = Cause.squash(cause)
  return squashed instanceof Error ? squashed : new Error(String(squashed))
}
