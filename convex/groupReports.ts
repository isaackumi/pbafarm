/**
 * Consolidated reporting (ENT-002). Read-only KPIs of the caller's
 * organization and of its subsidiaries — only those linked by an active
 * companyLinks row whose subsidiary shares reports (ENT-001). Needs
 * group.reports.view in the parent organization. Each organization's figures
 * come from lib/siteKpis (bounded index ranges); amounts stay in each
 * organization's currency (no FX conversion).
 */
import { v } from 'convex/values'
import { query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireMember } from './lib/permissions'
import { userError } from './lib/errors'
import { isBusinessDate } from './lib/dates'
import { companyCurrency, emptyKpis, siteKpis, totalKpis } from './lib/siteKpis'
import { sharingSubsidiaries } from './companyLinks'

const rangeArgs = { from: v.string(), to: v.string() }

function checkRange(from: string, to: string) {
  if (!isBusinessDate(from) || !isBusinessDate(to) || from > to) throw userError('VALIDATION', 'Choose a valid date range')
}

async function orgRow(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
  range: { from: string; to: string },
  inScope?: (siteId: Id<'farmLocations'> | undefined) => boolean,
) {
  const company = await ctx.db.get(companyId)
  if (!company || company.status !== 'approved') return null
  const { sites, bySite, truncated } = await siteKpis(ctx, companyId, range, inScope)
  return {
    companyId,
    name: company.name,
    code: company.code,
    currency: companyCurrency(company),
    sites: sites.filter((s) => s.active !== false).length,
    truncated,
    ...totalKpis(bySite),
  }
}

/** One row per organization: the caller's own (within their site scope), then each sharing subsidiary. */
export const overview = query({
  args: rangeArgs,
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'group.reports.view' })
    if (!m.companyId) return { rows: [] }
    checkRange(args.from, args.to)
    const range = { from: args.from, to: args.to }
    const scope = m.siteScope
    const self = await orgRow(ctx, m.companyId, range, (siteId) => scope === 'all' || (!!siteId && scope.has(siteId)))
    const rows = self ? [{ ...self, isSelf: true }] : []
    for (const link of await sharingSubsidiaries(ctx, m.companyId)) {
      const row = await orgRow(ctx, link.childCompanyId, range)
      if (row) rows.push({ ...row, isSelf: false })
    }
    return { rows }
  },
})

/** Per-site KPIs of one sharing subsidiary. */
export const subsidiarySites = query({
  args: { ...rangeArgs, childCompanyId: v.id('companies') },
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'group.reports.view' })
    if (!m.companyId) throw userError('NOT_FOUND', 'Organization not found')
    checkRange(args.from, args.to)
    const links = await sharingSubsidiaries(ctx, m.companyId)
    if (!links.some((l) => l.childCompanyId === args.childCompanyId)) throw userError('NOT_FOUND', 'Organization not found')
    const company = await ctx.db.get(args.childCompanyId)
    if (!company || company.status !== 'approved') throw userError('NOT_FOUND', 'Organization not found')
    const { sites, bySite, truncated } = await siteKpis(ctx, args.childCompanyId, { from: args.from, to: args.to })
    return {
      name: company.name,
      currency: companyCurrency(company),
      truncated,
      sites: sites
        .filter((s) => s.active !== false)
        .map((s) => ({ siteId: s._id, name: s.name, ...(bySite.get(s._id) ?? emptyKpis()) }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }
  },
})
