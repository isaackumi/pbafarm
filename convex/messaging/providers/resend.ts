import {
  isRetryableStatus,
  networkFailure,
  providerError,
  readJson,
  type ProviderAdapter,
} from './types'

/**
 * Resend (email over HTTPS; the Convex runtime has fetch but no SMTP sockets).
 *
 * Verified 2026-11-18 against:
 * - https://resend.com/docs/api-reference/emails/send-email
 *   POST https://api.resend.com/emails, Bearer API key, JSON { from, to, subject, text };
 *   200 with { id }.
 * - https://resend.com/docs/api-reference/introduction: every request must
 *   carry a User-Agent header (403 otherwise).
 * - https://resend.com/docs/api-reference/errors
 * The from-domain must be verified in Resend before mail reaches anyone but
 * the account owner.
 */
export const resend: ProviderAdapter = {
  id: 'resend',
  label: 'Resend',
  channels: ['email'],
  credentialFields: [{ key: 'apiKey', label: 'API key (re_…)', required: true, env: 'RESEND_API_KEY' }],
  settingFields: [],
  senderLabel: 'From address, e.g. "PBA Farm <alerts@yourfarm.com>"',
  senderRequired: true,

  async send(input, creds, config, fetchImpl = fetch) {
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.apiKey ?? ''}`,
          'Content-Type': 'application/json',
          'User-Agent': 'pbafarm-messaging/1.0',
        },
        body: JSON.stringify({
          from: config.senderId ?? '',
          to: [input.to],
          subject: input.subject ?? 'Message from PBA Farm',
          text: input.body,
        }),
      })
      const { json, text } = await readJson(res)
      if (!res.ok) {
        const detail = json?.message
          ? `Resend ${json.name ?? res.status}: ${String(json.message).slice(0, 160)}`
          : providerError(res.status, text)
        return { ok: false, error: detail, retryable: isRetryableStatus(res.status) }
      }
      return { ok: true, providerMessageId: json?.id ?? undefined }
    } catch (err) {
      return networkFailure(err)
    }
  },
}
