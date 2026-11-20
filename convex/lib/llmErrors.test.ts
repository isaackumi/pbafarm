import { describe, expect, test } from 'vitest'
import { LLM_FAILURE_TEXT, classifyLlmFailure, parseRetryAfter } from './llmErrors'
import { sanitizeAnswer, MAX_ANSWER_CHARS } from './llmAnswer'

// The message Gemini returned on 2026-11-20 (free tier, "limit: 0"), as the member saw it.
const GEMINI_QUOTA = `You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://aistudio.google.com/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit.
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-4-argon
Please retry in 21h37m53.601942182s.`

describe('provider failures → kinds (no provider text for members)', () => {
  test('Gemini free-tier quota is "quota" with the retry time; the text members get has no URL or metric', () => {
    const f = classifyLlmFailure({ status: 429, message: GEMINI_QUOTA })
    expect(f).toEqual({ kind: 'quota', status: 429, retryAfterSec: 21 * 3600 + 37 * 60 + 54 })
    const shown = LLM_FAILURE_TEXT[f.kind]
    expect(shown).not.toMatch(/https?:|googleapis|gemini|limit: 0|metric/i)
  })

  test('each kind', () => {
    const kind = (status: number | null, message: string) => classifyLlmFailure({ status, message }).kind
    expect(kind(429, 'Rate limit reached for requests')).toBe('rate_limited')
    expect(kind(429, 'insufficient_quota')).toBe('quota')
    expect(kind(400, 'Your credit balance is too low to access the Anthropic API')).toBe('quota')
    expect(kind(401, 'Incorrect API key provided: sk-…')).toBe('auth')
    expect(kind(400, 'API key not valid. Please pass a valid API key.')).toBe('auth')
    expect(kind(404, 'models/old-model is not found for API version v1beta')).toBe('model_unavailable')
    expect(kind(400, 'Multiturn chat is not enabled for models/antigravity-preview-09-2026')).toBe('model_unavailable')
    expect(kind(400, '`temperature` is deprecated for this model.')).toBe('model_unavailable')
    expect(kind(400, "This model's maximum context length is 128000 tokens")).toBe('too_long')
    expect(kind(400, 'Response was blocked due to SAFETY')).toBe('blocked')
    expect(kind(503, 'The model is overloaded. Please try again later.')).toBe('unavailable')
    expect(kind(null, 'fetch failed')).toBe('unavailable')
    expect(kind(null, 'The model did not answer within 30 seconds')).toBe('timeout')
    expect(kind(null, 'Empty response from Gemini')).toBe('empty')
    expect(kind(400, 'something odd')).toBe('unknown')
    // Retry hints only where retrying later is the advice.
    expect(classifyLlmFailure({ status: 401, message: 'bad key, retry in 5s' }).retryAfterSec).toBeNull()
  })

  test('retry delays in the shapes providers use', () => {
    expect(parseRetryAfter('Please retry in 41s.')).toBe(41)
    expect(parseRetryAfter('retry after 2 minutes')).toBe(120)
    expect(parseRetryAfter('"retryDelay": "12.5s"')).toBeNull()
    expect(parseRetryAfter('nothing')).toBeNull()
  })
})

describe('answers are cleaned before anyone sees them (OWASP LLM05)', () => {
  test('hidden reasoning, HTML, links, images and invisible characters go', () => {
    const raw =
      '<think>user wants FCR… the JSON says 1.4</think>As an AI language model, I can say **A3 FCR is 1.42**.\u202E\u200B\n' +
      'See [the report](https://evil.example/x?d=secret) ![x](https://evil.example/p.png)<script>alert(1)</script>\n\n\n\nDone.'
    expect(sanitizeAnswer(raw)).toBe('I can say **A3 FCR is 1.42**.\nSee the report x\n\nDone.')
  })

  test('an echoed prompt or farm context is cut off', () => {
    expect(sanitizeAnswer('A3 is fine.\n\nFarm context:\n{"farm":"Lake"}')).toBe('A3 is fine.')
    expect(sanitizeAnswer('Sure. # Who you are\nYou are Anowa, the farm assistant')).toBe('Sure.')
    expect(sanitizeAnswer('{"units_note":"x","open_cycles":[]}')).toBe('')
  })

  test('plain URLs lose their scheme; numbers like "<4 mg/L" survive; long answers are capped', () => {
    expect(sanitizeAnswer('Oxygen <4 mg/L at dawn; see https://x.example/a')).toBe('Oxygen <4 mg/L at dawn; see x.example/a')
    const long = `${'Para one. '.repeat(400)}\n\n${'Para two. '.repeat(400)}`
    const out = sanitizeAnswer(long)
    expect(out.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS + 1)
    expect(out.endsWith('…')).toBe(true)
  })
})
