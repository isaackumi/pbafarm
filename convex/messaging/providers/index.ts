import type { MessagingChannel, MessagingProvider } from '../validators'
import { africastalking } from './africastalking'
import { hubtel } from './hubtel'
import { resend } from './resend'
import { twilio, twilioWhatsapp } from './twilio'
import type { ChannelConfig, Credentials, ProviderAdapter } from './types'
import { whatsappCloud } from './whatsappCloud'

export type { ChannelConfig, Credentials, ProviderAdapter, SendInput, SendResult } from './types'

/** Every adapter, by provider id (doc 18 §3). */
export const ADAPTERS: Record<MessagingProvider, ProviderAdapter> = {
  hubtel,
  africastalking,
  twilio,
  whatsapp_cloud: whatsappCloud,
  twilio_whatsapp: twilioWhatsapp,
  resend,
}

export function getAdapter(provider: string): ProviderAdapter | null {
  return (ADAPTERS as Record<string, ProviderAdapter>)[provider] ?? null
}

export function providersForChannel(channel: MessagingChannel): ProviderAdapter[] {
  return Object.values(ADAPTERS).filter((a) => a.channels.includes(channel))
}

/** Public description of the adapters for the settings form (no secrets). */
export function adapterCatalog() {
  return Object.values(ADAPTERS).map((a) => ({
    id: a.id,
    label: a.label,
    channels: a.channels,
    senderLabel: a.senderLabel,
    senderRequired: a.senderRequired,
    credentialFields: a.credentialFields.map(({ key, label, required, help }) => ({
      key,
      label,
      required,
      help: help ?? null,
    })),
    settingFields: a.settingFields.map(({ key, label, required, help }) => ({
      key,
      label,
      required,
      help: help ?? null,
    })),
  }))
}

/**
 * Platform default channel from the Convex environment (doc 18 §6):
 *   PLATFORM_<CHANNEL>_PROVIDER = hubtel | africastalking | twilio | whatsapp_cloud | twilio_whatsapp | resend
 *   PLATFORM_<CHANNEL>_SENDER   = sender id / from number / from address
 *   PLATFORM_<FIELD ENV>        = each credential and setting of that adapter,
 *                                 e.g. PLATFORM_HUBTEL_CLIENT_ID
 * Returns null when not configured or incomplete. Never sent to clients.
 */
export function platformChannelFromEnv(
  channel: MessagingChannel,
  env: Record<string, string | undefined> = process.env,
): { adapter: ProviderAdapter; creds: Credentials; config: ChannelConfig } | null {
  const prefix = `PLATFORM_${channel.toUpperCase()}`
  const adapter = getAdapter(env[`${prefix}_PROVIDER`]?.trim() ?? '')
  if (!adapter || !adapter.channels.includes(channel)) return null
  const creds: Credentials = {}
  for (const f of adapter.credentialFields) {
    const value = env[`PLATFORM_${f.env}`]?.trim()
    if (!value) {
      if (f.required) return null
      continue
    }
    creds[f.key] = value
  }
  const settings: Record<string, string> = {}
  for (const f of adapter.settingFields) {
    const value = env[`PLATFORM_${f.env}`]?.trim()
    if (!value) {
      if (f.required) return null
      continue
    }
    settings[f.key] = value
  }
  const senderId = env[`${prefix}_SENDER`]?.trim() || undefined
  if (adapter.senderRequired && !senderId) return null
  return { adapter, creds, config: { senderId, settings } }
}

/** Whether the platform offers a default for this channel (safe for queries). */
export function platformDefaultAvailable(
  channel: MessagingChannel,
  env: Record<string, string | undefined> = process.env,
): { available: boolean; provider: string | null } {
  const resolved = platformChannelFromEnv(channel, env)
  return { available: !!resolved, provider: resolved?.adapter.id ?? null }
}
