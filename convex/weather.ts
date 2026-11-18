import { v } from 'convex/values'
import * as Effect from 'effect/Effect'
import { action, internalAction, internalMutation, internalQuery, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { requireRole, requireUser } from './lib/authz'
import { assertLocationAccess } from './lib/tenancy'
import { zoneFor } from './lib/dates'
import { runEffect } from './lib/effect'
import { FetchLive } from './lib/effectHttp'
import {
  fetchDailyWeather,
  validCoordinates,
  weatherLabel,
  type WeatherDay,
} from './integrations/weatherLogic'

/**
 * Per-site weather (INT-006, doc 09 §9). A daily cron fetches Open-Meteo for
 * every active site that has latitude and longitude (FARM-001 fields); sites
 * without coordinates are skipped. The dashboard reads the stored rows.
 */

const MAX_SITES_PER_RUN = 200
/** "Refresh now" is refused within this window of the last fetch. */
const REFRESH_COOLDOWN_MS = 30 * 60 * 1000

type SiteJob = {
  locationId: Id<'farmLocations'>
  companyId: Id<'companies'>
  latitude: number
  longitude: number
  timezone: string
}

/** Active sites with coordinates, after `cursor` (by _creationTime). */
export const sitesToFetch = internalQuery({
  args: { cursor: v.optional(v.number()) },
  handler: async (ctx, { cursor }): Promise<{ sites: SiteJob[]; nextCursor: number | null }> => {
    const rows = await ctx.db
      .query('farmLocations')
      .withIndex('by_creation_time', (q) => q.gt('_creationTime', cursor ?? 0))
      .take(MAX_SITES_PER_RUN)
    const sites: SiteJob[] = []
    for (const loc of rows) {
      if (loc.active === false || !loc.companyId) continue
      if (!validCoordinates(loc.latitude, loc.longitude)) continue
      const company = await ctx.db.get(loc.companyId)
      if (!company || company.status !== 'approved') continue
      sites.push({
        locationId: loc._id,
        companyId: loc.companyId,
        latitude: loc.latitude!,
        longitude: loc.longitude!,
        timezone: zoneFor(loc, company),
      })
    }
    return {
      sites,
      nextCursor: rows.length === MAX_SITES_PER_RUN ? rows[rows.length - 1]._creationTime : null,
    }
  },
})

const dayValidator = v.object({
  date: v.string(),
  tempMaxC: v.optional(v.number()),
  tempMinC: v.optional(v.number()),
  precipitationMm: v.optional(v.number()),
  windMaxKmh: v.optional(v.number()),
  weatherCode: v.optional(v.number()),
})

/** Upsert one site's days. Index 0 is yesterday, 1 today, later ones forecast. */
export const storeDays = internalMutation({
  args: {
    locationId: v.id('farmLocations'),
    companyId: v.id('companies'),
    days: v.array(dayValidator),
  },
  handler: async (ctx, { locationId, companyId, days }) => {
    const now = Date.now()
    for (const [i, day] of days.entries()) {
      const row = { ...day, companyId, locationId, isForecast: i >= 2, source: 'open_meteo' as const, fetchedAt: now }
      const existing = await ctx.db
        .query('weatherObservations')
        .withIndex('by_locationId_and_date', (q) => q.eq('locationId', locationId).eq('date', day.date))
        .unique()
      if (existing) await ctx.db.replace(existing._id, row)
      else await ctx.db.insert('weatherObservations', row)
    }
    return null
  },
})

async function fetchSite(site: SiteJob): Promise<WeatherDay[] | null> {
  return await runEffect(
    fetchDailyWeather(site.latitude, site.longitude, site.timezone).pipe(
      Effect.map((days): WeatherDay[] | null => days),
      Effect.catchTag('WeatherUnavailable', (e) =>
        Effect.sync(() => {
          console.warn(`weather fetch failed for site ${site.locationId}: ${e.message}`)
          return null
        }),
      ),
      Effect.provide(FetchLive),
    ),
  )
}

/** Cron entry point: every site with coordinates, in pages of 200. */
export const refreshAll = internalAction({
  args: { cursor: v.optional(v.number()) },
  handler: async (ctx, { cursor }) => {
    const { sites, nextCursor }: { sites: SiteJob[]; nextCursor: number | null } = await ctx.runQuery(
      internal.weather.sitesToFetch,
      { cursor },
    )
    let ok = 0
    // Small batches: friendly to the free Open-Meteo service.
    for (let i = 0; i < sites.length; i += 5) {
      const batch = sites.slice(i, i + 5)
      const results = await Promise.all(batch.map(fetchSite))
      for (const [j, days] of results.entries()) {
        if (!days) continue
        await ctx.runMutation(internal.weather.storeDays, {
          locationId: batch[j].locationId,
          companyId: batch[j].companyId,
          days,
        })
        ok += 1
      }
    }
    if (nextCursor !== null) await ctx.scheduler.runAfter(0, internal.weather.refreshAll, { cursor: nextCursor })
    return { sites: sites.length, ok }
  },
})

/** Internal: the caller's site, if it has coordinates and was not just fetched. */
export const siteForRefresh = internalQuery({
  args: { locationId: v.id('farmLocations'), now: v.number() },
  handler: async (ctx, { locationId, now }): Promise<SiteJob> => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    const loc = await ctx.db.get(locationId)
    if (!loc || !user.companyId || loc.companyId !== user.companyId) throw new Error('Site not found')
    if (!validCoordinates(loc.latitude, loc.longitude)) {
      throw new Error('Add the site latitude and longitude under Farm locations first')
    }
    const last = await ctx.db
      .query('weatherObservations')
      .withIndex('by_locationId_and_date', (q) => q.eq('locationId', locationId))
      .order('desc')
      .first()
    if (last && now - last.fetchedAt < REFRESH_COOLDOWN_MS) {
      throw new Error('Weather was updated less than 30 minutes ago')
    }
    const company = await ctx.db.get(user.companyId)
    return {
      locationId,
      companyId: user.companyId,
      latitude: loc.latitude!,
      longitude: loc.longitude!,
      timezone: zoneFor(loc, company),
    }
  },
})

/** Admin "Refresh now" for one site. */
export const refreshSite = action({
  args: { locationId: v.id('farmLocations') },
  handler: async (ctx, { locationId }): Promise<{ ok: boolean }> => {
    const site: SiteJob = await ctx.runQuery(internal.weather.siteForRefresh, { locationId, now: Date.now() })
    const days = await fetchSite(site)
    if (!days) throw new Error('The weather service did not answer. Try again later.')
    await ctx.runMutation(internal.weather.storeDays, { locationId, companyId: site.companyId, days })
    return { ok: true }
  },
})

/**
 * Weather for the dashboard: per site of the caller's company (or one site),
 * the days from `fromDate` on. `fromDate` comes from the client (no wall clock
 * in queries).
 */
export const forSites = query({
  args: { locationId: v.optional(v.id('farmLocations')), fromDate: v.string() },
  handler: async (ctx, { locationId, fromDate }) => {
    const user = await requireUser(ctx)
    if (!user.companyId) return { sites: [] }
    const companyId = user.companyId
    let sites = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(100)
    sites = sites.filter((s) => s.active !== false)
    if (locationId) sites = sites.filter((s) => s._id === locationId)
    const assigned = user.locationIds?.length && (user.role ?? 'user') === 'user' ? user.locationIds : null
    if (assigned) sites = sites.filter((s) => assigned.includes(s._id))
    const out = []
    for (const site of sites.slice(0, 20)) {
      try {
        assertLocationAccess(user, site._id)
      } catch {
        continue
      }
      const hasCoordinates = validCoordinates(site.latitude, site.longitude)
      const days = hasCoordinates
        ? await ctx.db
            .query('weatherObservations')
            .withIndex('by_locationId_and_date', (q) => q.eq('locationId', site._id).gte('date', fromDate))
            .take(4)
        : []
      out.push({
        id: site._id,
        name: site.name,
        hasCoordinates,
        days: days.map((d) => ({
          date: d.date,
          tempMaxC: d.tempMaxC ?? null,
          tempMinC: d.tempMinC ?? null,
          precipitationMm: d.precipitationMm ?? null,
          windMaxKmh: d.windMaxKmh ?? null,
          label: weatherLabel(d.weatherCode),
          isForecast: d.isForecast,
          fetchedAt: d.fetchedAt,
        })),
      })
    }
    return { sites: out }
  },
})
