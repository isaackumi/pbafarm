/**
 * Clean a model's answer before anyone sees it (OWASP LLM05, improper output
 * handling: model output is untrusted). Pure; used by the Next chat route and
 * available to the farm bot.
 *
 * - Hidden reasoning (`<think>…</think>`), raw HTML, invisible and
 *   bidirectional-override characters are removed.
 * - Images and links become their text: an answer can never load a URL
 *   (the classic prompt-injection exfiltration route) or send someone off-app.
 * - A leaked system prompt or farm-context JSON is cut off.
 * - "As an AI language model…" openers are dropped; the voice is Anowa's.
 * - Length is capped at a paragraph boundary.
 *
 * The browser still renders the result as text (components/AnswerText), never
 * as HTML.
 */

export const MAX_ANSWER_CHARS = 6000

/** Markers that only appear when the model echoes its instructions or the context. */
const LEAK_MARKERS = [
  /Farm context\s*:/i,
  /"units_note"\s*:/,
  /"open_cycles"\s*:\s*\[/,
  /You are Anowa, the farm assistant/i,
  /# (?:Who you are|How you answer|Boundaries)\b/,
]

const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g

const AI_OPENER =
  /^(?:(?:as an ai(?: language model| assistant)?|as a (?:large )?language model|i am an ai(?: language model| assistant)?)[^.!?,\n]*[.!?,]\s*)/i

export function sanitizeAnswer(raw: string): string {
  let text = String(raw ?? '').replace(/\r\n?/g, '\n')

  // Reasoning some models emit inline (DeepSeek, Qwen via OpenRouter/Groq).
  text = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/^[\s\S]*?<\/think(?:ing)?>/i, '')

  text = text.replace(INVISIBLE, '')

  // Cut at the first sign of an echoed prompt or context.
  let cut = text.length
  for (const marker of LEAK_MARKERS) {
    const m = marker.exec(text)
    if (m && m.index < cut) cut = m.index
  }
  if (cut < text.length) text = text.slice(0, cut).replace(/[\s{[`"]+$/, '')

  // No images, no links, no raw HTML.
  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi, '')
    .replace(/\bhttps?:\/\/\S+/gi, (url) => url.replace(/^https?:\/\//i, ''))

  // Fenced code blocks: keep the text, drop the fences.
  text = text.replace(/^```[\w-]*\s*$/gm, '')

  text = text.trim().replace(AI_OPENER, '')
  if (text) text = text[0].toUpperCase() + text.slice(1)

  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (text.length > MAX_ANSWER_CHARS) {
    const head = text.slice(0, MAX_ANSWER_CHARS)
    const para = head.lastIndexOf('\n\n')
    text = `${(para > MAX_ANSWER_CHARS / 2 ? head.slice(0, para) : head).trimEnd()}…`
  }
  return text
}
