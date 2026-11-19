import { v } from 'convex/values'
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { AUTH_ERROR_MESSAGES } from '../lib/authErrors'
import { logAudit } from '../lib/tenancy'
import {
  MISSING_KEY_MESSAGE,
  decryptJson,
  encryptJson,
  encryptionConfigured,
  randomDigits,
  readEncryptionKey,
  secretHint,
} from '../lib/crypto'
import { COUNTRY_CALLING_CODES, DEFAULT_COUNTRY, isSupportedCountry, maskPhone, normalizePhone } from '../lib/phone'
import { rateLimiter, retryAfterText } from '../lib/rateLimits'
import { adapterCatalog, getAdapter, platformDefaultAvailable } from './providers'
import type { Credentials } from './providers'
import { messagingChannel, messagingProvider, type MessagingChannel } from './validators'
import { assertChannelChangeAllowed } from './policy'
import { requireMember } from '../lib/permissions'

/**
 * Company messaging channels (INT-001, doc 18).
 *
 * Admin-only. Channel rows hold non-secret configuration; credentials are
 * encrypted in an action and stored in integrationSecrets through an internal
 * mutation. Nothing in this file returns a secret or ciphertext to a client.
 */

const CHANNELS: MessagingChannel[] = ['sms', 'whatsapp', 'email']
const MAX_FIELD_LENGTH = 300

type Ctx = QueryCtx | MutationCtx

/** The caller, who must be an admin of a company (super_admins: their own). */
async function requireMessagingAdmin(ctx: Ctx) {
  const { user } = await requireMember(ctx, { permission: 'integrations.manage' })
  if (!user.companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
  return { user, companyId: user.companyId }
}

/** A channel of the caller's company, or "not found" (never another company's). */
async function loadOwnChannel(
  ctx: Ctx,
  companyId: Id<'companies'>,
  channelId: Id<'messagingChannels'>,
) {
  const row = await ctx.db.get(channelId)
  if (!row || row.companyId !== companyId) throw new Error('Messaging channel not found')
  return row
}

export function channelAad(companyId: string, channelId: string) {
  return `${companyId}:${channelId}`
}

function cleanSettings(
  provider: string,
  raw: Record<string, string> | undefined,
): Record<string, string> {
  const adapter = getAdapter(provider)
  if (!adapter) throw new Error('Unknown provider')
  const allowed = new Map(adapter.settingFields.map((f) => [f.key, f]))
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!allowed.has(key)) throw new Error(`Unknown setting "${key}" for ${adapter.label}`)
    const trimmed = String(value ?? '').trim()
    if (trimmed.length > MAX_FIELD_LENGTH) throw new Error(`${allowed.get(key)!.label} is too long`)
    if (trimmed) out[key] = trimmed
  }
  for (const f of adapter.settingFields) {
    if (f.required && !out[f.key]) throw new Error(`${f.label} is required for ${adapter.label}`)
  }
  return out
}

function channelToClient(row: Doc<'messagingChannels'>) {
  // Explicit allow-list: never spread the row (doc 18 §4.2).
  return {
    id: row._id,
    channel: row.channel,
    provider: row.provider,
    status: row.status,
    senderId: row.senderId ?? '',
    settings: row.settings ?? {},
    credentialsConfigured: !!row.credentialsSetAt,
    credentialHint: row.credentialHint ?? null,
    credentialsSetAt: row.credentialsSetAt ?? null,
    lastTestAt: row.lastTestAt ?? null,
    lastTestResult: row.lastTestResult ?? null,
    updatedAt: row.updatedAt,
  }
}

/** Company messaging preferences with defaults applied. */
export function messagingPrefs(company: Doc<'companies'> | null) {
  const s = company?.settings
  const country = s?.defaultCountryCode && isSupportedCountry(s.defaultCountryCode)
    ? s.defaultCountryCode
    : DEFAULT_COUNTRY
  return {
    defaultCountryCode: country,
    usePlatformDefault: {
      sms: s?.messaging?.usePlatformDefaultSms !== false,
      whatsapp: s?.messaging?.usePlatformDefaultWhatsapp !== false,
      email: s?.messaging?.usePlatformDefaultEmail !== false,
    } as Record<MessagingChannel, boolean>,
  }
}

const credentialFieldRow = v.object({
  key: v.string(),
  label: v.string(),
  required: v.boolean(),
  help: v.union(v.string(), v.null()),
})

const providerValues = v.union(
  v.literal('hubtel'),
  v.literal('africastalking'),
  v.literal('twilio'),
  v.literal('whatsapp_cloud'),
  v.literal('twilio_whatsapp'),
  v.literal('resend'),
)

/** Settings page: channels, platform defaults and the provider catalog. */
export const overview = query({
  args: {},
  returns: v.object({
    encryptionReady: v.boolean(),
    defaultCountryCode: v.string(),
    countries: v.array(v.object({ code: v.string(), callingCode: v.string() })),
    platform: v.record(
      v.string(),
      v.object({
        enabled: v.boolean(),
        available: v.boolean(),
        provider: v.union(v.string(), v.null()),
      }),
    ),
    channels: v.array(
      v.object({
        id: v.id('messagingChannels'),
        channel: v.union(v.literal('email'), v.literal('sms'), v.literal('whatsapp')),
        provider: providerValues,
        status: v.union(v.literal('disabled'), v.literal('draft'), v.literal('verified')),
        senderId: v.string(),
        settings: v.record(v.string(), v.string()),
        credentialsConfigured: v.boolean(),
        credentialHint: v.union(v.string(), v.null()),
        credentialsSetAt: v.union(v.number(), v.null()),
        lastTestAt: v.union(v.number(), v.null()),
        lastTestResult: v.union(v.string(), v.null()),
        updatedAt: v.number(),
      }),
    ),
    providers: v.array(
      v.object({
        id: providerValues,
        label: v.string(),
        channels: v.array(v.union(v.literal('email'), v.literal('sms'), v.literal('whatsapp'))),
        senderLabel: v.string(),
        senderRequired: v.boolean(),
        credentialFields: v.array(credentialFieldRow),
        settingFields: v.array(credentialFieldRow),
      }),
    ),
  }),
  handler: async (ctx) => {
    const { companyId } = await requireMessagingAdmin(ctx)
    const company = await ctx.db.get(companyId)
    const rows = await ctx.db
      .query('messagingChannels')
      .withIndex('by_company_and_channel', (q) => q.eq('companyId', companyId))
      .take(20)
    const prefs = messagingPrefs(company)
    const platform = Object.fromEntries(
      CHANNELS.map((c) => {
        const p = platformDefaultAvailable(c)
        return [c, { ...p, enabled: prefs.usePlatformDefault[c] }]
      }),
    )
    return {
      encryptionReady: encryptionConfigured(),
      defaultCountryCode: prefs.defaultCountryCode,
      countries: Object.keys(COUNTRY_CALLING_CODES).map((code) => ({
        code,
        callingCode: `+${COUNTRY_CALLING_CODES[code]}`,
      })),
      platform,
      channels: rows.map(channelToClient),
      providers: adapterCatalog(),
    }
  },
})

/** Create or update the company's channel of one kind (one per channel). */
export const saveChannel = mutation({
  args: {
    channel: messagingChannel,
    provider: messagingProvider,
    senderId: v.optional(v.string()),
    settings: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.id('messagingChannels'),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireMessagingAdmin(ctx)
    const adapter = getAdapter(args.provider)
    if (!adapter || !adapter.channels.includes(args.channel)) {
      throw new Error(`${adapter?.label ?? args.provider} cannot send ${args.channel} messages`)
    }
    const senderId = (args.senderId ?? '').trim()
    if (senderId.length > MAX_FIELD_LENGTH) throw new Error('Sender is too long')
    if (adapter.senderRequired && !senderId) throw new Error(`${adapter.senderLabel} is required`)
    const settings = cleanSettings(args.provider, args.settings)
    const now = Date.now()

    const existing = await ctx.db
      .query('messagingChannels')
      .withIndex('by_company_and_channel', (q) =>
        q.eq('companyId', companyId).eq('channel', args.channel),
      )
      .first()

    if (existing) {
      await assertChannelChangeAllowed(ctx, companyId, existing.channel)
      const providerChanged = existing.provider !== args.provider
      if (providerChanged) {
        // The stored credentials belong to the old provider.
        const secret = await ctx.db
          .query('integrationSecrets')
          .withIndex('by_channel', (q) => q.eq('channelId', existing._id))
          .unique()
        if (secret) await ctx.db.delete(secret._id)
      }
      await ctx.db.patch(existing._id, {
        provider: args.provider,
        senderId: senderId || undefined,
        settings,
        // Any change needs a fresh successful test before codes go out.
        status: 'draft',
        ...(providerChanged
          ? { credentialHint: undefined, credentialsSetAt: undefined }
          : {}),
        updatedBy: user._id,
        updatedAt: now,
      })
      await logAudit(ctx, {
        actionType: 'messaging_channel_update',
        tableName: 'messagingChannels',
        recordId: existing._id,
        previousValues: {
          provider: existing.provider,
          senderId: existing.senderId,
          settings: existing.settings,
          status: existing.status,
        },
        newValues: { provider: args.provider, senderId, settings, status: 'draft', providerChanged },
      })
      return existing._id
    }

    const id = await ctx.db.insert('messagingChannels', {
      companyId,
      channel: args.channel,
      provider: args.provider,
      status: 'draft',
      senderId: senderId || undefined,
      settings,
      updatedBy: user._id,
      updatedAt: now,
    })
    await logAudit(ctx, {
      actionType: 'messaging_channel_create',
      tableName: 'messagingChannels',
      recordId: id,
      newValues: { channel: args.channel, provider: args.provider, senderId, settings },
    })
    return id
  },
})

/** Stop using a channel; credentials are kept so it can be re-tested later. */
export const disableChannel = mutation({
  args: { channelId: v.id('messagingChannels') },
  returns: v.id('messagingChannels'),
  handler: async (ctx, { channelId }) => {
    const { user, companyId } = await requireMessagingAdmin(ctx)
    const row = await loadOwnChannel(ctx, companyId, channelId)
    await assertChannelChangeAllowed(ctx, companyId, row.channel)
    await ctx.db.patch(channelId, { status: 'disabled', updatedBy: user._id, updatedAt: Date.now() })
    await logAudit(ctx, {
      actionType: 'messaging_channel_disable',
      tableName: 'messagingChannels',
      recordId: channelId,
      previousValues: { status: row.status },
      newValues: { status: 'disabled' },
    })
    return channelId
  },
})

/** Delete a channel and its encrypted credentials. */
export const removeChannel = mutation({
  args: { channelId: v.id('messagingChannels') },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    const { companyId } = await requireMessagingAdmin(ctx)
    const row = await loadOwnChannel(ctx, companyId, channelId)
    await assertChannelChangeAllowed(ctx, companyId, row.channel)
    const secret = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .unique()
    if (secret) await ctx.db.delete(secret._id)
    await ctx.db.delete(channelId)
    await logAudit(ctx, {
      actionType: 'messaging_channel_remove',
      tableName: 'messagingChannels',
      recordId: channelId,
      previousValues: { channel: row.channel, provider: row.provider, senderId: row.senderId },
    })
    return null
  },
})

/** Default country for local numbers, and use of the platform default channels. */
export const updatePreferences = mutation({
  args: {
    defaultCountryCode: v.optional(v.string()),
    usePlatformDefaultSms: v.optional(v.boolean()),
    usePlatformDefaultWhatsapp: v.optional(v.boolean()),
    usePlatformDefaultEmail: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { companyId } = await requireMessagingAdmin(ctx)
    const company = await ctx.db.get(companyId)
    if (!company) throw new Error('Company not found')
    if (args.defaultCountryCode !== undefined && !isSupportedCountry(args.defaultCountryCode)) {
      throw new Error('Unsupported country')
    }
    const settings = company.settings ?? { aiAssistantEnabled: false }
    const messaging = { ...(settings.messaging ?? {}) }
    if (args.usePlatformDefaultSms !== undefined) messaging.usePlatformDefaultSms = args.usePlatformDefaultSms
    if (args.usePlatformDefaultWhatsapp !== undefined) messaging.usePlatformDefaultWhatsapp = args.usePlatformDefaultWhatsapp
    if (args.usePlatformDefaultEmail !== undefined) messaging.usePlatformDefaultEmail = args.usePlatformDefaultEmail
    if (args.usePlatformDefaultSms === false) await assertChannelChangeAllowed(ctx, companyId, 'sms', true)
    if (args.usePlatformDefaultWhatsapp === false) await assertChannelChangeAllowed(ctx, companyId, 'whatsapp', true)
    const next = {
      ...settings,
      messaging,
      ...(args.defaultCountryCode !== undefined ? { defaultCountryCode: args.defaultCountryCode } : {}),
    }
    await ctx.db.patch(companyId, { settings: next })
    await logAudit(ctx, {
      actionType: 'messaging_preferences_update',
      tableName: 'companies',
      recordId: companyId,
      previousValues: {
        defaultCountryCode: settings.defaultCountryCode,
        messaging: settings.messaging,
      },
      newValues: args,
    })
    return null
  },
})

// ---------------------------------------------------------------------------
// Credentials (write-only) and test sends. Actions: encryption needs a random
// IV and decrypted credentials must stay inside the action.
// ---------------------------------------------------------------------------

/** Internal: the channel's company and provider, for an admin of that company. */
export const channelForAdmin = internalQuery({
  args: { channelId: v.id('messagingChannels') },
  returns: v.object({
    companyId: v.id('companies'),
    provider: providerValues,
    channel: v.union(v.literal('email'), v.literal('sms'), v.literal('whatsapp')),
  }),
  handler: async (ctx, { channelId }) => {
    const { companyId } = await requireMessagingAdmin(ctx)
    const row = await loadOwnChannel(ctx, companyId, channelId)
    return { companyId, provider: row.provider, channel: row.channel }
  },
})

/** Internal: store already-encrypted credentials (the plaintext never gets here). */
export const storeCredentials = internalMutation({
  args: {
    channelId: v.id('messagingChannels'),
    provider: messagingProvider,
    ciphertext: v.string(),
    iv: v.string(),
    keyVersion: v.number(),
    hint: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireMessagingAdmin(ctx)
    const row = await loadOwnChannel(ctx, companyId, args.channelId)
    if (row.provider !== args.provider) {
      throw new Error('The provider changed while saving. Enter the credentials again.')
    }
    await assertChannelChangeAllowed(ctx, companyId, row.channel)
    const now = Date.now()
    const existing = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_channel', (q) => q.eq('channelId', args.channelId))
      .unique()
    const secretRow = {
      companyId,
      channelId: args.channelId,
      ciphertext: args.ciphertext,
      iv: args.iv,
      keyVersion: args.keyVersion,
      updatedAt: now,
    }
    if (existing) await ctx.db.replace(existing._id, secretRow)
    else await ctx.db.insert('integrationSecrets', secretRow)
    await ctx.db.patch(args.channelId, {
      credentialHint: args.hint,
      credentialsSetAt: now,
      status: row.status === 'disabled' ? 'disabled' : 'draft',
      updatedBy: user._id,
      updatedAt: now,
    })
    // Records that credentials changed, never their value.
    await logAudit(ctx, {
      actionType: 'messaging_credentials_set',
      tableName: 'messagingChannels',
      recordId: args.channelId,
      newValues: { provider: row.provider, replaced: !!existing, keyVersion: args.keyVersion },
    })
    return null
  },
})

/**
 * Save a channel's credentials. The fields are encrypted here and only the
 * ciphertext is stored; the response never echoes them.
 */
export const saveCredentials = action({
  args: {
    channelId: v.id('messagingChannels'),
    credentials: v.record(v.string(), v.string()),
  },
  returns: v.object({ hint: v.union(v.string(), v.null()) }),
  handler: async (ctx, args): Promise<{ hint: string | null }> => {
    const owner: { companyId: Id<'companies'>; provider: string } = await ctx.runQuery(
      internal.messaging.channels.channelForAdmin,
      { channelId: args.channelId },
    )
    const adapter = getAdapter(owner.provider)
    if (!adapter) throw new Error('Unknown provider')
    const creds: Credentials = {}
    const allowed = new Set(adapter.credentialFields.map((f) => f.key))
    for (const [key, value] of Object.entries(args.credentials)) {
      if (!allowed.has(key)) throw new Error(`Unknown credential "${key}" for ${adapter.label}`)
      const trimmed = String(value ?? '').trim()
      if (trimmed.length > 2000) throw new Error('Credential value is too long')
      if (trimmed) creds[key] = trimmed
    }
    for (const f of adapter.credentialFields) {
      if (f.required && !creds[f.key]) throw new Error(`${f.label} is required`)
    }
    const key = readEncryptionKey()
    if (!key) throw new Error(MISSING_KEY_MESSAGE)
    const sealed = await encryptJson(creds, channelAad(owner.companyId, args.channelId), key)
    const hint = secretHint(creds[adapter.credentialFields[0].key])
    await ctx.runMutation(internal.messaging.channels.storeCredentials, {
      channelId: args.channelId,
      provider: adapter.id,
      ...sealed,
      hint,
    })
    return { hint: hint ?? null }
  },
})

/** Internal: rate-limit a test send and hand the action what it needs to send. */
export const prepareTest = internalMutation({
  args: { channelId: v.id('messagingChannels') },
  returns: v.object({
    companyId: v.id('companies'),
    channel: v.union(v.literal('email'), v.literal('sms'), v.literal('whatsapp')),
    provider: providerValues,
    senderId: v.optional(v.string()),
    settings: v.record(v.string(), v.string()),
    secret: v.object({ ciphertext: v.string(), iv: v.string() }),
    defaultCountryCode: v.string(),
  }),
  handler: async (ctx, { channelId }) => {
    const { companyId } = await requireMessagingAdmin(ctx)
    const row = await loadOwnChannel(ctx, companyId, channelId)
    if (row.status === 'disabled') throw new Error('This channel is disabled. Save it again to re-enable it.')
    const secret = await ctx.db
      .query('integrationSecrets')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .unique()
    if (!secret) throw new Error('Enter the provider credentials before sending a test.')
    const limit = await rateLimiter.limit(ctx, 'messagingTestPerCompany', { key: companyId })
    if (!limit.ok) {
      throw new Error(`Too many test messages. ${retryAfterText(limit.retryAfter)}`)
    }
    const company = await ctx.db.get(companyId)
    return {
      companyId,
      channel: row.channel,
      provider: row.provider,
      senderId: row.senderId,
      settings: row.settings ?? {},
      secret: { ciphertext: secret.ciphertext, iv: secret.iv },
      defaultCountryCode: messagingPrefs(company).defaultCountryCode,
    }
  },
})

/** Internal: store the outcome of a test; success marks the channel verified. */
export const recordTest = internalMutation({
  args: {
    channelId: v.id('messagingChannels'),
    ok: v.boolean(),
    result: v.string(),
    to: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireMessagingAdmin(ctx)
    const row = await loadOwnChannel(ctx, companyId, args.channelId)
    const now = Date.now()
    await ctx.db.patch(args.channelId, {
      lastTestAt: now,
      lastTestResult: args.result,
      ...(args.ok && row.status === 'draft' ? { status: 'verified' as const } : {}),
      updatedBy: user._id,
      updatedAt: now,
    })
    await logAudit(ctx, {
      actionType: 'messaging_channel_test',
      tableName: 'messagingChannels',
      recordId: args.channelId,
      newValues: { ok: args.ok, result: args.result, to: args.to },
    })
    return null
  },
})

/** Send a test message; on success the channel becomes verified. */
export const sendTest = action({
  args: { channelId: v.id('messagingChannels'), to: v.string() },
  returns: v.object({ ok: v.boolean(), error: v.union(v.string(), v.null()) }),
  handler: async (ctx, args): Promise<{ ok: boolean; error: string | null }> => {
    const prep: {
      companyId: Id<'companies'>
      channel: MessagingChannel
      provider: string
      senderId?: string
      settings: Record<string, string>
      secret: { ciphertext: string; iv: string }
      defaultCountryCode: string
    } = await ctx.runMutation(internal.messaging.channels.prepareTest, {
      channelId: args.channelId,
    })
    const adapter = getAdapter(prep.provider)
    if (!adapter) throw new Error('Unknown provider')

    let to: string | null
    let maskedTo: string
    if (prep.channel === 'email') {
      const email = args.to.trim().toLowerCase()
      to = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
      maskedTo = to ? to.replace(/^(.).*(@.*)$/, '$1…$2') : ''
    } else {
      to = normalizePhone(args.to, prep.defaultCountryCode)
      maskedTo = maskPhone(to)
    }
    if (!to) throw new Error(prep.channel === 'email' ? 'Enter a valid email address' : 'Enter a valid phone number')

    const creds = await decryptJson<Credentials>(
      prep.secret,
      channelAad(prep.companyId, args.channelId),
    ).catch(() => {
      throw new Error('Saved credentials cannot be read. Enter them again.')
    })
    const code = randomDigits(6)
    const result = await adapter.send(
      {
        to,
        channel: prep.channel,
        subject: 'PBA Farm test message',
        body: `PBA Farm test message: your ${prep.channel.toUpperCase()} channel works.`,
        otpCode: code,
      },
      creds,
      { senderId: prep.senderId, settings: prep.settings },
    )
    await ctx.runMutation(internal.messaging.channels.recordTest, {
      channelId: args.channelId,
      ok: result.ok,
      result: result.ok ? 'ok' : result.error,
      to: maskedTo,
    })
    return { ok: result.ok, error: result.ok ? null : result.error }
  },
})
