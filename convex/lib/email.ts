/**
 * Platform email adapter (D-009, INT-002 email slice).
 *
 * One interface, picked from the environment:
 * - RESEND_API_KEY set  → Resend HTTP API (sender EMAIL_FROM, default "PBA Farm <no-reply@pbafarm.app>")
 * - otherwise           → log adapter: prints the message to the Convex logs, so
 *                         dev and test deployments work without a provider.
 *
 * When the messaging-channels work lands (convex/messaging/*), its platform
 * default email channel should implement EmailAdapter and replace pickEmailAdapter.
 * send() uses fetch: call it from actions only.
 */
export type EmailMessage = {
  to: string
  subject: string
  text: string
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

export function resendEmailAdapter(apiKey: string, from: string): EmailAdapter {
  return {
    name: 'resend',
    async send(message) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Email provider refused the message (${res.status}): ${body.slice(0, 200)}`)
      }
    },
  }
}

export function pickEmailAdapter(
  env: Record<string, string | undefined> = process.env,
): EmailAdapter {
  const key = env.RESEND_API_KEY
  if (key) return resendEmailAdapter(key, env.EMAIL_FROM || 'PBA Farm <no-reply@pbafarm.app>')
  return logEmailAdapter
}

/** Public base URL of the web app, for links in emails (SITE_URL). */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}
