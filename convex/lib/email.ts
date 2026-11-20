/**
 * Platform email for account emails: invites, email verification and password
 * reset (INT-002 email slice, D-009).
 *
 * Account emails are not sent on a tenant's behalf, so they always use the
 * platform default email channel from convex/messaging (doc 18 §6):
 *   PLATFORM_EMAIL_PROVIDER=resend
 *   PLATFORM_EMAIL_SENDER="Anowa <no-reply@your-domain>"
 *   PLATFORM_RESEND_API_KEY=re_…
 * Without it the log adapter prints the message to the Convex logs, so dev and
 * test deployments work without a provider. send() uses fetch: actions only.
 */
import { platformChannelFromEnv } from '../messaging/providers'

export type EmailMessage = {
  to: string
  subject: string
  /** Plain-text part (always sent). */
  text: string
  /** HTML part from convex/lib/emailTemplates. */
  html?: string
}

export interface EmailAdapter {
  readonly name: string
  send(message: EmailMessage): Promise<void>
}

export const logEmailAdapter: EmailAdapter = {
  name: 'log',
  async send(message) {
    console.log(`[email:log] to=${message.to} subject=${message.subject}\n${message.text}`)
  },
}

export function pickEmailAdapter(
  env: Record<string, string | undefined> = process.env,
): EmailAdapter {
  const platform = platformChannelFromEnv('email', env)
  if (!platform) return logEmailAdapter
  return {
    name: platform.adapter.id,
    async send(message) {
      const result = await platform.adapter.send(
        { channel: 'email', to: message.to, subject: message.subject, body: message.text, html: message.html },
        platform.creds,
        platform.config,
      )
      if (!result.ok) throw new Error(`Email not sent: ${result.error}`)
    },
  }
}

/** Public base URL of the web app, for links in emails (SITE_URL). */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}
