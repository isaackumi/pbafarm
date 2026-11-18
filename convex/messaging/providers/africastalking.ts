import {
  isRetryableStatus,
  networkFailure,
  providerError,
  readJson,
  type ProviderAdapter,
} from './types'

/**
 * Africa's Talking SMS.
 *
 * Official page (returned HTTP 403 to automated fetches on 2026-11-18, so the
 * request shape below was checked against the official SDK instead):
 * - https://developers.africastalking.com/docs/sms/sending/bulk
 * - https://github.com/AfricasTalkingLtd/africastalking-node.js/blob/master/lib/sms.js
 * - https://github.com/AfricasTalkingLtd/africastalking-node.js/blob/master/lib/common.js
 * POST https://api.africastalking.com/version1/messaging (sandbox:
 * https://api.sandbox.africastalking.com/version1/messaging, username "sandbox"),
 * header apiKey, form-encoded username / to (E.164 with '+') / message / from.
 * 201 with SMSMessageData.Recipients[]; each recipient has a statusCode:
 * 100 Processed, 101 Sent, 102 Queued are success, anything else failed even
 * though the HTTP status is 201. VERIFY against the docs page before go-live.
 */
const SUCCESS_CODES = new Set([100, 101, 102])

export const africastalking: ProviderAdapter = {
  id: 'africastalking',
  label: "Africa's Talking",
  channels: ['sms'],
  credentialFields: [
    { key: 'apiKey', label: 'API key', required: true, env: 'AT_API_KEY' },
  ],
  settingFields: [
    {
      key: 'username',
      label: 'Username',
      required: true,
      help: 'Your Africa\'s Talking app username ("sandbox" for the sandbox)',
      env: 'AT_USERNAME',
    },
  ],
  senderLabel: 'Sender ID or short code (optional)',
  senderRequired: false,

  async send(input, creds, config, fetchImpl = fetch) {
    const username = config.settings.username ?? ''
    const host =
      username === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com'
    const form = new URLSearchParams({ username, to: input.to, message: input.body })
    if (config.senderId) form.set('from', config.senderId)
    try {
      const res = await fetchImpl(`https://${host}/version1/messaging`, {
        method: 'POST',
        headers: {
          apiKey: creds.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      })
      const { json, text } = await readJson(res)
      if (!res.ok) {
        return { ok: false, error: providerError(res.status, text), retryable: isRetryableStatus(res.status) }
      }
      const recipient = json?.SMSMessageData?.Recipients?.[0]
      if (!recipient) {
        const message = String(json?.SMSMessageData?.Message ?? text).slice(0, 160)
        return { ok: false, error: `Not sent: ${message}`, retryable: false }
      }
      if (!SUCCESS_CODES.has(Number(recipient.statusCode))) {
        return {
          ok: false,
          error: `Africa's Talking ${recipient.statusCode}: ${String(recipient.status ?? '').slice(0, 120)}`,
          retryable: Number(recipient.statusCode) >= 500,
        }
      }
      return { ok: true, providerMessageId: recipient.messageId ?? undefined }
    } catch (err) {
      return networkFailure(err)
    }
  },
}
