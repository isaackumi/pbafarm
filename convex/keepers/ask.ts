/**
 * Ask Anowa's keeper reads ("who is behind today?", "who keeps B-12?"). Run
 * as the signed-in member like the other web read tools: scope and
 * permission come from the session, never from the model. Compact JSON the
 * model rephrases.
 */
import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'
import { can, requireMember } from '../lib/permissions'
import { webMember } from '../anowa/scope'
import { farmDate, matchUnit, unitsInScope, type MemberScope } from '../bot/scope'
import type { QueryCtx } from '../_generated/server'
import { buildKeeperRows, loadOrg } from './board'
import { effectiveKeeper, personName } from './model'

export const keeperReadTool = v.union(v.literal('behind'), v.literal('keeper_of'))

type ReadOut = { ok: true; data: string } | { ok: false; error: string }

/** The keeper reads for a member scope (web session or chat binding). */
export async function keeperRead(
  ctx: QueryCtx,
  bound: MemberScope,
  tool: 'behind' | 'keeper_of',
  unit: string | undefined,
  now: number,
): Promise<ReadOut> {
  const member = bound.member
  const siteId = bound.site?._id
  const date = await farmDate(ctx, bound, siteId, now)
  if (tool === 'keeper_of') {
    if (!can(member, 'production.view')) return { ok: false as const, error: 'You do not have production.view permission.' }
    const m = matchUnit(await unitsInScope(ctx, bound), unit ?? '')
    if (!m.unit) return { ok: false as const, error: m.candidates.length ? `Which unit? ${m.candidates.join(', ')}` : 'No such unit in your sites.' }
    const eff = await effectiveKeeper(ctx, m.unit, date)
    if (!eff) return { ok: true as const, data: JSON.stringify({ unit: m.unit.name, keeper: null, note: 'No keeper: nobody gets its reminders.' }) }
    return {
      ok: true as const,
      data: JSON.stringify({
        unit: m.unit.name,
        keeper: personName(await ctx.db.get(eff.assignedId)),
        backup: eff.backupId ? personName(await ctx.db.get(eff.backupId)) : null,
        coveredTodayBy: eff.coverId ? personName(await ctx.db.get(eff.coverId)) : null,
      }),
    }
  }
  if (!can(member, 'production.keepers.manage')) {
    return { ok: false as const, error: 'Only managers can see who is behind. The user can open My cages for their own units.' }
  }
  const org = await loadOrg(ctx, { ...member, companyId: bound.binding.companyId }, date, siteId)
  const names = new Map<string, string>()
  for (const a of org.assignments.values()) if (!names.has(a.keeperId)) names.set(a.keeperId, personName(await ctx.db.get(a.keeperId)))
  for (const c of org.covers) for (const id of [c.coverId, c.keeperId]) if (!names.has(id)) names.set(id, personName(await ctx.db.get(id)))
  const rows = buildKeeperRows(org, names, date)
  const keepers = rows.flatMap((r) => (r.kind === 'keeper' ? [r] : []))
  const behind = keepers.filter((r) => r.due > 0)
  return {
    ok: true as const,
    data: JSON.stringify({
      date,
      deadline: org.settings.deadline,
      behind: behind.slice(0, 15).map((r) => ({ keeper: r.name, site: r.site, row: r.row, due: r.due, of: r.stocked })),
      moreBehind: Math.max(0, behind.length - 15),
      unitsWithoutKeeper: rows.reduce((n, g) => n + (g.kind === 'unassigned' ? g.units : 0), 0),
      keepersOverCapacity: keepers.filter((r) => r.over).length,
      capacity: org.settings.capacity,
      away: keepers.filter((r) => r.away).slice(0, 10).map((r) => ({ keeper: r.name, until: r.away?.until, cover: r.away?.coverName })),
    }),
  }
}

export const read = internalQuery({
  args: { siteId: v.optional(v.id('farmLocations')), tool: keeperReadTool, unit: v.optional(v.string()), now: v.number() },
  returns: v.union(v.object({ ok: v.literal(true), data: v.string() }), v.object({ ok: v.literal(false), error: v.string() })),
  handler: async (ctx, { siteId, tool, unit, now }) => {
    const w = await webMember(ctx, await requireMember(ctx, { permission: 'ai.use' }), siteId)
    return await keeperRead(ctx, w, tool, unit, now)
  },
})
