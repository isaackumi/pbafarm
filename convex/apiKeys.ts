import { v } from 'convex/values'
import { action, internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { AUTH_ERROR_MESSAGES } from './lib/authErrors'
import { logAudit } from './lib/tenancy'
import { sha256Hex } from './lib/crypto'
import {
  API_KEY_PREFIX_LENGTH,
  API_KEY_SECRET_LENGTH,
  API_SCOPES,
  isApiScope,
  randomBase62,
} from './integrations/apiScopes'
import { requireMember } from './lib/permissions'

/**
 * Organization API keys (INT-004, doc 09 §8). Admin-only.
 *
 * The full key `pbk_<prefix>_<secret>` is generated in an action (random
 * bytes), shown once, and only its SHA-256 is stored. Nothing here returns
 * the hash.
 */

const MAX_KEYS_PER_COMPANY = 25
const MAX_NAME = 80

type Ctx = QueryCtx | MutationCtx

async function requireApiAdmin(ctx: Ctx) {
  const { user } = await requireMember(ctx, { permission: 'integrations.manage' })
  if (!user.companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
  return { user, companyId: user.companyId }
}

function keyToClient(row: Doc<'apiKeys'>, creatorName: string | null, now: number | null) {
  // Explicit allow-list: never the hash.
  const expired = !!row.expiresAt && now !== null && row.expiresAt <= now
  return {
    id: row._id,
    name: row.name,
    prefix: `pbk_${row.prefix}_…`,
    scopes: row.scopes,
    locationIds: row.locationIds ?? [],
    createdAt: row.createdAt,
    createdBy: creatorName,
    expiresAt: row.expiresAt ?? null,
    revokedAt: row.revokedAt ?? null,
    lastUsedAt: row.lastUsedAt ?? null,
    status: row.revokedAt ? 'revoked' : expired ? 'expired' : 'active',
  }
}

/** API keys page: keys, the scope catalog and the company's sites. */
export const overview = query({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, { now }) => {
    const { companyId } = await requireApiAdmin(ctx)
    const rows = await ctx.db
      .query('apiKeys')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(100)
    const keys = []
    for (const row of rows) {
      const creator = await ctx.db.get(row.createdBy)
      keys.push(keyToClient(row, creator?.name ?? creator?.email ?? null, now ?? null))
    }
    const sites = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(200)
    return {
      keys,
      scopes: Object.entries(API_SCOPES).map(([id, label]) => ({ id, label })),
      sites: sites.filter((s) => s.active !== false).map((s) => ({ id: s._id, name: s.name })),
    }
  },
})

/** Internal: validate and store a new key (the plaintext never gets here). */
export const insertKey = internalMutation({
  args: {
    name: v.string(),
    scopes: v.array(v.string()),
    locationIds: v.optional(v.array(v.id('farmLocations'))),
    expiresInDays: v.optional(v.number()),
    prefix: v.string(),
    hash: v.string(),
  },
  returns: v.id('apiKeys'),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireApiAdmin(ctx)
    const name = args.name.trim()
    if (!name) throw new Error('Give the key a name')
    if (name.length > MAX_NAME) throw new Error('Name is too long')
    const scopes = [...new Set(args.scopes)]
    if (!scopes.length) throw new Error('Choose at least one permission')
    for (const s of scopes) if (!isApiScope(s)) throw new Error(`Unknown permission "${s}"`)
    const locationIds = [...new Set(args.locationIds ?? [])]
    for (const id of locationIds) {
      const loc = await ctx.db.get(id)
      if (!loc || loc.companyId !== companyId) throw new Error('Site not found')
    }
    if (args.expiresInDays !== undefined && !(args.expiresInDays >= 1 && args.expiresInDays <= 3650)) {
      throw new Error('Expiry must be between 1 and 3650 days')
    }
    const existing = await ctx.db
      .query('apiKeys')
      .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
      .take(200)
    if (existing.filter((k) => !k.revokedAt).length >= MAX_KEYS_PER_COMPANY) {
      throw new Error(`A company can have at most ${MAX_KEYS_PER_COMPANY} active keys. Revoke one first.`)
    }
    const clash = await ctx.db
      .query('apiKeys')
      .withIndex('by_prefix', (q) => q.eq('prefix', args.prefix))
      .first()
    if (clash) throw new Error('Key generation clashed; try again')
    const now = Date.now()
    const id = await ctx.db.insert('apiKeys', {
      companyId,
      name,
      prefix: args.prefix,
      hash: args.hash,
      scopes,
      locationIds: locationIds.length ? locationIds : undefined,
      createdBy: user._id,
      createdAt: now,
      expiresAt: args.expiresInDays ? now + args.expiresInDays * 24 * 60 * 60 * 1000 : undefined,
    })
    await logAudit(ctx, {
      actionType: 'api_key_create',
      tableName: 'apiKeys',
      recordId: id,
      newValues: { name, prefix: args.prefix, scopes, locationIds },
    })
    return id
  },
})

/** Create a key. The full key is in the result only: it is never shown again. */
export const create = action({
  args: {
    name: v.string(),
    scopes: v.array(v.string()),
    locationIds: v.optional(v.array(v.id('farmLocations'))),
    expiresInDays: v.optional(v.number()),
  },
  returns: v.object({ id: v.id('apiKeys'), key: v.string(), prefix: v.string() }),
  handler: async (ctx, args): Promise<{ id: Id<'apiKeys'>; key: string; prefix: string }> => {
    const prefix = randomBase62(API_KEY_PREFIX_LENGTH)
    const key = `pbk_${prefix}_${randomBase62(API_KEY_SECRET_LENGTH)}`
    const hash = await sha256Hex(key)
    const id: Id<'apiKeys'> = await ctx.runMutation(internal.apiKeys.insertKey, {
      ...args,
      prefix,
      hash,
    })
    return { id, key, prefix: `pbk_${prefix}_…` }
  },
})

/** Revoke a key immediately. Revoked keys stay listed for the audit trail. */
export const revoke = mutation({
  args: { keyId: v.id('apiKeys') },
  returns: v.null(),
  handler: async (ctx, { keyId }) => {
    const { user, companyId } = await requireApiAdmin(ctx)
    const row = await ctx.db.get(keyId)
    if (!row || row.companyId !== companyId) throw new Error('API key not found')
    if (row.revokedAt) return null
    await ctx.db.patch(keyId, { revokedAt: Date.now(), revokedBy: user._id })
    await logAudit(ctx, {
      actionType: 'api_key_revoke',
      tableName: 'apiKeys',
      recordId: keyId,
      previousValues: { name: row.name, prefix: row.prefix },
    })
    return null
  },
})
