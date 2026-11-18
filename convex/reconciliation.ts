/**
 * Nightly stock reconciliation (PROD-005, doc 05 I7): for every cage, compare
 * `cages.currentCount` (still written by the legacy code during dual-write)
 * with Σ `stockEvents`. Mismatches are reported to each company's admins as
 * one notification per night; nothing is corrected automatically.
 *
 * On demand: npx convex run reconciliation:report '{"companyId":"…"}'
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { eventsForUnit } from './lib/productionEngine'

const PAGE = 50
const MAX_KEPT = 200

const mismatchValidator = v.object({
  companyId: v.id('companies'),
  cageId: v.id('cages'),
  cage: v.string(),
  cageCount: v.number(),
  ledgerCount: v.number(),
})
type Mismatch = typeof mismatchValidator.type

async function checkCage(ctx: QueryCtx, cage: Doc<'cages'>): Promise<Mismatch | null> {
  if (!cage.companyId) return null
  const events = await eventsForUnit(ctx, cage._id)
  const ledgerCount = events.reduce((s, e) => s + e.qtyDelta, 0)
  const cageCount = cage.currentCount ?? 0
  if (ledgerCount === cageCount) return null
  return { companyId: cage.companyId, cageId: cage._id, cage: cage.name, cageCount, ledgerCount }
}

/** Mismatches for one company, now (read-only). */
export const report = internalQuery({
  args: { companyId: v.id('companies') },
  returns: v.object({ checked: v.number(), mismatches: v.array(mismatchValidator) }),
  handler: async (ctx, { companyId }) => {
    const cages = await ctx.db
      .query('cages')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(2000)
    const mismatches: Mismatch[] = []
    for (const cage of cages) {
      const m = await checkCage(ctx, cage)
      if (m) mismatches.push(m)
    }
    return { checked: cages.length, mismatches }
  },
})

export function mismatchMessage(rows: Mismatch[]) {
  const shown = rows
    .slice(0, 5)
    .map((r) => `${r.cage} (cage ${r.cageCount.toLocaleString()}, ledger ${r.ledgerCount.toLocaleString()})`)
  const more = rows.length > 5 ? ` and ${rows.length - 5} more` : ''
  const noun = rows.length === 1 ? 'cage differs' : 'cages differ'
  return `${rows.length} ${noun} from the stock ledger: ${shown.join(', ')}${more}.`
}

/** One page of cages; the last page notifies admins. Scheduled nightly by crons.ts. */
export const run = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    mismatches: v.optional(v.array(mismatchValidator)),
    total: v.optional(v.number()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const date = args.date ?? new Date().toISOString().slice(0, 10)
    const page = await ctx.db.query('cages').paginate({ cursor: args.cursor ?? null, numItems: PAGE })
    const kept = [...(args.mismatches ?? [])]
    let total = args.total ?? 0
    for (const cage of page.page) {
      const m = await checkCage(ctx, cage)
      if (!m) continue
      total++
      if (kept.length < MAX_KEPT) kept.push(m)
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.reconciliation.run, {
        cursor: page.continueCursor,
        mismatches: kept,
        total,
        date,
      })
      return { done: false, total }
    }

    const byCompany = new Map<string, Mismatch[]>()
    for (const m of kept) {
      const k = String(m.companyId)
      if (!byCompany.has(k)) byCompany.set(k, [])
      byCompany.get(k)!.push(m)
    }
    let notified = 0
    for (const rows of byCompany.values()) {
      const companyId: Id<'companies'> = rows[0].companyId
      const admins = (
        await ctx.db
          .query('users')
          .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
          .take(500)
      ).filter((u) => (u.role === 'admin' || u.role === 'super_admin') && u.active !== false)
      for (const admin of admins) {
        const dedupeKey = `stock-recon:${companyId}:${date}:${admin._id}`
        const seen = await ctx.db
          .query('notifications')
          .withIndex('by_dedupe', (q) => q.eq('dedupeKey', dedupeKey))
          .first()
        if (seen) continue
        await ctx.db.insert('notifications', {
          userId: admin._id,
          title: 'Stock ledger mismatch',
          message: mismatchMessage(rows),
          type: 'warning',
          read: false,
          link: '/cages',
          companyId,
          dedupeKey,
        })
        notified++
      }
    }
    return { done: true, total, companies: byCompany.size, notified }
  },
})
