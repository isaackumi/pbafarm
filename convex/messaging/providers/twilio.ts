import {
  basicAuth,
  isRetryableStatus,
  networkFailure,
  providerError,
  readJson,
  type ChannelConfig,
  type Credentials,
  type ProviderAdapter,
  type SendInput,
  type SendResult,
} from './types'

/**
 * Twilio Programmable Messaging (SMS) and Twilio WhatsApp.
 *
 * Verified 2026-11-18 against:
 * - https://www.twilio.com/docs/messaging/api/message-resource
 *   POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json,
 *   Basic auth AccountSid:AuthToken, form fields To, From | MessagingServiceSid,
 *   Body | ContentSid (+ ContentVariables JSON). 201 with the Message, id in `sid`.
 * - https://www.twilio.com/docs/usage/twilios-response (error JSON: status, message, code)
 * - https://www.twilio.com/docs/whatsapp/api and
 *   https://www.twilio.com/docs/whatsapp/key-concepts: WhatsApp addresses are
 *   "whatsapp:+E164"; outside the 24-hour customer-service window only an
 *   approved template (ContentSid) may be sent, free text fails with 63016
 *   (https://www.twilio.com/docs/api/errors/63016), usually after the 201.
 */
async function sendTwilio(
  input: SendInput,
  creds: Credentials,
  config: ChannelConfig,
  whatsapp: boolean,
  fetchImpl: typeof fetch,
): Promise<SendResult> {
  const sid = creds.accountSid ?? ''
  const form = new URLSearchParams()
  form.set('To', whatsapp ? `whatsapp:${input.to}` : input.to)
  const service = config.settings.messagingServiceSid
  if (service) {
    form.set('MessagingServiceSid', service)
  } else {
    const from = config.senderId ?? ''
    form.set('From', whatsapp && !from.startsWith('whatsapp:') ? `whatsapp:${from}` : from)
  }
  const contentSid = config.settings.contentSid
  if (whatsapp && contentSid) {
    // Approved template whose variable {{1}} is the code (or the test text).
    form.set('ContentSid', contentSid)
    form.set('ContentVariables', JSON.stringify({ 1: input.otpCode ?? input.body }))
  } else {
    form.set('Body', input.body)
  }
  try {
    const res = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: basicAuth(sid, creds.authToken ?? ''),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
      },
    )
    const { json, text } = await readJson(res)
    if (!res.ok) {
      const detail = json?.message
        ? `Twilio ${json.code ?? res.status}: ${String(json.message).slice(0, 160)}`
        : providerError(res.status, text)
      return { ok: false, error: detail, retryable: isRetryableStatus(res.status) }
    }
    return { ok: true, providerMessageId: json?.sid ?? undefined }
  } catch (err) {
    return networkFailure(err)
  }
}

const credentialFields = [
  { key: 'authToken', label: 'Auth token', required: true, env: 'TWILIO_AUTH_TOKEN' },
  { key: 'accountSid', label: 'Account SID', required: true, env: 'TWILIO_ACCOUNT_SID' },
]

export const twilio: ProviderAdapter = {
  id: 'twilio',
  label: 'Twilio SMS',
  channels: ['sms'],
  credentialFields,
  settingFields: [
    {
      key: 'messagingServiceSid',
      label: 'Messaging Service SID (optional, replaces the sender)',
      required: false,
      env: 'TWILIO_MESSAGING_SERVICE_SID',
    },
  ],
  senderLabel: 'From number (E.164) or alphanumeric sender ID',
  senderRequired: false,
  send: (input, creds, config, fetchImpl = fetch) =>
    sendTwilio(input, creds, config, false, fetchImpl),
}

export const twilioWhatsapp: ProviderAdapter = {
  id: 'twilio_whatsapp',
  label: 'Twilio WhatsApp',
  channels: ['whatsapp'],
  credentialFields,
  settingFields: [
    {
      key: 'contentSid',
      label: 'Approved template Content SID (HX…), variable {{1}} = code',
      required: false,
      help: 'Needed to reach people who have not messaged you in the last 24 hours.',
      env: 'TWILIO_CONTENT_SID',
    },
    {
      key: 'messagingServiceSid',
      label: 'Messaging Service SID (optional, replaces the sender)',
      required: false,
      env: 'TWILIO_MESSAGING_SERVICE_SID',
    },
  ],
  senderLabel: 'WhatsApp sender number (E.164)',
  senderRequired: false,
  send: (input, creds, config, fetchImpl = fetch) =>
    sendTwilio(input, creds, config, true, fetchImpl),
}
