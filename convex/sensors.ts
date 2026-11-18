import { v } from 'convex/values'
import { internalMutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { emitDomainEvent } from './lib/events'
import { SENSOR_PARAMETERS, type SensorParameter } from './integrations/sensorLogic'
import { requireMember } from './lib/permissions'

/**
 * Sensor readings (INT-007). Convex-native ingestion (doc 14: a Cloudflare
 * Worker only when volume triggers it): POST /ingest/v1/readings with an
 * `ingest:write` key → `ingest` below. Readings are deduplicated by
 * (company, device, parameter, measuredAt), so a gateway can resend a batch.
 */

const readingValidator = v.object({
  index: v.number(),
  deviceId: v.string(),
  parameter: v.string(),
  value: v.number(),
  measuredAt: v.number(),
  cageId: v.optional(v.string()),
  siteId: v.optional(v.string()),
})

export type IngestResult = {
  accepted: number
  duplicates: number
  rejected: { index: number; reason: string }[]
}

/** Store already-checked readings for the key's company and sites. */
export const ingest = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), readings: v.array(readingValidator) },
  handler: async (ctx, { apiKeyId, readings }): Promise<IngestResult> => {
    const key = await ctx.db.get(apiKeyId)
    if (!key || key.revokedAt) throw new Error('Invalid or revoked API key')
    const companyId = key.companyId
    const sites = key.locationIds ?? []
    const now = Date.now()
    const rejected: IngestResult['rejected'] = []
    let accepted = 0
    let duplicates = 0
    let minDo: number | null = null
    let maxTemp: number | null = null
    const cageNames = new Set<string>()
    const cageCache = new Map<string, { _id: Id<'cages'>; name: string; locationId?: Id<'farmLocations'> } | null>()

    for (const r of readings) {
      let cage: { _id: Id<'cages'>; name: string; locationId?: Id<'farmLocations'> } | null = null
      if (r.cageId) {
        if (!cageCache.has(r.cageId)) {
          const id = ctx.db.normalizeId('cages', r.cageId)
          const doc = id ? await ctx.db.get(id) : null
          cageCache.set(r.cageId, doc && doc.companyId === companyId ? doc : null)
        }
        cage = cageCache.get(r.cageId) ?? null
        if (!cage) {
          rejected.push({ index: r.index, reason: 'cage not found' })
          continue
        }
      }
      let locationId = cage?.locationId
      if (!locationId && r.siteId) {
        const id = ctx.db.normalizeId('farmLocations', r.siteId)
        const site = id ? await ctx.db.get(id) : null
        if (!site || site.companyId !== companyId) {
          rejected.push({ index: r.index, reason: 'site not found' })
          continue
        }
        locationId = site._id
      }
      if (sites.length && (!locationId || !sites.includes(locationId))) {
        rejected.push({ index: r.index, reason: 'outside this key\'s sites' })
        continue
      }
      const same = await ctx.db
        .query('sensorReadings')
        .withIndex('by_companyId_and_deviceId_and_measuredAt', (q) =>
          q.eq('companyId', companyId).eq('deviceId', r.deviceId).eq('measuredAt', r.measuredAt),
        )
        .take(20)
      if (same.some((x) => x.parameter === r.parameter)) {
        duplicates += 1
        continue
      }
      await ctx.db.insert('sensorReadings', {
        companyId,
        locationId,
        cageId: cage?._id,
        deviceId: r.deviceId,
        parameter: r.parameter,
        value: r.value,
        measuredAt: r.measuredAt,
        receivedAt: now,
        apiKeyId,
      })
      accepted += 1
      if (cage) cageNames.add(cage.name)
      if (r.parameter === 'dissolved_oxygen') minDo = minDo === null ? r.value : Math.min(minDo, r.value)
      if (r.parameter === 'temperature_c') maxTemp = maxTemp === null ? r.value : Math.max(maxTemp, r.value)
    }

    if (accepted > 0) {
      // One event per batch; automation can alert on low oxygen.
      await emitDomainEvent(
        ctx,
        'sensor.readings.recorded',
        {
          readings: accepted,
          cageNames: [...cageNames].slice(0, 10).join(', '),
          minDissolvedOxygen: minDo ?? undefined,
          maxTemperatureC: maxTemp ?? undefined,
        },
        { companyId },
      )
    }
    return { accepted, duplicates, rejected }
  },
})

/**
 * Latest reading per cage (or device) and parameter, for the dashboard.
 * Looks at the newest 300 readings of the company.
 */
export const latest = query({
  args: { locationId: v.optional(v.id('farmLocations')) },
  handler: async (ctx, { locationId }) => {
    const { user } = await requireMember(ctx, { permission: 'production.view' })
    if (!user.companyId) return { readings: [] }
    const companyId = user.companyId
    const rows = await ctx.db
      .query('sensorReadings')
      .withIndex('by_companyId_and_measuredAt', (q) => q.eq('companyId', companyId))
      .order('desc')
      .take(300)
    const assigned = (user.role ?? 'user') === 'user' && user.locationIds?.length ? user.locationIds : null
    const seen = new Set<string>()
    const out = []
    for (const r of rows) {
      if (locationId && r.locationId !== locationId) continue
      if (assigned && (!r.locationId || !assigned.includes(r.locationId))) continue
      const key = `${r.cageId ?? r.deviceId}:${r.parameter}`
      if (seen.has(key)) continue
      seen.add(key)
      const cage = r.cageId ? await ctx.db.get(r.cageId) : null
      const spec = SENSOR_PARAMETERS[r.parameter as SensorParameter]
      out.push({
        id: r._id,
        source: cage?.name ?? r.deviceId,
        parameter: r.parameter,
        label: spec?.label ?? r.parameter,
        unit: spec?.unit ?? '',
        value: r.value,
        measuredAt: r.measuredAt,
      })
      if (out.length >= 24) break
    }
    return { readings: out }
  },
})
