/**
 * Streamed Ask Anowa answers on the plain chat route (pages/api/llm/chat.js
 * with ?stream=1). Server only: it spends the server's provider key.
 *
 * Wire format: newline-delimited JSON (application/x-ndjson), one event per
 * line:
 *   {"type":"text","text":"…"}   the answer so far, display-sanitised
 *                                (sanitizeStreaming); replaces the last one
 *   {"type":"done","text":"…", provider, model, fallback, keySource}
 *                                the final answer (full sanitizeAnswer)
 *   {"type":"error","error":"…","code":"…","retryAfterSec":n|null}
 *                                a classified failure (llmErrors), never the
 *                                provider's text
 * Sending the text so far (not a delta) keeps the browser simple and the
 * sanitiser in charge of every frame; answers are capped at 6,000 characters
 * and frames are throttled, so the bytes stay small.
 *
 * The member's Stop closes the request; the route aborts the provider call
 * through `signal`.
 */
import { streamText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { sanitizeAnswer, sanitizeStreaming } from '../convex/lib/llmAnswer'

export const STREAM_FLUSH_MS = 80
const GEMINI_OPENAI = 'https://generativelanguage.googleapis.com/v1beta/openai'

/** The OpenAI-compatible chat model for a server target (Gemini and Anthropic both offer one). */
export function streamingModel(chat) {
  const baseURL = chat.kind === 'gemini' ? GEMINI_OPENAI : String(chat.baseUrl || '').replace(/\/$/, '')
  if (!baseURL) throw Object.assign(new Error('Custom provider needs a base URL'), { status: 400 })
  const headers = chat.providerId === 'openrouter' ? { 'HTTP-Referer': chat.referer || 'https://localhost', 'X-Title': 'Anowa Assistant' } : undefined
  return createOpenAICompatible({ name: chat.providerId, baseURL, apiKey: chat.apiKey, headers }).chatModel(chat.model)
}

/**
 * Stream one answer: calls `onText(displayText)` at most every `flushMs` with
 * the sanitised text so far, and resolves `{ text, usage, stopped }` with the
 * fully sanitised answer. Throws the provider error (classify it with
 * gatewayError); an abort through `signal` resolves with `stopped: true`.
 */
export async function streamChatReply({ model, messages, temperature, signal, onText, flushMs = STREAM_FLUSH_MS, now = Date.now }) {
  let raw = ''
  let shown = ''
  let last = 0
  let usage = {}
  const emit = (force) => {
    const t = now()
    if (!force && t - last < flushMs) return
    last = t
    const text = sanitizeStreaming(raw)
    if (text !== shown) {
      shown = text
      onText?.(text)
    }
  }
  try {
    const result = streamText({ model, messages, temperature, abortSignal: signal, maxRetries: 1 })
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        raw += part.text
        emit(false)
      } else if (part.type === 'finish') {
        usage = { inputTokens: part.totalUsage?.inputTokens ?? undefined, outputTokens: part.totalUsage?.outputTokens ?? undefined }
      } else if (part.type === 'error') {
        throw part.error
      }
    }
  } catch (err) {
    if (!signal?.aborted) throw err
  }
  const stopped = signal?.aborted === true
  if (!stopped) emit(true)
  return { text: sanitizeAnswer(raw), usage, stopped }
}

/** One NDJSON line. */
export const ndjson = (event) => `${JSON.stringify(event)}\n`
