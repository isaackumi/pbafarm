/**
 * Chat channel bindings (doc 23 §3): the /account card's functions and the
 * revocation helpers other modules call when a phone or membership changes.
 *
 * Binding needs proof from both sides:
 * - WhatsApp: the sender's number is the user's verified phone (PR #88) AND
 *   the user sends the one-time code shown on /account ("LINK 123456").
 * - Telegram: the user opens t.me/<bot>?start=<one-time token> from /account
 *   (the token is 32 random bytes; only its hash is stored).
 */
import { v } from 'convex/values'
import { internalMutation, mutation, query } from '../_generated/server'
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { memberContextIn, requireAccount } from '../lib/permissions'
import { randomDigits, randomToken, sha256Hex } from '../lib/tokens'
import { rateLimiter, retryAfterText } from '../lib/rateLimits'
import { userError } from '../lib/errors'
import { isValidTimezone } from '../lib/orgProfile'
import { botProvider } from './tables'

export const CONNECT_CODE_TTL_MS = 10 * 60 * 1000
const MAX_BINDINGS_PER_USER = 10

export function codeHash(provider: 'whatsapp' | 'telegram', code: string) {
  return sha256Hex(`bot-connect:${provider}:${code}`)
}

/** Revoke a user's live bindings, optionally only one provider or one company. */
export async function revokeBindingsForUser(
  ctx: MutationCtx,
  userId: Id<'users'>,
  reason: string,
  filter?: { provider?: 'whatsapp' | 'telegram'; companyId?: Id<'companies'> },
): Promise<number> {
  const rows = await ctx.db
    .query('channelBindings')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(50)
  let n = 0
  for (const b of rows) {
    if (b.revokedAt) continue
    if (filter?.provider && b.provider !== filter.provider) continue
    if (filter?.companyId && b.companyId !== filter.companyId) continue
    await ctx.db.patch(b._id, { revokedAt: Date.now(), revokedReason: reason, reminderEnabled: false })
    n++
  }
  return n
}

/** After a password reset, chat bots linked to the account stop working. */
export const revokeAfterPasswordReset = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email))
      .first()
    if (user) await revokeBindingsForUser(ctx, user._id, 'password_reset')
    return null
  },
})

/**
 * The user's phone changed or lost its verification: WhatsApp bindings for
 * any other number stop at once (checkBinding also refuses them lazily).
 */
export async function revokeWhatsAppNotMatching(
  ctx: MutationCtx,
  userId: Id<'users'>,
  phone: string | undefined,
  verified: boolean,
): Promise<number> {
  const rows = await ctx.db
    .query('channelBindings')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(50)
  let n = 0
  for (const b of rows) {
    if (b.revokedAt || b.provider !== 'whatsapp') continue
    if (verified && b.address === phone) continue
    await ctx.db.patch(b._id, { revokedAt: Date.now(), revokedReason: 'phone_changed', reminderEnabled: false })
    n++
  }
  return n
}

const bindingView = v.object({
  id: v.id('channelBindings'),
  provider: botProvider,
  address: v.string(),
  displayName: v.union(v.string(), v.null()),
  companyName: v.string(),
  siteName: v.union(v.string(), v.null()),
  verifiedAt: v.number(),
  reminderEnabled: v.boolean(),
  reminderTime: v.string(),
  reminderTimezone: v.union(v.string(), v.null()),
})

/** The caller's channels for the /account card. */
export const myChannels = query({
  args: {},
  returns: v.object({
    whatsapp: v.object({
      configured: v.boolean(),
      botNumber: v.union(v.string(), v.null()),
      phone: v.union(v.string(), v.null()),
      phoneVerified: v.boolean(),
    }),
    telegram: v.object({ configured: v.boolean(), botUsername: v.union(v.string(), v.null()) }),
    bindings: v.array(bindingView),
  }),
  handler: async (ctx) => {
    const user = await requireAccount(ctx, { ignoreActAs: true })
    const rows = await ctx.db
      .query('channelBindings')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .take(50)
    const bindings = []
    for (const b of rows) {
      if (b.revokedAt) continue
      const company = await ctx.db.get(b.companyId)
      const site = b.activeSiteId ? await ctx.db.get(b.activeSiteId) : null
      bindings.push({
        id: b._id,
        provider: b.provider,
        address: b.address,
        displayName: b.displayName ?? null,
        companyName: company?.name ?? '',
        siteName: site?.name ?? null,
        verifiedAt: b.verifiedAt,
        reminderEnabled: b.reminderEnabled === true,
        reminderTime: b.reminderTime ?? '17:00',
        reminderTimezone: b.reminderTimezone ?? null,
      })
    }
    return {
      whatsapp: {
        configured: !!(process.env.WHATSAPP_BOT_PHONE_NUMBER_ID && process.env.WHATSAPP_BOT_ACCESS_TOKEN),
        botNumber: process.env.WHATSAPP_BOT_DISPLAY_NUMBER || null,
        phone: user.phone ?? null,
        phoneVerified: !!(user.phone && user.phoneVerificationTime),
      },
      telegram: {
        configured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET),
        botUsername: process.env.TELEGRAM_BOT_USERNAME || null,
      },
      bindings,
    }
  },
})

/**
 * A one-time code (WhatsApp) or deep-link token (Telegram) for the caller's
 * current organization. Earlier unused codes for the provider stop working.
 */
export const createConnectCode = mutation({
  args: { provider: botProvider },
  returns: v.object({
    code: v.string(),
    expiresAt: v.number(),
    link: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { provider }) => {
    const user = await requireAccount(ctx, { ignoreActAs: true })
    const companyId = user.companyId
    if (!companyId || !(await memberContextIn(ctx, user, companyId))) {
      throw userError('FORBIDDEN', 'Join an organization before connecting a chat app')
    }
    if (provider === 'whatsapp' && !(user.phone && user.phoneVerificationTime)) {
      throw userError('VALIDATION', 'Verify your phone number first: WhatsApp connects only from your verified number')
    }
    const verdict = await rateLimiter.limit(ctx, 'botConnectCodePerUser', { key: user._id })
    if (!verdict.ok) throw userError('RATE_LIMITED', `Too many codes. ${retryAfterText(verdict.retryAfter)}`)
    const live = await ctx.db
      .query('channelBindings')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .take(MAX_BINDINGS_PER_USER * 3)
    if (live.filter((b) => !b.revokedAt).length >= MAX_BINDINGS_PER_USER) {
      throw userError('VALIDATION', 'Too many connected chats. Disconnect one first.')
    }

    const old = await ctx.db
      .query('channelConnectCodes')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .take(50)
    const now = Date.now()
    for (const c of old) {
      if (c.provider === provider && !c.usedAt) await ctx.db.patch(c._id, { usedAt: now })
      else if (c.expiresAt < now - 24 * 60 * 60 * 1000) await ctx.db.delete(c._id)
    }

    const code = provider === 'whatsapp' ? randomDigits(6) : randomToken()
    const expiresAt = now + CONNECT_CODE_TTL_MS
    await ctx.db.insert('channelConnectCodes', {
      userId: user._id,
      companyId,
      provider,
      codeHash: await codeHash(provider, code),
      expiresAt,
      createdAt: now,
    })
    let link: string | null = null
    if (provider === 'telegram') {
      const bot = process.env.TELEGRAM_BOT_USERNAME
      link = bot ? `https://t.me/${encodeURIComponent(bot)}?start=${code}` : null
    } else {
      const number = (process.env.WHATSAPP_BOT_DISPLAY_NUMBER || '').replace(/\D/g, '')
      link = number ? `https://wa.me/${number}?text=${encodeURIComponent(`LINK ${code}`)}` : null
    }
    return { code, expiresAt, link }
  },
})

async function ownBinding(
  ctx: MutationCtx,
  user: Doc<'users'>,
  bindingId: Id<'channelBindings'>,
): Promise<Doc<'channelBindings'>> {
  const b = await ctx.db.get(bindingId)
  if (!b || b.userId !== user._id || b.revokedAt) throw userError('NOT_FOUND', 'Connection not found')
  return b
}

export const revokeChannel = mutation({
  args: { bindingId: v.id('channelBindings') },
  returns: v.null(),
  handler: async (ctx, { bindingId }) => {
    const user = await requireAccount(ctx, { ignoreActAs: true })
    const b = await ownBinding(ctx, user, bindingId)
    await ctx.db.patch(b._id, { revokedAt: Date.now(), revokedReason: 'user', reminderEnabled: false })
    return null
  },
})

/** Daily reminder settings (BOT-004), opt-in. */
export const setReminder = mutation({
  args: {
    bindingId: v.id('channelBindings'),
    enabled: v.boolean(),
    time: v.string(),
    timezone: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAccount(ctx, { ignoreActAs: true })
    const b = await ownBinding(ctx, user, args.bindingId)
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(args.time)) throw userError('VALIDATION', 'Time must be HH:MM')
    if (!isValidTimezone(args.timezone)) throw userError('VALIDATION', 'Unknown timezone')
    await ctx.db.patch(b._id, {
      reminderEnabled: args.enabled,
      reminderTime: args.time,
      reminderTimezone: args.timezone,
    })
    return null
  },
})
