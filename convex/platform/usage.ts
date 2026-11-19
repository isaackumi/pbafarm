/**
 * Per-organization daily usage for the platform console (PLAT-110):
 * records, active people, SMS / WhatsApp / email sent, AI calls, tokens, cost.
 * A nightly cron rolls up yesterday, one bounded job per organization.
 */
import { v } from 'convex/values'
import { internalMutation, query } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { MAX_ACTIVE_USER_IDS } from '../billing/tables'
import { DAY_MS } from '../billing/model'
import { requireConsoleAdmin } from './access'

const SCAN_CAP = 5000

export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Fan out: one rollup job per approved organization for `date` (default yesterday UTC). */
export const rollupYesterday = internalMutation({
  args: { date: v.optional(v.string()), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const date = args.date ?? utcDate(Date.now() - DAY_MS)
    const page = await ctx.db.query('companies').paginate({ numItems: 100, cursor: args.cursor ?? null })
    for (const c of page.page) {
      if (c.status !== 'approved') continue
      await ctx.scheduler.runAfter(0, internal.platform.usage.rollupCompanyDay, { companyId: c._id, date })
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.platform.usage.rollupYesterday, { date, cursor: page.continueCursor })
    }
    return null
  },
})

export const rollupCompanyDay = internalMutation({
  args: { companyId: v.id('companies'), date: v.string() },
  returns: v.null(),
  handler: async (ctx, { companyId, date }) => {
    const start = Date.parse(`${date}T00:00:00.000Z`)
    if (!Number.isFinite(start)) throw new Error('date must be YYYY-MM-DD')
    const end = start + DAY_MS

    let dailyRecords = 0
    for await (const _r of ctx.db
      .query('dailyRecords')
      .withIndex('by_company_and_date', (q) => q.eq('companyId', companyId).eq('date', date))) {
      if (++dailyRecords >= SCAN_CAP) break
    }

    let smsSent = 0
    let whatsappSent = 0
    let emailSent = 0
    const countDeliveries = (deliveries: { channel: string; status: string }[] | undefined) => {
      for (const d of deliveries ?? []) {
        if (d.status !== 'sent') continue
        if (d.channel === 'sms') smsSent += 1
        else if (d.channel === 'whatsapp') whatsappSent += 1
        else if (d.channel === 'email') emailSent += 1
      }
    }
    let scanned = 0
    for await (const d of ctx.db
      .query('notificationDispatches')
      .withIndex('by_company_and_createdAt', (q) => q.eq('companyId', companyId).gte('createdAt', start).lt('createdAt', end))) {
      countDeliveries(d.deliveries)
      if (++scanned >= SCAN_CAP) break
    }
    scanned = 0
    for await (const r of ctx.db
      .query('automationRuns')
      .withIndex('by_company_and_createdAt', (q) => q.eq('companyId', companyId).gte('createdAt', start).lt('createdAt', end))) {
      countDeliveries(r.deliveries)
      if (++scanned >= SCAN_CAP) break
    }

    let aiCalls = 0
    let aiTokens = 0
    let aiCostUsd = 0
    for await (const u of ctx.db
      .query('llmUsage')
      .withIndex('by_companyId_and_createdAt', (q) => q.eq('companyId', companyId).gte('createdAt', start).lt('createdAt', end))) {
      aiCalls += 1
      aiTokens += (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
      aiCostUsd += u.costUsd ?? 0
      if (aiCalls >= SCAN_CAP) break
    }

    // Active people: authors of audited changes that day (newest first by chain seq).
    const active = new Set<Id<'users'>>()
    scanned = 0
    for await (const a of ctx.db
      .query('auditLogs')
      .withIndex('by_companyId_and_seq', (q) => q.eq('companyId', companyId))
      .order('desc')) {
      const at = a.at ?? a._creationTime
      if (at < start) break
      if (at < end && a.userId && active.size < MAX_ACTIVE_USER_IDS) active.add(a.userId)
      if (++scanned >= SCAN_CAP) break
    }

    const row = {
      companyId,
      date,
      dailyRecords,
      activeUsers: active.size,
      activeUserIds: [...active],
      smsSent,
      whatsappSent,
      emailSent,
      aiCalls,
      aiTokens,
      aiCostUsd: Math.round(aiCostUsd * 10_000) / 10_000,
      computedAt: Date.now(),
    }
    const existing = await ctx.db
      .query('platformUsageDaily')
      .withIndex('by_companyId_and_date', (q) => q.eq('companyId', companyId).eq('date', date))
      .unique()
    if (existing) await ctx.db.replace(existing._id, row)
    else await ctx.db.insert('platformUsageDaily', row)
    return null
  },
})

const usageTotals = v.object({
  companyId: v.id('companies'),
  companyName: v.string(),
  dailyRecords: v.number(),
  smsSent: v.number(),
  whatsappSent: v.number(),
  emailSent: v.number(),
  aiCalls: v.number(),
  aiTokens: v.number(),
  aiCostUsd: v.number(),
})

/** Usage & cost per organization over the last `days` (rolled-up days only). */
export const byTenant = query({
  args: { days: v.optional(v.number()) },
  returns: v.object({ from: v.string(), to: v.string(), rows: v.array(usageTotals) }),
  handler: async (ctx, args) => {
    await requireConsoleAdmin(ctx)
    const days = Math.min(Math.max(Math.floor(args.days ?? 30), 1), 90)
    const to = utcDate(Date.now())
    const from = utcDate(Date.now() - days * DAY_MS)
    const totals = new Map<Id<'companies'>, Omit<typeof usageTotals.type, 'companyName'>>()
    let scanned = 0
    for await (const r of ctx.db.query('platformUsageDaily').withIndex('by_date', (q) => q.gte('date', from).lte('date', to))) {
      const t = totals.get(r.companyId) ?? {
        companyId: r.companyId,
        dailyRecords: 0,
        smsSent: 0,
        whatsappSent: 0,
        emailSent: 0,
        aiCalls: 0,
        aiTokens: 0,
        aiCostUsd: 0,
      }
      t.dailyRecords += r.dailyRecords
      t.smsSent += r.smsSent
      t.whatsappSent += r.whatsappSent
      t.emailSent += r.emailSent
      t.aiCalls += r.aiCalls
      t.aiTokens += r.aiTokens
      t.aiCostUsd += r.aiCostUsd
      totals.set(r.companyId, t)
      if (++scanned >= 20_000) break
    }
    const rows = []
    for (const t of totals.values()) {
      const c = await ctx.db.get(t.companyId)
      rows.push({ ...t, companyName: c?.name ?? 'Deleted organization', aiCostUsd: Math.round(t.aiCostUsd * 100) / 100 })
    }
    rows.sort((a, b) => b.aiCostUsd - a.aiCostUsd || b.smsSent - a.smsSent)
    return { from, to, rows }
  },
})
