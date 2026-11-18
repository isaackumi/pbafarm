import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'
import type { ActionCtx, QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { decryptJson } from '../lib/crypto'
import { getAdapter, platformChannelFromEnv } from './providers'
import type { Credentials, SendInput, SendResult } from './providers'
import { messagingChannel, type MessagingChannel } from './validators'
import { channelAad, messagingPrefs } from './channels'

/**
 * Which sender a company uses for a channel (doc 18 §6):
 * 1. its own channel, if verified (a successful test send);
 * 2. otherwise the platform default, if the deployment has one and the
 *    company has not opted out;
 * 3. otherwise none.
 */
export type Route =
  | {
      kind: 'company'
      channelId: Id<'messagingChannels'>
      provider: string
      senderId?: string
      settings: Record<string, string>
      secret: { ciphertext: string; iv: string }
    }
  | { kind: 'platform'; provider: string }

export async function resolveRouteInQuery(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
  channel: MessagingChannel,
): Promise<Route | null> {
  const row = await ctx.db
    .query('messagingChannels')
    .withIndex('by_company_and_channel', (q) =>
      q.eq('companyId', companyId).eq('channel', channel),
    )
    .first()
  if (row && row.status === 'verified') {
    const secret = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_channel', (q) => q.eq('channelId', row._id))
      .unique()
    if (secret) {
      return {
        kind: 'company',
        channelId: row._id,
        provider: row.provider,
        senderId: row.senderId,
        settings: row.settings ?? {},
        secret: { ciphertext: secret.ciphertext, iv: secret.iv },
      }
    }
  }
  const company = await ctx.db.get(companyId)
  if (!messagingPrefs(company).usePlatformDefault[channel]) return null
  const platform = platformChannelFromEnv(channel)
  return platform ? { kind: 'platform', provider: platform.adapter.id } : null
}

/** Whether the company can send on a channel right now (no secrets). */
export async function channelAvailable(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
  channel: MessagingChannel,
): Promise<boolean> {
  return (await resolveRouteInQuery(ctx, companyId, channel)) !== null
}

/** Internal: the route for a send, including the ciphertext (actions only). */
export const resolveRoute = internalQuery({
  args: { companyId: v.id('companies'), channel: messagingChannel },
  handler: async (ctx, { companyId, channel }) => resolveRouteInQuery(ctx, companyId, channel),
})

/**
 * Send one message for a company from an action. Never throws for provider
 * failures; returns { ok: false } with a short reason instead.
 */
export async function deliverMessage(
  ctx: ActionCtx,
  companyId: Id<'companies'>,
  input: SendInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult & { route: 'company' | 'platform' | 'none' }> {
  const route: Route | null = await ctx.runQuery(internal.messaging.deliver.resolveRoute, {
    companyId,
    channel: input.channel,
  })
  if (!route) {
    return { ok: false, error: 'No messaging channel is available', retryable: false, route: 'none' }
  }
  if (route.kind === 'platform') {
    const platform = platformChannelFromEnv(input.channel)
    if (!platform) {
      return { ok: false, error: 'Platform channel is not configured', retryable: false, route: 'platform' }
    }
    const result = await platform.adapter.send(input, platform.creds, platform.config, fetchImpl)
    return { ...result, route: 'platform' }
  }
  const adapter = getAdapter(route.provider)
  if (!adapter) return { ok: false, error: 'Unknown provider', retryable: false, route: 'company' }
  let creds: Credentials
  try {
    creds = await decryptJson<Credentials>(route.secret, channelAad(companyId, route.channelId))
  } catch {
    return { ok: false, error: 'Saved credentials cannot be read', retryable: false, route: 'company' }
  }
  const result = await adapter.send(
    input,
    creds,
    { senderId: route.senderId, settings: route.settings },
    fetchImpl,
  )
  return { ...result, route: 'company' }
}
