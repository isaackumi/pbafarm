/** Platform audit log (PLAT-111): every console mutation and billing transition. */
import { v } from 'convex/values'
import { query } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { requireConsoleAdmin } from './access'

export const list = query({
  args: {
    companyId: v.optional(v.id('companies')),
    action: v.optional(v.string()),
    before: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(
      v.object({
        id: v.id('platformEvents'),
        at: v.number(),
        action: v.string(),
        actor: v.union(v.string(), v.null()),
        actorEmail: v.union(v.string(), v.null()),
        companyId: v.union(v.id('companies'), v.null()),
        companyName: v.union(v.string(), v.null()),
        targetTable: v.union(v.string(), v.null()),
        targetId: v.union(v.string(), v.null()),
        details: v.any(),
      }),
    ),
    nextBefore: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    await requireConsoleAdmin(ctx)
    const before = args.before ?? Number.MAX_SAFE_INTEGER
    const base = args.companyId
      ? ctx.db
          .query('platformEvents')
          .withIndex('by_companyId_and_at', (q) => q.eq('companyId', args.companyId).lt('at', before))
      : ctx.db.query('platformEvents').withIndex('by_at', (q) => q.lt('at', before))
    const page = 100
    const events = []
    let scanned = 0
    for await (const e of base.order('desc')) {
      if (++scanned > 2000) break
      if (args.action && !e.action.startsWith(args.action)) continue
      events.push(e)
      if (events.length >= page) break
    }
    const users = new Map<Id<'users'>, { name: string | null; email: string | null }>()
    const companies = new Map<Id<'companies'>, string | null>()
    const rows = []
    for (const e of events) {
      let actor = null
      if (e.actorId) {
        if (!users.has(e.actorId)) {
          const u = await ctx.db.get(e.actorId)
          users.set(e.actorId, { name: u?.name ?? null, email: u?.email ?? null })
        }
        actor = users.get(e.actorId)!
      }
      let companyName = null
      if (e.companyId) {
        if (!companies.has(e.companyId)) companies.set(e.companyId, (await ctx.db.get(e.companyId))?.name ?? null)
        companyName = companies.get(e.companyId) ?? null
      }
      rows.push({
        id: e._id,
        at: e.at,
        action: e.action,
        actor: actor?.name ?? (e.actorId ? 'Unknown' : null),
        actorEmail: actor?.email ?? null,
        companyId: e.companyId ?? null,
        companyName,
        targetTable: e.targetTable ?? null,
        targetId: e.targetId ?? null,
        details: e.details ?? null,
      })
    }
    return { rows, nextBefore: events.length >= page ? events[events.length - 1].at : null }
  },
})
