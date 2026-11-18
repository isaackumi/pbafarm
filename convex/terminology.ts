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

/** The caller organization's words; {} when there are none. */
export const get = query({
  args: {},
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
