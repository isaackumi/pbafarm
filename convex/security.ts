import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { getAuthSessionId } from '@convex-dev/auth/server'
import type { Id } from './_generated/dataModel'
import { requireRole, requireUser, sessionMfaVerified } from './lib/authz'
import { AUTH_ERROR_MESSAGES } from './lib/authErrors'
import { logAudit } from './lib/tenancy'
import { channelAvailable } from './messaging/deliver'
import { securityPolicy } from './messaging/policy'

/**
 * Company sign-in policy (SEC-006 phone sign-in, SEC-007 two-step
 * verification; doc 18 §7–8). Admin-only. Every rule that keeps a company
 * from locking itself out is enforced here, not in the UI.
 */

const phoneChannel = v.union(v.literal('sms'), v.literal('whatsapp'))

export const getPolicy = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx)
    requireRole(me, 'admin')
    if (!me.companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
    const company = await ctx.db.get(me.companyId)
    return {
      ...securityPolicy(company),
      channelAvailable: {
        sms: await channelAvailable(ctx, me.companyId, 'sms'),
        whatsapp: await channelAvailable(ctx, me.companyId, 'whatsapp'),
      },
      adminHasPhone: !!me.phone,
    }
  },
})

export const updatePolicy = mutation({
  args: {
    allowPhoneLogin: v.optional(v.boolean()),
    phoneLoginChannel: v.optional(phoneChannel),
    require2fa: v.optional(v.boolean()),
    twoFactorChannel: v.optional(phoneChannel),
    phoneLoginSatisfies2fa: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx)
    requireRole(me, 'admin')
    if (!me.companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
    const companyId = me.companyId
    const company = await ctx.db.get(companyId)
    if (!company) throw new Error('Company not found')
    const before = securityPolicy(company)
    const next = { ...before }
    for (const key of Object.keys(args) as (keyof typeof args)[]) {
      if (args[key] !== undefined) (next as any)[key] = args[key]
    }
    const label = (c: 'sms' | 'whatsapp') => (c === 'sms' ? 'SMS' : 'WhatsApp')

    if (next.require2fa) {
      if (!(await channelAvailable(ctx, companyId, next.twoFactorChannel))) {
        throw new Error(
          `Set up and test a ${label(next.twoFactorChannel)} channel in Messaging before requiring two-step verification.`,
        )
      }
      if (!before.require2fa && !me.phone) {
        throw new Error(
          'Add your own phone number first (Users page) so you can verify your next sign-in.',
        )
      }
    }
    if (next.allowPhoneLogin && !(await channelAvailable(ctx, companyId, next.phoneLoginChannel))) {
      throw new Error(
        `Set up and test a ${label(next.phoneLoginChannel)} channel in Messaging before allowing phone sign-in.`,
      )
    }

    const settings = company.settings ?? { aiAssistantEnabled: false }
    await ctx.db.patch(companyId, {
      settings: {
        ...settings,
        security: { ...next, updatedAt: Date.now(), updatedBy: me._id },
      },
    })
    if (next.require2fa && !before.require2fa) {
      // The admin turning 2FA on keeps this session, so they can turn it off
      // again if codes do not arrive; every other session must verify.
      const sessionId = (await getAuthSessionId(ctx)) as Id<'authSessions'> | null
      if (sessionId && !(await sessionMfaVerified(ctx, me._id))) {
        await ctx.db.insert('mfaSessions', {
          userId: me._id,
          sessionId,
          companyId,
          purpose: 'verify',
          attempts: 0,
          verifiedAt: Date.now(),
          method: 'policy_enable',
        })
      }
    }
    await logAudit(ctx, {
      actionType: 'security_policy_update',
      tableName: 'companies',
      recordId: companyId,
      previousValues: before,
      newValues: next,
    })
    return next
  },
})

/**
 * Break-glass for the platform operator when a company is locked out (its
 * only code channel broke):
 *   npx convex run security:clearPolicyForCompany '{"companyId":"…"}'
 * Turns off two-step verification and phone sign-in; audited.
 */
export const clearPolicyForCompany = internalMutation({
  args: { companyId: v.id('companies') },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get(companyId)
    if (!company) throw new Error('Company not found')
    const before = securityPolicy(company)
    const settings = company.settings ?? { aiAssistantEnabled: false }
    await ctx.db.patch(companyId, {
      settings: {
        ...settings,
        security: {
          ...(settings.security ?? {}),
          require2fa: false,
          allowPhoneLogin: false,
          updatedAt: Date.now(),
        },
      },
    })
    await ctx.db.insert('auditLogs', {
      companyId,
      actionType: 'security_policy_cleared',
      tableName: 'companies',
      recordId: companyId,
      previousValues: before,
      newValues: { require2fa: false, allowPhoneLogin: false, by: 'platform operator' },
    })
    return null
  },
})
