import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { decodeBody, providerPost, runSend } from './send'
import { providerError, type ProviderAdapter } from './types'

/** Error body: { name, message, statusCode }. Success: { id }. */
const ResendError = Schema.Struct({
  name: Schema.optional(Schema.Unknown),
  message: Schema.optional(Schema.Unknown),
})
const ResendSent = Schema.Struct({ id: Schema.optional(Schema.NullOr(Schema.String)) })

/**
 * Resend (email over HTTPS; the Convex runtime has fetch but no SMTP sockets).
 *
 * Verified 2026-11-18 against:
 * - https://resend.com/docs/api-reference/emails/send-email
 *   POST https://api.resend.com/emails, Bearer API key, JSON { from, to, subject, text };
 *   200 with { id }. Optional `attachments: [{ filename, content (base64) }]`,
 *   content type derived from the filename, 40 MB per email after encoding.
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
  senderLabel: 'From address, e.g. "Anowa <alerts@yourfarm.com>"',
  senderRequired: true,

  send(input, creds, config, fetchImpl) {
    const program = Effect.gen(function* () {
      const res = yield* providerPost(
        {
          url: 'https://api.resend.com/emails',
          headers: {
            Authorization: `Bearer ${creds.apiKey ?? ''}`,
            'Content-Type': 'application/json',
            'User-Agent': 'anowa-messaging/1.0',
          },
          body: JSON.stringify({
            from: config.senderId ?? '',
            to: [input.to],
            subject: input.subject ?? 'Message from Anowa',
            text: input.body,
            ...(input.attachments?.length
              ? {
                  attachments: input.attachments.map((a) => ({ filename: a.filename, content: a.content })),
                }
              : {}),
          }),
        },
        (status, json, text) => {
          const decoded = Schema.decodeUnknownOption(ResendError)(json)
          const err = decoded._tag === 'Some' ? decoded.value : undefined
          return err?.message
            ? `Resend ${err.name ?? status}: ${String(err.message).slice(0, 160)}`
            : providerError(status, text)
        },
      )
      return { providerMessageId: decodeBody(ResendSent, res)?.id ?? undefined }
    })
    return runSend(program, fetchImpl)
  },
}
