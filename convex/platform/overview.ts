/** Platform console overview KPIs (PLAT-102). */
import { v } from 'convex/values'
import { query } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { requireConsoleAdmin } from './access'
import { PLATFORM_SCAN_LIMIT } from '../lib/scope'
import { DAY_MS, monthlyAmount, priceIn } from '../billing/model'
import { utcDate } from './usage'

const money = v.object({ currency: v.string(), amountMinor: v.number() })

function addMoney(map: Map<string, number>, currency: string, amount: number) {
  map.set(currency, (map.get(currency) ?? 0) + amount)
}
const toList = (map: Map<string, number>) =>
  [...map.entries()].map(([currency, amountMinor]) => ({ currency, amountMinor })).sort((a, b) => a.currency.localeCompare(b.currency))

export const kpis = query({
  args: {},
  returns: v.object({
    tenants: v.object({ pending: v.number(), active: v.number(), suspended: v.number(), rejected: v.number(), total: v.number() }),
    subscriptions: v.object({ trialing: v.number(), active: v.number(), past_due: v.number(), suspended: v.number(), cancelled: v.number(), none: v.number() }),
    activeUsers7d: v.number(),
    activeUsers30d: v.number(),
    recordsPerDay: v.array(v.object({ date: v.string(), records: v.number() })),
    mrr: v.array(money),
    arr: v.array(money),
    trialsEnding7d: v.array(v.object({ companyId: v.id('companies'), name: v.string(), trialEndsAt: v.number() })),
    overdue: v.object({ count: v.number(), amounts: v.array(money) }),
    usage30d: v.object({ smsSent: v.number(), whatsappSent: v.number(), emailSent: v.number(), aiCalls: v.number(), aiTokens: v.number(), aiCostUsd: v.number() }),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireConsoleAdmin(ctx)
    const now = Date.now()
    const companies = await ctx.db.query('companies').take(PLATFORM_SCAN_LIMIT + 1)
    const truncated = companies.length > PLATFORM_SCAN_LIMIT
    const tenants = { pending: 0, active: 0, suspended: 0, rejected: 0, total: 0 }
    for (const c of companies.slice(0, PLATFORM_SCAN_LIMIT)) {
      tenants.total += 1
      if (c.status === 'pending') tenants.pending += 1
      else if (c.status === 'rejected') tenants.rejected += 1
      else if (c.suspendedAt !== undefined) tenants.suspended += 1
      else tenants.active += 1
    }

    const subscriptions = { trialing: 0, active: 0, past_due: 0, suspended: 0, cancelled: 0, none: 0 }
    const latest = new Map<Id<'companies'>, { status: keyof typeof subscriptions; planId: Id<'plans'>; currency: string; seats?: number; t: number }>()
    for await (const s of ctx.db.query('subscriptions')) {
      const prev = latest.get(s.companyId)
      if (!prev || prev.t < s._creationTime) latest.set(s.companyId, { status: s.status, planId: s.planId, currency: s.currency, seats: s.seats, t: s._creationTime })
    }
    const plans = new Map((await ctx.db.query('plans').take(200)).map((p) => [p._id, p]))
    const mrr = new Map<string, number>()
    for (const s of latest.values()) {
      subscriptions[s.status] += 1
      if (s.status !== 'active' && s.status !== 'past_due') continue
      const plan = plans.get(s.planId)
      const price = plan ? priceIn(plan, s.currency) : null
      if (plan && price) addMoney(mrr, s.currency, monthlyAmount(price, plan.interval) * Math.max(1, s.seats ?? 1))
    }
    subscriptions.none = Math.max(0, tenants.active + tenants.suspended - latest.size)
    const arr = new Map([...mrr.entries()].map(([c, a]) => [c, a * 12]))

    const trialsEnding7d = []
    for (const s of await ctx.db
      .query('subscriptions')
      .withIndex('by_status_and_trialEndsAt', (q) => q.eq('status', 'trialing').gte('trialEndsAt', now).lte('trialEndsAt', now + 7 * DAY_MS))
      .take(50)) {
      const c = await ctx.db.get(s.companyId)
      trialsEnding7d.push({ companyId: s.companyId, name: c?.name ?? 'Deleted organization', trialEndsAt: s.trialEndsAt! })
    }

    const overdueAmounts = new Map<string, number>()
    let overdueCount = 0
    for await (const inv of ctx.db.query('billingInvoices').withIndex('by_status_and_dueAt', (q) => q.eq('status', 'open').lt('dueAt', now))) {
      overdueCount += 1
      addMoney(overdueAmounts, inv.currency, inv.totalMinor - inv.paidMinor)
      if (overdueCount >= 2000) break
    }

    const since30 = utcDate(now - 30 * DAY_MS)
    const since7 = utcDate(now - 7 * DAY_MS)
    const since14 = utcDate(now - 14 * DAY_MS)
    const users30 = new Set<string>()
    const users7 = new Set<string>()
    const perDay = new Map<string, number>()
    const usage30d = { smsSent: 0, whatsappSent: 0, emailSent: 0, aiCalls: 0, aiTokens: 0, aiCostUsd: 0 }
    let scanned = 0
    for await (const r of ctx.db.query('platformUsageDaily').withIndex('by_date', (q) => q.gte('date', since30))) {
      for (const id of r.activeUserIds) {
        users30.add(id)
        if (r.date >= since7) users7.add(id)
      }
      if (r.date >= since14) perDay.set(r.date, (perDay.get(r.date) ?? 0) + r.dailyRecords)
      usage30d.smsSent += r.smsSent
      usage30d.whatsappSent += r.whatsappSent
      usage30d.emailSent += r.emailSent
      usage30d.aiCalls += r.aiCalls
      usage30d.aiTokens += r.aiTokens
      usage30d.aiCostUsd += r.aiCostUsd
      if (++scanned >= 20_000) break
    }
    usage30d.aiCostUsd = Math.round(usage30d.aiCostUsd * 100) / 100

    return {
      tenants,
      subscriptions,
      activeUsers7d: users7.size,
      activeUsers30d: users30.size,
      recordsPerDay: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, records]) => ({ date, records })),
      mrr: toList(mrr),
      arr: toList(arr),
      trialsEnding7d,
      overdue: { count: overdueCount, amounts: toList(overdueAmounts) },
      usage30d,
      truncated,
    }
  },
})
