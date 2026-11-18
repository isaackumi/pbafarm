import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { decodeBody, providerPost, runSend } from './send'
import { providerError, type ProviderAdapter } from './types'

/** Error body: { error: { code, message } }. Success: { messages: [{ id }] }. */
const GraphError = Schema.Struct({
  error: Schema.optional(
    Schema.Struct({ code: Schema.optional(Schema.Unknown), message: Schema.optional(Schema.Unknown) }),
  ),
})
const GraphSent = Schema.Struct({
  messages: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.optional(Schema.NullOr(Schema.String)) }))),
})

/**
 * Meta WhatsApp Cloud API.
 *
 * Verified 2026-11-18 against:
 * - https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates.md
 *   POST https://graph.facebook.com/v27.0/{PHONE_NUMBER_ID}/messages, Bearer token,
 *   type "template"; an authentication template carries the code twice: a body
 *   parameter and the button (sub_type "url", index "0") parameter.
 * - https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages.md
 *   `to` with '+' and country code; free text only inside the 24-hour
 *   customer-service window (error 131047 outside it). Success:
 *   { messages: [{ id: "wamid…" }] } means accepted, delivery comes by webhook.
 * - https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes.md
 *   error JSON { error: { message, type, code, error_data, fbtrace_id } }.
 *
 * Every message we send is business-initiated, so every send uses the
 * configured authentication template; a test send uses a random code.
 */
export const GRAPH_API_VERSION = 'v27.0'

export const whatsappCloud: ProviderAdapter = {
  id: 'whatsapp_cloud',
  label: 'WhatsApp Cloud API (Meta)',
  channels: ['whatsapp'],
  credentialFields: [
    {
      key: 'accessToken',
      label: 'Access token (system user, permanent)',
      required: true,
      env: 'META_ACCESS_TOKEN',
    },
  ],
  settingFields: [
    { key: 'phoneNumberId', label: 'Phone number ID', required: true, env: 'META_PHONE_NUMBER_ID' },
    {
      key: 'templateName',
      label: 'Authentication template name',
      required: true,
      help: 'An approved "Authentication" template with a copy-code button.',
      env: 'META_OTP_TEMPLATE',
    },
    {
      key: 'templateLanguage',
      label: 'Template language code (default en_US)',
      required: false,
      env: 'META_TEMPLATE_LANG',
    },
  ],
  senderLabel: 'Display number (for your reference)',
  senderRequired: false,

  async send(input, creds, config, fetchImpl) {
    const phoneNumberId = config.settings.phoneNumberId ?? ''
    const code = input.otpCode
    if (!code) {
      return {
        ok: false,
        error: 'WhatsApp Cloud API sends only one-time codes through the authentication template.',
        retryable: false,
      }
    }
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      type: 'template',
      template: {
        name: config.settings.templateName ?? '',
        language: { code: config.settings.templateLanguage || 'en_US' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }
    const program = Effect.gen(function* () {
      const res = yield* providerPost(
        {
          url: `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
          headers: {
            Authorization: `Bearer ${creds.accessToken ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
        (status, json, text) => {
          const decoded = Schema.decodeUnknownOption(GraphError)(json)
          const err = decoded._tag === 'Some' ? decoded.value.error : undefined
          return err?.message
            ? `WhatsApp ${err.code ?? status}: ${String(err.message).slice(0, 160)}`
            : providerError(status, text)
        },
      )
      return { providerMessageId: decodeBody(GraphSent, res)?.messages?.[0]?.id ?? undefined }
    })
    return runSend(program, fetchImpl)
  },
}
