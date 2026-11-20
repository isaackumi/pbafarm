/**
 * Pure pieces of the expanded Ask Anowa view (Paper artboards 47 / 47b):
 * date windows, suggested-question topics, the model menu built from the
 * live model list (/api/llm/models, D-022) and the request it turns into.
 * No React, no ids hardcoded: every model shown comes from the provider.
 */

/** Date-range chip options, in days (convex/assistant MAX_DAYS is 90). */
export const RANGE_DAYS = [7, 14, 30, 90]
export const DEFAULT_RANGE_DAYS = 30

/** Topic tabs; each has 9 suggested questions (locales: askAnowa.topics.<key>.q1..q9). */
export const TOPICS = ['growth', 'feed', 'health', 'harvest']
export const QUESTIONS_PER_TOPIC = 9

/** Suggested question keys of a topic, as 3 columns of 3 (artboard 47 grid). */
export function topicColumns(topic) {
  const keys = Array.from({ length: QUESTIONS_PER_TOPIC }, (_, i) => `askAnowa.topics.${topic}.q${i + 1}`)
  return [keys.slice(0, 3), keys.slice(3, 6), keys.slice(6, 9)]
}

/** The "Model" choice: 'auto' or `{ provider, model }` from the live list. */
export const AUTO = 'auto'

/**
 * Menu groups for the model chip: one per usable provider with its live
 * models and capability hints. `catalog` is the /api/llm/models body.
 */
export function modelMenu(catalog) {
  const providers = Array.isArray(catalog?.providers) ? catalog.providers : []
  return providers
    .filter((p) => !p.error && Array.isArray(p.models) && p.models.length > 0)
    .map((p) => ({
      id: p.id,
      label: p.label || p.id,
      models: p.models.map((m) => ({
        id: m.id,
        label: m.label && m.label !== m.id ? m.label : null,
        vision: m.vision === true,
        isDefault: m.id === p.defaultModel,
      })),
    }))
}

/** A saved choice still offered by the live list, else Auto. */
export function resolveChoice(choice, catalog) {
  if (!choice || choice === AUTO || typeof choice !== 'object') return AUTO
  const group = modelMenu(catalog).find((g) => g.id === choice.provider)
  return group && group.models.some((m) => m.id === choice.model) ? choice : AUTO
}

/** Provider/model to send: Auto leaves both to the server (its default provider and model). */
export function requestModel(choice) {
  if (!choice || choice === AUTO) return { provider: undefined, model: undefined }
  return { provider: choice.provider, model: choice.model }
}

/** True when some live model reads images. */
export function hasVisionModel(catalog) {
  return modelMenu(catalog).some((g) => g.models.some((m) => m.vision))
}

/** "1,204" or "2,000+" for a capped count; null when the role cannot see the table. */
export function formatSourceCount(entry, locale = 'en') {
  if (!entry) return null
  const n = new Intl.NumberFormat(locale).format(entry.count)
  return entry.capped ? `${n}+` : n
}

/** Chat history turns to send with a question: the last 8 text turns. */
export function historyFor(messages, limit = 8) {
  return messages
    // Failed turns are our own error text, not conversation: never sent back to the model.
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.failed && typeof m.content === 'string' && m.content)
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }))
}

/** Read `?chat=<id>&view=saved` deep links; ids are Convex ids (alphanumeric). */
export function parseDeepLink(query = {}) {
  const chat = typeof query.chat === 'string' && /^[a-z0-9]{10,64}$/i.test(query.chat) ? query.chat : null
  const view = query.view === 'saved' ? 'saved' : 'ask'
  // `q`: a question to put in the composer (never sent on its own), e.g. from a page's Anowa brief.
  const raw = Array.isArray(query.q) ? query.q[0] : query.q
  const q = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
  return { chat, view, q }
}
