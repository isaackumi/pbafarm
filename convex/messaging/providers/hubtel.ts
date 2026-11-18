import {
  basicAuth,
  isRetryableStatus,
  networkFailure,
  providerError,
  readJson,
  type ProviderAdapter,
} from './types'

/**
 * Hubtel SMS (Ghana).
 *
 * Verified 2026-11-18 against:
 * - https://developers.hubtel.com/docs/business/api_documentation/notification_apis/sms
 *   POST https://sms.hubtel.com/v1/messages/send, Basic auth clientId:clientSecret,
 *   JSON { From, To, Content }; 200/201 with { messageId, status, statusDescription },
 *   where status 0 = submitted and any other status is a failure even in a 201.
 * - https://developers.hubtel.com/docs/personal/api_documentation/messaging/sms
 *   Same path and fields on https://smsc.hubtel.com (Personal accounts).
 * Numbers are sent as digits without '+' ("233546335113"), as in the docs'
 * examples. The sender ID (≤ 11 characters) must be approved by Hubtel.
 * The GET "quick send" puts the secret in the URL and is not used.
 */
const HOSTS = ['sms.hubtel.com', 'smsc.hubtel.com']

export const hubtel: ProviderAdapter = {
  id: 'hubtel',
  label: 'Hubtel',
  channels: ['sms'],
  credentialFields: [
    { key: 'clientSecret', label: 'Client secret', required: true, env: 'HUBTEL_CLIENT_SECRET' },
    { key: 'clientId', label: 'Client ID', required: true, env: 'HUBTEL_CLIENT_ID' },
  ],
  settingFields: [
    {
      key: 'host',
      label: 'API host',
      required: false,
      help: 'sms.hubtel.com (Business, default) or smsc.hubtel.com (Personal)',
      env: 'HUBTEL_HOST',
    },
  ],
  senderLabel: 'Sender ID (approved by Hubtel, max 11 characters)',
  senderRequired: true,

  async send(input, creds, config, fetchImpl = fetch) {
    const host = HOSTS.includes(config.settings.host) ? config.settings.host : HOSTS[0]
    try {
      const res = await fetchImpl(`https://${host}/v1/messages/send`, {
        method: 'POST',
        headers: {
          Authorization: basicAuth(creds.clientId, creds.clientSecret),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          From: config.senderId ?? '',
          To: input.to.replace(/^\+/, ''),
          Content: input.body,
        }),
      })
      const { json, text } = await readJson(res)
      if (!res.ok) {
        return { ok: false, error: providerError(res.status, text), retryable: isRetryableStatus(res.status) }
      }
      if (json && typeof json.status === 'number' && json.status !== 0) {
        return {
          ok: false,
          error: `Hubtel status ${json.status}: ${String(json.statusDescription ?? '').slice(0, 160)}`,
          retryable: false,
        }
      }
      return { ok: true, providerMessageId: json?.messageId ?? undefined }
    } catch (err) {
      return networkFailure(err)
    }
  },
}
