/**
 * Live model discovery (D-028: model ids are discovered, not hardcoded).
 *
 * No model id is written in the code. Each provider's model list is fetched
 * from the provider with the key that will be used (server key in the Next
 * proxy, the organization's key in the Convex gateway), filtered to chat
 * models, and cached by a fingerprint of provider + base URL + key (the key
 * itself is never stored). From that list:
 *
 *   - the allow-list is the live list plus LLM_EXTRA_MODELS;
 *   - the default is LLM_DEFAULT_MODEL_<PROVIDER> / LLM_DEFAULT_MODEL when
 *     the live list has it, else `pickDefaultModel` (one documented rule);
 *   - a saved or requested id that is not in the list falls back to the
 *     default, and the caller reports which model it actually used.
 *
 * When the list cannot be fetched, only an env default can be used; with
 * none, the caller gets "Can't reach <provider> to list models; set
 * LLM_DEFAULT_MODEL_<PROVIDER>" instead of a stale id.
 *
 * Network: one `ModelLister` service, one Layer per vendor API (Gemini,
 * OpenAI-compatible, Anthropic, OpenRouter), all through `Fetch` and
 * `requestJsonAs` (10 s per attempt, retries only network/timeout/5xx,
 * Schema-validated bodies).
 */
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import { Fetch, type HttpError, type HttpPolicy, requestJsonAs } from './effectHttp'

export type ProviderKind = 'openai' | 'gemini' | 'anthropic'

/** One model a provider offers for chat. Prices are USD per million tokens. */
export type ModelInfo = {
  id: string
  label?: string
  /** Accepts image input (logbook OCR). */
  vision: boolean
  /** Release time, seconds since epoch, when the provider says. */
  created?: number
  inputPerM?: number
  outputPerM?: number
}

/** Where to list models: the provider and the key that will be used for the call. */
export type ListTarget = {
  providerId: string
  kind: ProviderKind
  /** Provider API base (e.g. https://api.openai.com/v1); the custom provider's saved URL. */
  baseUrl: string
  apiKey: string
  /** Tests only; production uses MODEL_LIST_POLICY. */
  policy?: HttpPolicy
}

export class ModelListError extends Data.TaggedError('ModelListError')<{
  readonly message: string
  readonly status?: number
}> {}

/** Listing is a read: safe to retry on network errors, timeouts and 5xx. */
export const MODEL_LIST_POLICY: HttpPolicy = { timeoutMs: 10_000, retries: 2, retryBaseDelayMs: 300 }
export const MODEL_CACHE_TTL_MS = 60 * 60 * 1000
export const MAX_MODELS = 1500
export const MAX_MODEL_ID_CHARS = 100
const MAX_PAGES = 10

const ANTHROPIC_VERSION = '2023-06-01'

// ---------------------------------------------------------------------------
// Filtering (pure)
// ---------------------------------------------------------------------------

/**
 * Ids that are not chat models: embeddings, speech, image/video generation,
 * moderation, realtime/live audio, legacy completion models, rerankers,
 * safety classifiers. Used where the provider gives no capability metadata.
 */
const NOT_CHAT =
  /(embed|tts|whisper|transcri|speech|dall-e|gpt-image|imagen|image-generation|-image\b|-image-|moderation|davinci|babbage|(^|[-/])ada\b|audio|realtime|native-audio|-live\b|-live-|rerank|guard|aqa|veo|sora|lyria|computer-use|antigravity|robotics|playai|orpheus|instruct-v0|search-preview)/i

/** OpenAI: chat-completions models only (no Responses-only pro/codex/deep-research). */
const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/i
const OPENAI_NOT_CHAT = /(-instruct\b|codex|deep-research|-pro\b|-pro-|-search-)/i

const SAFE_ID = /^[A-Za-z0-9._:/@-]+$/

function cleanId(id: unknown): string | null {
  if (typeof id !== 'string') return null
  const m = id.trim()
  return m && m.length <= MAX_MODEL_ID_CHARS && SAFE_ID.test(m) ? m : null
}

function perMillion(perToken: unknown): number | undefined {
  const n = typeof perToken === 'string' ? Number(perToken) : typeof perToken === 'number' ? perToken : NaN
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.round(n * 1_000_000 * 1_000_000) / 1_000_000
}

function seconds(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v > 1e12 ? Math.round(v / 1000) : v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isFinite(t) ? Math.round(t / 1000) : undefined
  }
  return undefined
}

/** Name-based vision guess for providers that publish no modalities. */
export function visionByName(providerId: string, id: string): boolean {
  const m = id.toLowerCase()
  if (providerId === 'gemini') return m.startsWith('gemini-')
  if (providerId === 'anthropic') return m.startsWith('claude-') && !m.includes('3-5-haiku')
  if (providerId === 'openai') return /^(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|o3|o4|chatgpt-4o)/.test(m) && !/(audio|realtime|search)/.test(m)
  if (providerId === 'groq') return /(vision|llama-4|scout|maverick)/.test(m)
  return /(vision|-vl\b|-vl-|llava|gpt-4o|gpt-4\.1|gpt-5|gemini|claude|pixtral|llama-4)/.test(m)
}

function dedupe(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>()
  const out: ModelInfo[] = []
  for (const m of models) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m)
    if (out.length >= MAX_MODELS) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Response schemas and parsers (pure)
// ---------------------------------------------------------------------------

const Str = Schema.optional(Schema.NullOr(Schema.String))
const Num = Schema.optional(Schema.NullOr(Schema.Number))
const StrList = Schema.optional(Schema.NullOr(Schema.Array(Schema.String)))

export const GeminiModelPage = Schema.Struct({
  models: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({ name: Schema.String, displayName: Str, supportedGenerationMethods: StrList }),
      ),
    ),
  ),
  nextPageToken: Str,
})

export const OpenAiModelList = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      created: Num,
      active: Schema.optional(Schema.NullOr(Schema.Boolean)),
    }),
  ),
})

export const AnthropicModelPage = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String, display_name: Str, created_at: Str })),
  has_more: Schema.optional(Schema.NullOr(Schema.Boolean)),
  last_id: Str,
})

export const OpenRouterModelList = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Str,
      created: Num,
      pricing: Schema.optional(Schema.NullOr(Schema.Struct({ prompt: Str, completion: Str }))),
      architecture: Schema.optional(
        Schema.NullOr(Schema.Struct({ modality: Str, input_modalities: StrList, output_modalities: StrList })),
      ),
    }),
  ),
})

/** Gemini: models whose methods include generateContent, `models/` prefix stripped. */
export function parseGeminiModels(page: typeof GeminiModelPage.Type): ModelInfo[] {
  const out: ModelInfo[] = []
  for (const m of page.models ?? []) {
    if (!(m.supportedGenerationMethods ?? []).includes('generateContent')) continue
    const id = cleanId(m.name.replace(/^models\//, ''))
    if (!id || NOT_CHAT.test(id)) continue
    out.push({ id, label: m.displayName ?? undefined, vision: visionByName('gemini', id) })
  }
  return out
}

/** OpenAI, Groq and custom OpenAI-compatible `/models`. */
export function parseOpenAiModels(providerId: string, list: typeof OpenAiModelList.Type): ModelInfo[] {
  const out: ModelInfo[] = []
  for (const m of list.data) {
    const id = cleanId(m.id)
    if (!id || NOT_CHAT.test(id) || m.active === false) continue
    if (providerId === 'openai' && (!OPENAI_CHAT.test(id) || OPENAI_NOT_CHAT.test(id))) continue
    out.push({ id, vision: visionByName(providerId, id), created: seconds(m.created) })
  }
  return out
}

export function parseAnthropicModels(page: typeof AnthropicModelPage.Type): ModelInfo[] {
  const out: ModelInfo[] = []
  for (const m of page.data) {
    const id = cleanId(m.id)
    if (!id || NOT_CHAT.test(id)) continue
    out.push({ id, label: m.display_name ?? undefined, vision: visionByName('anthropic', id), created: seconds(m.created_at) })
  }
  return out
}

/** OpenRouter: text output only (no image generators), modalities and prices from the API. */
export function parseOpenRouterModels(list: typeof OpenRouterModelList.Type): ModelInfo[] {
  const out: ModelInfo[] = []
  for (const m of list.data) {
    const id = cleanId(m.id)
    if (!id || NOT_CHAT.test(id)) continue
    const arch = m.architecture
    const modality = (arch?.modality ?? '').toLowerCase()
    const inputs = arch?.input_modalities ?? (modality ? modality.split('->')[0].split('+') : ['text'])
    const outputs = arch?.output_modalities ?? (modality ? modality.split('->')[1]?.split('+') ?? ['text'] : ['text'])
    if (!outputs.includes('text') || outputs.includes('image') || outputs.includes('audio')) continue
    if (!inputs.includes('text')) continue
    out.push({
      id,
      label: m.name ?? undefined,
      vision: inputs.includes('image'),
      created: seconds(m.created),
      inputPerM: perMillion(m.pricing?.prompt),
      outputPerM: perMillion(m.pricing?.completion),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Listing (Effect): one service, one Layer per vendor API
// ---------------------------------------------------------------------------

export type ModelListerApi = {
  readonly list: (target: ListTarget) => Effect.Effect<ModelInfo[], ModelListError>
}

export class ModelLister extends Context.Service<ModelLister, ModelListerApi>()('anowa/ModelLister') {}

function providerMessage(body: unknown): string {
  const b = body && typeof body === 'object' ? (body as { error?: unknown; message?: unknown }) : {}
  const e = b.error
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return String((e as { message: string }).message).slice(0, 200)
  }
  if (typeof e === 'string') return e.slice(0, 200)
  return typeof b.message === 'string' ? b.message.slice(0, 200) : ''
}

/** HttpError → ModelListError with the provider's own message when it gives one. */
export function toModelListError(providerId: string, e: HttpError): ModelListError {
  switch (e._tag) {
    case 'HttpStatusError':
      return new ModelListError({
        message: providerMessage(e.body) || `${providerId} model list failed (${e.status})`,
        status: e.status,
      })
    case 'HttpDecodeError':
      return new ModelListError({ message: `Unexpected model list from ${providerId}` })
    case 'HttpTimeoutError':
      return new ModelListError({ message: `${providerId} did not list its models within ${e.timeoutMs / 1000} seconds` })
    case 'HttpNetworkError':
      return new ModelListError({ message: `Can't reach ${providerId}: ${e.message}` })
  }
}

function base(t: ListTarget): string {
  return t.baseUrl.trim().replace(/\/+$/, '')
}

const fail = (t: ListTarget) => (e: HttpError) => Effect.fail(toModelListError(t.providerId, e))

function listGemini(t: ListTarget): Effect.Effect<ModelInfo[], ModelListError, Fetch> {
  return Effect.gen(function* () {
    const out: ModelInfo[] = []
    let token: string | undefined
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const qs = new URLSearchParams({ pageSize: '1000' })
      if (token) qs.set('pageToken', token)
      // Key in a header, never in the URL.
      const body = yield* requestJsonAs(
        GeminiModelPage,
        { url: `${base(t)}/models?${qs}`, method: 'GET', headers: { 'x-goog-api-key': t.apiKey } },
        t.policy ?? MODEL_LIST_POLICY,
      ).pipe(Effect.catch(fail(t)))
      out.push(...parseGeminiModels(body))
      token = body.nextPageToken ?? undefined
      if (!token || out.length >= MAX_MODELS) break
    }
    return out
  })
}

function listOpenAiCompatible(t: ListTarget): Effect.Effect<ModelInfo[], ModelListError, Fetch> {
  if (!base(t)) return Effect.fail(new ModelListError({ message: 'Custom provider needs a base URL (e.g. https://host/v1)' }))
  return requestJsonAs(
    OpenAiModelList,
    { url: `${base(t)}/models`, method: 'GET', headers: { Authorization: `Bearer ${t.apiKey}` } },
    t.policy ?? MODEL_LIST_POLICY,
  ).pipe(
    Effect.map((list) => parseOpenAiModels(t.providerId, list)),
    Effect.catch(fail(t)),
  )
}

function listAnthropic(t: ListTarget): Effect.Effect<ModelInfo[], ModelListError, Fetch> {
  return Effect.gen(function* () {
    const out: ModelInfo[] = []
    let after: string | undefined
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const qs = new URLSearchParams({ limit: '1000' })
      if (after) qs.set('after_id', after)
      const body = yield* requestJsonAs(
        AnthropicModelPage,
        {
          url: `${base(t)}/models?${qs}`,
          method: 'GET',
          headers: { 'x-api-key': t.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        },
        t.policy ?? MODEL_LIST_POLICY,
      ).pipe(Effect.catch(fail(t)))
      out.push(...parseAnthropicModels(body))
      after = body.has_more && body.last_id ? body.last_id : undefined
      if (!after || out.length >= MAX_MODELS) break
    }
    return out
  })
}

function listOpenRouter(t: ListTarget): Effect.Effect<ModelInfo[], ModelListError, Fetch> {
  return requestJsonAs(
    OpenRouterModelList,
    { url: `${base(t)}/models`, method: 'GET', headers: { Authorization: `Bearer ${t.apiKey}` } },
    t.policy ?? MODEL_LIST_POLICY,
  ).pipe(Effect.map(parseOpenRouterModels), Effect.catch(fail(t)))
}

const vendorLayer = (list: (t: ListTarget) => Effect.Effect<ModelInfo[], ModelListError, Fetch>) =>
  Layer.effect(
    ModelLister,
    Effect.gen(function* () {
      const fetch = yield* Fetch
      return { list: (t: ListTarget) => list(t).pipe(Effect.map(dedupe), Effect.provideService(Fetch, fetch)) }
    }),
  )

export const GeminiModelsLive = vendorLayer(listGemini)
export const OpenAiCompatibleModelsLive = vendorLayer(listOpenAiCompatible)
export const AnthropicModelsLive = vendorLayer(listAnthropic)
export const OpenRouterModelsLive = vendorLayer(listOpenRouter)

export function modelsLayerFor(t: Pick<ListTarget, 'providerId' | 'kind'>) {
  if (t.kind === 'gemini') return GeminiModelsLive
  if (t.kind === 'anthropic') return AnthropicModelsLive
  if (t.providerId === 'openrouter') return OpenRouterModelsLive
  return OpenAiCompatibleModelsLive
}

/** The provider's chat models for this key. Needs `Fetch`. */
export function listModels(t: ListTarget): Effect.Effect<ModelInfo[], ModelListError, Fetch> {
  if (!t.apiKey.trim()) return Effect.fail(new ModelListError({ message: 'API key is required' }))
  return Effect.gen(function* () {
    const lister = yield* ModelLister
    return yield* lister.list(t)
  }).pipe(Effect.provide(modelsLayerFor(t)))
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Cache key for a model list: SHA-256 of scope + provider + base URL + key.
 * One-way; the key itself is never stored. `scope` keeps tenants apart
 * ('server', or the company id for an organization key).
 */
export async function modelFingerprint(t: ListTarget, scope: string): Promise<string> {
  const data = new TextEncoder().encode(`anowa-models:v1\n${scope}\n${t.providerId}\n${base(t)}\n${t.apiKey}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** In-memory TTL cache (Next server routes). Failures are not cached. */
export function createModelCache(o: { ttlMs?: number; now?: () => number; maxEntries?: number } = {}) {
  const ttl = o.ttlMs ?? MODEL_CACHE_TTL_MS
  const now = o.now ?? (() => Date.now())
  const max = o.maxEntries ?? 200
  const entries = new Map<string, { at: number; models: ModelInfo[] }>()
  return {
    get(fingerprint: string): ModelInfo[] | null {
      const e = entries.get(fingerprint)
      if (!e) return null
      if (now() - e.at >= ttl) {
        entries.delete(fingerprint)
        return null
      }
      return e.models
    },
    set(fingerprint: string, models: ModelInfo[]) {
      if (entries.size >= max) entries.delete(entries.keys().next().value as string)
      entries.set(fingerprint, { at: now(), models })
    },
    clear() {
      entries.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// Default pick and resolution (pure)
// ---------------------------------------------------------------------------

/** Preview, experimental, beta, rolling "-latest" aliases and free-tier variants. */
const UNSTABLE = /(preview|experimental|(^|[-_.:])exp($|[-_.:\d])|beta|alpha|(^|[-_.])test\b|deprecated|-latest\b|:free\b|:beta\b)/i
/** Too small to be the default when a regular fast tier exists. */
const SMALL_TIER = /(^|[-_./:])(lite|nano|tiny|micro)($|[-_.:\d])/i
/** Whole tokens only ("gemini" is not "mini"). */
const FAST_TIER = /(^|[-_./:])(flash|mini|haiku|instant|fast|small)($|[-_.:\d])/i

function tier(id: string): number {
  if (SMALL_TIER.test(id)) return 1
  return FAST_TIER.test(id) ? 2 : 0
}

/** First version number in an id ("gemini-2.5-flash" → [2, 5]). */
function version(id: string): number[] {
  const m = id.match(/(\d+(?:\.\d+)*)/)
  return m ? m[1].split('.').map(Number) : []
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? -1) - (b[i] ?? -1)
    if (d) return d
  }
  return 0
}

/**
 * The default model from a live list, by one rule:
 *   1. stable before preview/experimental/beta/"-latest"/":free" (unstable
 *      only when nothing else is offered);
 *   2. the fast tier (flash, mini, haiku, instant, fast, small) before
 *      lite/nano/tiny, before everything else;
 *   3. newest: the provider's release time when it gives one, else the
 *      highest version number in the id;
 *   4. the shorter id (the alias over a dated snapshot), then alphabetical.
 * `vision` limits the pick to models that accept images. Null when none fit.
 */
export function pickDefaultModel(models: ModelInfo[], o: { vision?: boolean } = {}): string | null {
  const pool = o.vision ? models.filter((m) => m.vision) : models
  if (!pool.length) return null
  const sorted = [...pool].sort((a, b) => {
    const stable = Number(UNSTABLE.test(a.id)) - Number(UNSTABLE.test(b.id))
    if (stable) return stable
    const t = tier(b.id) - tier(a.id)
    if (t) return t
    if (a.created && b.created && a.created !== b.created) return b.created - a.created
    const v = compareVersions(version(b.id), version(a.id))
    if (v) return v
    if (a.id.length !== b.id.length) return a.id.length - b.id.length
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return sorted[0].id
}

type Env = Record<string, string | undefined>

const envName = (prefix: string, providerId: string) => `${prefix}_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`

/** LLM_DEFAULT_MODEL_<PROVIDER>, else LLM_DEFAULT_MODEL (vision: LLM_VISION_MODEL[_<PROVIDER>]). */
export function envDefaultModel(providerId: string, env: Env, o: { vision?: boolean } = {}): string | null {
  const names = o.vision
    ? [envName('LLM_VISION_MODEL', providerId), 'LLM_VISION_MODEL', 'BOT_VISION_MODEL']
    : [envName('LLM_DEFAULT_MODEL', providerId), 'LLM_DEFAULT_MODEL']
  for (const n of names) {
    const id = cleanId(env[n])
    if (id) return id
  }
  return null
}

/** LLM_EXTRA_MODELS: comma-separated ids allowed in addition to the live list. */
export function extraModels(env: Env): string[] {
  return String(env.LLM_EXTRA_MODELS ?? '')
    .split(',')
    .map((m) => cleanId(m))
    .filter((m): m is string => !!m)
}

/** The env name an admin sets when the list is unreachable. */
export function defaultModelEnvName(providerId: string): string {
  return envName('LLM_DEFAULT_MODEL', providerId)
}

export type ModelChoice =
  | {
      ok: true
      /** The model to call. */
      model: string
      /** What the caller would get with nothing saved. */
      defaultModel: string
      /** A requested or saved id was not available and `model` replaced it. */
      fallback: boolean
      /** The id that was replaced, when `fallback`. */
      replaced?: string
    }
  | { ok: false; error: string }

/**
 * Which model to call. `models` is the live list (null when it could not be
 * fetched). Tried in order: `requested` (the browser's pick), `saved` (an org
 * credential's or BOT_LLM_MODEL), the default. Only ids in the live list,
 * LLM_EXTRA_MODELS or the env default are ever returned.
 */
export function resolveModel(o: {
  providerId: string
  label?: string
  models: ModelInfo[] | null
  requested?: string | null
  saved?: string | null
  env: Env
  vision?: boolean
  listError?: string
}): ModelChoice {
  const label = o.label ?? o.providerId
  const extras = extraModels(o.env)
  const envDefault = envDefaultModel(o.providerId, o.env, { vision: o.vision })
  const live = o.models ? (o.vision ? o.models.filter((m) => m.vision) : o.models).map((m) => m.id) : []
  const allowed = new Set([...live, ...extras])

  let defaultModel: string | null
  if (o.models === null) {
    defaultModel = envDefault
    if (envDefault) allowed.add(envDefault)
    if (!defaultModel) {
      return {
        ok: false,
        error: `Can't reach ${label} to list models; set ${o.vision ? envName('LLM_VISION_MODEL', o.providerId) : defaultModelEnvName(o.providerId)}${o.listError ? ` (${o.listError})` : ''}`,
      }
    }
  } else {
    defaultModel = envDefault && allowed.has(envDefault) ? envDefault : pickDefaultModel(o.models, { vision: o.vision })
    if (!defaultModel) {
      return {
        ok: false,
        error: o.vision
          ? `${label} offers no model that reads images; set ${envName('LLM_VISION_MODEL', o.providerId)}`
          : `${label} returned no chat models; set ${defaultModelEnvName(o.providerId)}`,
      }
    }
  }

  const requested = cleanId(o.requested)
  const saved = cleanId(o.saved)
  for (const want of [requested, saved]) {
    if (want && allowed.has(want)) {
      return { ok: true, model: want, defaultModel, fallback: !!requested && want !== requested, replaced: want !== requested ? requested ?? undefined : undefined }
    }
  }
  const replaced = requested ?? saved ?? undefined
  return { ok: true, model: defaultModel, defaultModel, fallback: !!replaced && replaced !== defaultModel, replaced: replaced !== defaultModel ? replaced : undefined }
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export type Price = { inputPerM: number; outputPerM: number }

/**
 * LLM_MODEL_PRICES: optional JSON `{ "<model id>": [inputPerM, outputPerM] }`
 * (USD per million tokens). Invalid JSON or entries are ignored.
 */
export function envModelPrices(raw: string | undefined): Record<string, Price> {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  const out: Record<string, Price> = {}
  if (!parsed || typeof parsed !== 'object') return out
  for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
      out[id] = { inputPerM: v[0] as number, outputPerM: v[1] as number }
    }
  }
  return out
}

/** The list price the provider returned for `model` (OpenRouter), if any. */
export function listedPrice(models: ModelInfo[] | null | undefined, model: string): Price | undefined {
  const m = models?.find((x) => x.id === model)
  return m && m.inputPerM !== undefined && m.outputPerM !== undefined
    ? { inputPerM: m.inputPerM, outputPerM: m.outputPerM }
    : undefined
}

/** What the browser and settings page see of a model. */
export function publicModel(m: ModelInfo): { id: string; label: string | null; vision: boolean } {
  return { id: m.id, label: m.label ?? null, vision: m.vision }
}

/**
 * The picker's options: the live list, plus LLM_EXTRA_MODELS and the
 * default when they are not in it (so an env default shows when the list is
 * unreachable).
 */
export function pickerModels(
  models: ModelInfo[] | null,
  env: Env,
  defaultModel?: string | null,
): { id: string; label: string | null; vision: boolean }[] {
  const out = (models ?? []).map(publicModel)
  const seen = new Set(out.map((m) => m.id))
  for (const id of [...extraModels(env), ...(defaultModel ? [defaultModel] : [])]) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, label: null, vision: false })
  }
  return out
}
