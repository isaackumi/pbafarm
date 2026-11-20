/**
 * What a member reads when Anowa cannot answer. The server already replaced
 * the provider's text with a kind (convex/lib/llmErrors); here the kind
 * becomes a translated, human sentence, plus a "what you can do" for people
 * who can fix it (AI settings admins). Never echoes the raw error.
 */

const KINDS = new Set([
  'quota',
  'rate_limited',
  'unavailable',
  'timeout',
  'auth',
  'not_configured',
  'model_unavailable',
  'blocked',
  'too_long',
  'empty',
  'forbidden',
  'invalid',
  'unknown',
])

/** The kind of a thrown assistant error; old servers without `code` count as unknown. */
export function errorKind(err) {
  if (err?.code && KINDS.has(err.code)) return err.code
  if (/no api key/i.test(String(err?.message || ''))) return 'not_configured'
  if (err?.name === 'TypeError' || /failed to fetch|networkerror/i.test(String(err?.message || ''))) return 'offline'
  return 'unknown'
}

/** "in about 22 hours", "in 3 minutes", "in a moment": the retry hint, or ''. */
export function retryHint(t, seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds >= 3600) return t('assistantUi.errors.retryHours', { count: Math.round(seconds / 3600) })
  if (seconds >= 90) return t('assistantUi.errors.retryMinutes', { count: Math.ceil(seconds / 60) })
  return t('assistantUi.errors.retrySoon')
}

/**
 * The sentence to show for a failed question. `canManage` = the member can
 * change AI settings (companies.aiAssistantStatus.canManage): they also get
 * the fix.
 */
export function assistantErrorText(t, err, { canManage = false } = {}) {
  const kind = errorKind(err)
  const parts = [t(`assistantUi.errors.${kind}`)]
  if (kind === 'quota' || kind === 'rate_limited') {
    const when = retryHint(t, err?.retryAfterSec)
    if (when) parts.push(when)
  }
  if (canManage && ['quota', 'auth', 'not_configured', 'model_unavailable'].includes(kind)) {
    parts.push(t(`assistantUi.errors.fix.${kind}`))
  }
  // Errors the app itself wrote (permissions, validation) are already safe and specific.
  if ((kind === 'forbidden' || kind === 'invalid') && err?.message) return err.message
  return parts.join(' ')
}
