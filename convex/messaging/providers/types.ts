import type { MessagingChannel, MessagingProvider } from '../validators'

/**
 * One outbound message (doc 18 §3). `to` is E.164 ("+233…") for sms/whatsapp
 * and an address for email. `otpCode` marks a one-time code: WhatsApp needs it
 * as a template parameter because business-initiated free text is refused
 * outside the 24-hour customer-service window.
 */
export type SendInput = {
  to: string
  body: string
  channel: MessagingChannel
  subject?: string
  otpCode?: string
}

export type SendResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; error: string; retryable: boolean }

/** Decrypted credentials (never stored in plaintext, never logged). */
export type Credentials = Record<string, string>

/** Non-secret channel configuration: sender plus provider settings. */
export type ChannelConfig = {
  senderId?: string
  settings: Record<string, string>
}

export type FieldSpec = {
  key: string
  label: string
  required: boolean
  help?: string
  /** Platform default reads PLATFORM_<env> from the Convex environment. */
  env: string
}

export type ProviderAdapter = {
  id: MessagingProvider
  label: string
  channels: MessagingChannel[]
  /** Secret fields, stored encrypted; the first one gives the UI hint. */
  credentialFields: FieldSpec[]
  /** Non-secret settings fields. */
  settingFields: FieldSpec[]
  senderLabel: string
  senderRequired: boolean
  send(
    input: SendInput,
    creds: Credentials,
    config: ChannelConfig,
    fetchImpl?: typeof fetch,
  ): Promise<SendResult>
}

/** Short, credential-free error text from a provider response. */
export function providerError(status: number, text: string): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return `HTTP ${status}${clean ? `: ${clean}` : ''}`
}

/** 429 and 5xx are worth retrying; other 4xx are configuration problems. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

export function basicAuth(user: string, pass: string): string {
  return `Basic ${btoa(`${user}:${pass}`)}`
}

export async function readJson(res: Response): Promise<{ json: any; text: string }> {
  const text = await res.text()
  try {
    return { json: JSON.parse(text), text }
  } catch {
    return { json: null, text }
  }
}

export function networkFailure(err: unknown): SendResult {
  const message = err instanceof Error ? err.message : String(err)
  return { ok: false, error: `Network error: ${message.slice(0, 160)}`, retryable: true }
}
