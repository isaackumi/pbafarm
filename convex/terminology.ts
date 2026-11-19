/**
 * Organization words (CUSTOM-003, D-007). Admins rename the built-in labels
 * (Cage → Pen, Feed → Ration) and every screen reads the same overrides;
 * nothing is forked per customer.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAccount, requireMember } from './lib/permissions'
import { logAudit } from './lib/tenancy'
import { userError } from './lib/errors'
import { normalizeTerminology, terminologyOf } from './lib/terminology'

const getItem = v.object({
  cage: v.optional(v.string()),
  pond: v.optional(v.string()),
  tank: v.optional(v.string()),
  raceway: v.optional(v.string()),
  incubator: v.optional(v.string()),
  hapa: v.optional(v.string()),
  stocking: v.optional(v.string()),
  harvest: v.optional(v.string()),
  unit: v.optional(v.string()),
  feed: v.optional(v.string()),
  site: v.optional(v.string()),
  batch: v.optional(v.string()),
  sampling: v.optional(v.string()),
  unitPlural: v.optional(v.string()),
  cagePlural: v.optional(v.string()),
  pondPlural: v.optional(v.string()),
  tankPlural: v.optional(v.string()),
  racewayPlural: v.optional(v.string()),
  hatcheryTank: v.optional(v.string()),
  hatcheryTankPlural: v.optional(v.string()),
  incubatorPlural: v.optional(v.string()),
  hapaPlural: v.optional(v.string()),
  feedPlural: v.optional(v.string()),
  harvestPlural: v.optional(v.string()),
  batchPlural: v.optional(v.string()),
  sitePlural: v.optional(v.string()),
  stockingPlural: v.optional(v.string()),
  samplingPlural: v.optional(v.string()),
})

/** The caller organization's words; {} when there are none. */
export const get = query({
  args: {},
  returns: getItem,
  handler: async (ctx) => {
    const user = await requireAccount(ctx)
    if (!user.companyId) return {}
    const company = await ctx.db.get(user.companyId)
    return terminologyOf(company)
  },
})

/** Replace the words. An empty record restores every built-in label. */
export const update = mutation({
  args: { terms: v.record(v.string(), v.string()) },
  returns: getItem,
  handler: async (ctx, { terms }) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'customization.manage' })
    if (!companyId) throw userError('VALIDATION', 'No company linked to your account')
    const company = await ctx.db.get(companyId)
    if (!company) throw userError('NOT_FOUND', 'Company not found')
    const clean = normalizeTerminology(terms)
    await ctx.db.patch(company._id, {
      terminology: Object.keys(clean).length ? clean : undefined,
    })
    await logAudit(ctx, {
      actionType: 'update_terminology',
      tableName: 'companies',
      recordId: company._id,
      previousValues: terminologyOf(company),
      newValues: clean,
    })
    return clean
  },
})
