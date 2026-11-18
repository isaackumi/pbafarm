import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { rateLimiter } from './lib/rateLimits'
import { apiActorUser, withApiActor } from './lib/apiActor'
import { saveDailyBatch } from './dailyRecords'
import { saveSamplingBatch } from './biweeklyRecords'
import { customValues } from './schema'
import { timingSafeEqual } from './integrations/apiScopes'

/**
 * Internal functions behind the /api/v1 httpActions (convex/integrations/apiHttp.ts).
 * Every function is internal; the httpAction authenticates the key first.
 */

/** Refresh lastUsedAt at most this often (one write per key per window). */
const LAST_USED_WRITE_MS = 5 * 60 * 1000

export type AuthResult =
  | {
      ok: true
      apiKeyId: Id<'apiKeys'>
      companyId: Id<'companies'>
      locationIds: Id<'farmLocations'>[]
    }
  | { ok: false; status: number; code: string; message: string; retryAfterMs?: number }

async function loadUsableKey(
  ctx: QueryCtx | MutationCtx,
  prefix: string,
  hash: string,
  now: number,
): Promise<{ key: Doc<'apiKeys'>; creator: Doc<'users'> } | Exclude<AuthResult, { ok: true }>> {
  const unauthorized = {
    ok: false as const,
    status: 401,
    code: 'unauthorized',
    message: 'Invalid or revoked API key',
  }
  const key = await ctx.db
    .query('apiKeys')
    .withIndex('by_prefix', (q) => q.eq('prefix', prefix))
    .first()
  if (!key || !timingSafeEqual(key.hash, hash)) return unauthorized
  if (key.revokedAt || (key.expiresAt && key.expiresAt <= now)) return unauthorized
  const company = await ctx.db.get(key.companyId)
  if (!company || company.status !== 'approved') {
    return { ok: false, status: 403, code: 'forbidden', message: 'Organization is not active' }
  }
  const creator = await ctx.db.get(key.createdBy)
  if (!creator || creator.active === false || creator.companyId !== key.companyId) {
    // The admin who created the key left: the key stops working with them.
    return { ok: false, status: 401, code: 'unauthorized', message: 'API key owner is no longer active' }
  }
  return { key, creator }
}

/**
 * Authenticate a key for one scope and charge the rate limits. A mutation:
 * the rate limiter and lastUsedAt write. Returns a result, never throws for
 * an auth failure (so the tokens it consumed are kept).
 */
export const authorize = internalMutation({
  args: { prefix: v.string(), hash: v.string(), scope: v.string() },
  handler: async (ctx, { prefix, hash, scope }): Promise<AuthResult> => {
    const now = Date.now()
    const loaded = await loadUsableKey(ctx, prefix, hash, now)
    if ('ok' in loaded) return loaded
    const { key } = loaded
    if (!key.scopes.includes(scope)) {
      return {
        ok: false,
        status: 403,
        code: 'insufficient_scope',
        message: `This key does not have the ${scope} permission`,
      }
    }
    const perKey = await rateLimiter.limit(ctx, 'apiPerKey', { key: key._id })
    if (!perKey.ok) {
      return { ok: false, status: 429, code: 'rate_limited', message: 'Too many requests for this key', retryAfterMs: perKey.retryAfter }
    }
    const perCompany = await rateLimiter.limit(ctx, 'apiPerCompany', { key: key.companyId })
    if (!perCompany.ok) {
      return { ok: false, status: 429, code: 'rate_limited', message: 'Too many requests for this organization', retryAfterMs: perCompany.retryAfter }
    }
    if (!key.lastUsedAt || now - key.lastUsedAt > LAST_USED_WRITE_MS) {
      await ctx.db.patch(key._id, { lastUsedAt: now })
    }
    return { ok: true, apiKeyId: key._id, companyId: key.companyId, locationIds: key.locationIds ?? [] }
  },
})

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const API_RESOURCES = ['cages', 'daily-records', 'sampling', 'harvests', 'feed-stock', 'sales'] as const
export type ApiResource = (typeof API_RESOURCES)[number]

const MIN_DATE = '0000-01-01'
const MAX_DATE = '9999-12-31'

const resourceValidator = v.union(...API_RESOURCES.map((r) => v.literal(r)))

type PageOut = { data: Record<string, unknown>[]; nextCursor: string | null; hasMore: boolean }

function inSites(locationIds: Id<'farmLocations'>[], row: { locationId?: Id<'farmLocations'> }) {
  return locationIds.length === 0 || (!!row.locationId && locationIds.includes(row.locationId))
}

function iso(ms: number | undefined) {
  return ms === undefined ? null : new Date(ms).toISOString()
}

export function cageOut(r: Doc<'cages'>) {
  return {
    id: r._id,
    name: r.name,
    code: r.code ?? null,
    status: r.status,
    siteId: r.locationId ?? null,
    species: r.species ?? null,
    stockingDate: r.stockingDate ?? null,
    initialCount: r.initialCount ?? null,
    currentCount: r.currentCount ?? null,
    currentAbwG: r.currentWeight ?? null,
    capacity: r.capacity ?? null,
    batchId: r.currentBatchId ?? null,
    custom: r.custom ?? {},
    updatedAt: iso(r.updatedAt),
  }
}

export function dailyOut(r: Doc<'dailyRecords'>) {
  return {
    id: r._id,
    cageId: r.cageId,
    date: r.date,
    feedKg: r.feedAmount,
    feedTypeId: r.feedTypeId ?? null,
    feedType: r.feedType ?? null,
    feedCost: r.feedCost,
    mortality: r.mortality,
    mortalityCause: r.mortalityCause ?? null,
    dissolvedOxygen: r.dissolvedOxygen ?? null,
    temperatureC: r.temperatureC ?? null,
    secchiCm: r.secchiCm ?? null,
    notes: r.notes ?? null,
    siteId: r.locationId ?? null,
    batchId: r.batchId ?? null,
    custom: r.custom ?? {},
    createdAt: iso(r._creationTime),
  }
}

export function samplingOut(r: Doc<'biweeklyRecords'>) {
  return {
    id: r._id,
    cageId: r.cageId,
    date: r.date,
    batchCode: r.batchCode,
    averageBodyWeightG: r.averageBodyWeight,
    fishCount: r.totalFishCount,
    totalWeightG: r.totalWeight,
    dissolvedOxygen: r.dissolvedOxygen ?? null,
    temperatureC: r.temperatureC ?? null,
    secchiCm: r.secchiCm ?? null,
    siteId: r.locationId ?? null,
    batchId: r.batchId ?? null,
    custom: r.custom ?? {},
    createdAt: iso(r._creationTime),
  }
}

function harvestOut(r: Doc<'harvestRecords'>) {
  return {
    id: r._id,
    cageId: r.cageId,
    harvestDate: r.harvestDate,
    harvestType: r.harvestType ?? 'complete',
    status: r.status ?? 'completed',
    totalWeightKg: r.totalWeight,
    estimatedCount: r.estimatedCount,
    averageBodyWeightG: r.averageBodyWeight,
    fcr: r.fcr,
    siteId: r.locationId ?? null,
    batchId: r.batchId ?? null,
    custom: r.custom ?? {},
    createdAt: iso(r._creationTime),
  }
}

function feedStockOut(r: Doc<'feedTypes'>) {
  return {
    id: r._id,
    name: r.name,
    currentStockKg: r.currentStock,
    minimumStockKg: r.minimumStock,
    low: r.minimumStock > 0 && r.currentStock <= r.minimumStock,
    bagSizeKg: r.bagSizeKg ?? null,
    pricePerKg: r.pricePerKg,
    active: r.active,
    updatedAt: iso(r.updatedAt),
  }
}

function saleOut(r: Doc<'sales'>) {
  return {
    id: r._id,
    saleDate: r.saleDate,
    harvestId: r.harvestId ?? null,
    cageId: r.cageId ?? null,
    customerId: r.customerId ?? null,
    customerName: r.customerName ?? null,
    weightKg: r.weightKg,
    pricePerKg: r.pricePerKg,
    totalAmount: r.totalAmount,
    paymentStatus: r.paymentStatus ?? null,
    siteId: r.locationId ?? null,
    createdAt: iso(r._creationTime),
  }
}

/** One page of a resource for a company, newest first, optional date range. */
export const listResource = internalQuery({
  args: {
    resource: resourceValidator,
    companyId: v.id('companies'),
    locationIds: v.array(v.id('farmLocations')),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<PageOut> => {
    const opts = { numItems: Math.max(1, Math.min(200, Math.floor(a.limit))), cursor: a.cursor }
    const from = a.from ?? MIN_DATE
    const to = a.to ?? MAX_DATE
    const scope = (row: { locationId?: Id<'farmLocations'> }) => inSites(a.locationIds, row)
    const out = <T extends object>(
      res: { page: T[]; continueCursor: string; isDone: boolean },
      map: (r: T) => Record<string, unknown>,
      filter: (r: T) => boolean = (r) => scope(r as { locationId?: Id<'farmLocations'> }),
    ): PageOut => ({
      data: res.page.filter(filter).map(map),
      nextCursor: res.isDone ? null : res.continueCursor,
      hasMore: !res.isDone,
    })
    switch (a.resource) {
      case 'cages':
        return out(
          await ctx.db
            .query('cages')
            .withIndex('by_company', (q) => q.eq('companyId', a.companyId))
            .paginate(opts),
          cageOut,
        )
      case 'daily-records':
        return out(
          await ctx.db
            .query('dailyRecords')
            .withIndex('by_company_and_date', (q) =>
              q.eq('companyId', a.companyId).gte('date', from).lte('date', to),
            )
            .order('desc')
            .paginate(opts),
          dailyOut,
        )
      case 'sampling':
        return out(
          await ctx.db
            .query('biweeklyRecords')
            .withIndex('by_company_and_date', (q) =>
              q.eq('companyId', a.companyId).gte('date', from).lte('date', to),
            )
            .order('desc')
            .paginate(opts),
          samplingOut,
        )
      case 'harvests':
        return out(
          await ctx.db
            .query('harvestRecords')
            .withIndex('by_company_and_harvestDate', (q) =>
              q.eq('companyId', a.companyId).gte('harvestDate', from).lte('harvestDate', to),
            )
            .order('desc')
            .paginate(opts),
          harvestOut,
          // Rows from the old sampling page are not harvests (migration M0-c).
          (r) => scope(r) && r.source !== 'sampling_page',
        )
      case 'feed-stock':
        return out(
          await ctx.db
            .query('feedTypes')
            .withIndex('by_company', (q) => q.eq('companyId', a.companyId))
            .paginate(opts),
          feedStockOut,
          // Feed stock is company-wide (no site on feed types).
          (r) => !r.deletedAt,
        )
      case 'sales':
        return out(
          await ctx.db
            .query('sales')
            .withIndex('by_company_and_saleDate', (q) =>
              q.eq('companyId', a.companyId).gte('saleDate', from).lte('saleDate', to),
            )
            .order('desc')
            .paginate(opts),
          saleOut,
        )
    }
  },
})

/** One record by id, or null when missing / another company's / outside the key's sites. */
export const getResource = internalQuery({
  args: {
    resource: resourceValidator,
    companyId: v.id('companies'),
    locationIds: v.array(v.id('farmLocations')),
    id: v.string(),
  },
  handler: async (ctx, a): Promise<Record<string, unknown> | null> => {
    const own = <T extends { companyId?: Id<'companies'>; locationId?: Id<'farmLocations'> }>(r: T | null) =>
      r && r.companyId === a.companyId && inSites(a.locationIds, r) ? r : null
    switch (a.resource) {
      case 'cages': {
        const id = ctx.db.normalizeId('cages', a.id)
        const r = own(id ? await ctx.db.get(id) : null)
        return r ? cageOut(r) : null
      }
      case 'daily-records': {
        const id = ctx.db.normalizeId('dailyRecords', a.id)
        const r = own(id ? await ctx.db.get(id) : null)
        return r ? dailyOut(r) : null
      }
      case 'sampling': {
        const id = ctx.db.normalizeId('biweeklyRecords', a.id)
        const r = own(id ? await ctx.db.get(id) : null)
        return r ? samplingOut(r) : null
      }
      case 'harvests': {
        const id = ctx.db.normalizeId('harvestRecords', a.id)
        const r = own(id ? await ctx.db.get(id) : null)
        return r && r.source !== 'sampling_page' ? harvestOut(r) : null
      }
      case 'feed-stock': {
        const id = ctx.db.normalizeId('feedTypes', a.id)
        const r = id ? await ctx.db.get(id) : null
        return r && r.companyId === a.companyId && !r.deletedAt ? feedStockOut(r) : null
      }
      case 'sales': {
        const id = ctx.db.normalizeId('sales', a.id)
        const r = own(id ? await ctx.db.get(id) : null)
        return r ? saleOut(r) : null
      }
    }
  },
})

// ---------------------------------------------------------------------------
// Writes (Idempotency-Key required)
// ---------------------------------------------------------------------------

export type WriteResult = { status: number; body: string; replayed: boolean }

/**
 * A stored response for this key + Idempotency-Key, or a refusal when the key
 * was used with a different body. Null = first time.
 */
async function idempotentReplay(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  key: string,
  route: string,
  requestHash: string,
): Promise<WriteResult | null> {
  const prior = await ctx.db
    .query('apiIdempotencyKeys')
    .withIndex('by_apiKeyId_and_key', (q) => q.eq('apiKeyId', apiKeyId).eq('key', key))
    .first()
  if (!prior) return null
  if (prior.route !== route || prior.requestHash !== requestHash) {
    return {
      status: 422,
      replayed: false,
      body: JSON.stringify({
        error: {
          code: 'idempotency_key_reused',
          message: 'This Idempotency-Key was already used with a different request',
        },
      }),
    }
  }
  return { status: prior.responseStatus, body: prior.responseBody, replayed: true }
}

async function actorFor(ctx: MutationCtx, apiKeyId: Id<'apiKeys'>) {
  const key = await ctx.db.get(apiKeyId)
  if (!key || key.revokedAt) throw new Error('Invalid or revoked API key')
  const creator = await ctx.db.get(key.createdBy)
  if (!creator) throw new Error('API key owner is no longer active')
  const user = apiActorUser(creator, key)
  return { key, user, ctx: withApiActor(ctx, { user, apiKeyId, companyId: key.companyId }) }
}

function idOrThrow<T extends 'cages' | 'feedTypes'>(
  ctx: MutationCtx,
  table: T,
  raw: string | undefined,
  label: string,
): Id<T> | undefined {
  if (raw === undefined) return undefined
  const id = ctx.db.normalizeId(table, raw)
  if (!id) throw new Error(`${label}: ${table === 'cages' ? 'cage' : 'feed type'} not found`)
  return id
}

/** A site-restricted key may only write to cages at its sites. */
async function assertCagesInScope(ctx: MutationCtx, key: Doc<'apiKeys'>, cageIds: Id<'cages'>[]) {
  const sites = key.locationIds ?? []
  if (!sites.length) return
  for (const [i, cageId] of cageIds.entries()) {
    const cage = await ctx.db.get(cageId)
    if (!cage || !inSites(sites, cage)) throw new Error(`Line ${i + 1}: cage not found`)
  }
}

async function remember(
  ctx: MutationCtx,
  a: { apiKeyId: Id<'apiKeys'>; companyId: Id<'companies'>; idempotencyKey: string; route: string; requestHash: string },
  status: number,
  body: unknown,
): Promise<WriteResult> {
  const json = JSON.stringify(body)
  await ctx.db.insert('apiIdempotencyKeys', {
    companyId: a.companyId,
    apiKeyId: a.apiKeyId,
    key: a.idempotencyKey,
    route: a.route,
    requestHash: a.requestHash,
    responseStatus: status,
    responseBody: json,
    createdAt: Date.now(),
  })
  return { status, body: json, replayed: false }
}

const writeArgs = {
  apiKeyId: v.id('apiKeys'),
  idempotencyKey: v.string(),
  requestHash: v.string(),
  date: v.string(),
}

/**
 * POST /api/v1/daily-records: same rules as the daily entry screen
 * (dailyRecords.createBatch). A failure throws and writes nothing, so the
 * client can retry with the same Idempotency-Key.
 */
export const createDailyRecords = internalMutation({
  args: {
    ...writeArgs,
    records: v.array(
      v.object({
        cageId: v.string(),
        feedKg: v.number(),
        feedTypeId: v.optional(v.string()),
        mortality: v.number(),
        mortalityCause: v.optional(v.string()),
        notes: v.optional(v.string()),
        dissolvedOxygen: v.optional(v.number()),
        temperatureC: v.optional(v.number()),
        custom: v.optional(customValues),
      }),
    ),
  },
  handler: async (ctx, a): Promise<WriteResult> => {
    const route = 'POST /api/v1/daily-records'
    const replay = await idempotentReplay(ctx, a.apiKeyId, a.idempotencyKey, route, a.requestHash)
    if (replay) return replay
    const actor = await actorFor(ctx, a.apiKeyId)
    const records = a.records.map((r, i) => ({
      cageId: idOrThrow(ctx, 'cages', r.cageId, `Line ${i + 1}`)!,
      feedAmount: r.feedKg,
      feedTypeId: idOrThrow(ctx, 'feedTypes', r.feedTypeId, `Line ${i + 1}`),
      mortality: r.mortality,
      mortalityCause: r.mortalityCause,
      notes: r.notes,
      dissolvedOxygen: r.dissolvedOxygen,
      temperatureC: r.temperatureC,
      custom: r.custom,
    }))
    await assertCagesInScope(ctx, actor.key, records.map((r) => r.cageId))
    const ids = await saveDailyBatch(actor.ctx, actor.user, { date: a.date, records })
    const rows = []
    for (const id of ids) {
      const row = await ctx.db.get(id)
      if (row) rows.push(dailyOut(row))
    }
    return await remember(ctx, { ...a, companyId: actor.key.companyId, route }, 201, { data: rows })
  },
})

/** POST /api/v1/sampling: same rules as field sampling (biweeklyRecords.createBatch). */
export const createSampling = internalMutation({
  args: {
    ...writeArgs,
    records: v.array(
      v.object({
        cageId: v.string(),
        fishCount: v.number(),
        totalWeightG: v.number(),
        batchCode: v.optional(v.string()),
        dissolvedOxygen: v.optional(v.number()),
        temperatureC: v.optional(v.number()),
        secchiCm: v.optional(v.number()),
        custom: v.optional(customValues),
      }),
    ),
  },
  handler: async (ctx, a): Promise<WriteResult> => {
    const route = 'POST /api/v1/sampling'
    const replay = await idempotentReplay(ctx, a.apiKeyId, a.idempotencyKey, route, a.requestHash)
    if (replay) return replay
    const actor = await actorFor(ctx, a.apiKeyId)
    const records = a.records.map((r, i) => ({
      cageId: idOrThrow(ctx, 'cages', r.cageId, `Line ${i + 1}`)!,
      totalFishCount: r.fishCount,
      totalWeight: r.totalWeightG,
      batchCode: r.batchCode,
      dissolvedOxygen: r.dissolvedOxygen,
      temperatureC: r.temperatureC,
      secchiCm: r.secchiCm,
      custom: r.custom,
    }))
    await assertCagesInScope(ctx, actor.key, records.map((r) => r.cageId))
    const ids = await saveSamplingBatch(actor.ctx, actor.user, { date: a.date, records })
    const rows = []
    for (const id of ids) {
      const row = await ctx.db.get(id)
      if (row) rows.push(samplingOut(row))
    }
    return await remember(ctx, { ...a, companyId: actor.key.companyId, route }, 201, { data: rows })
  },
})

/** Daily cleanup: idempotency keys older than 30 days (doc 10 retention). */
export const pruneIdempotencyKeys = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const old = await ctx.db
      .query('apiIdempotencyKeys')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(500)
    for (const row of old) await ctx.db.delete(row._id)
    return old.length
  },
})
