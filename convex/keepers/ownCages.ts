import type { MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { can, memberContextIn } from '../lib/permissions'
import { userError } from '../lib/errors'
import { apiActorOf } from '../lib/apiActor'
import { actAsSessionOf } from '../lib/actAs'
import { effectiveKeeper, keeperSettingsOf } from './model'

/**
 * "Field staff can only log their own cages" (organization setting, off by
 * default). Called by insertDailyRecord, the one path every daily entry takes
 * (form, batch, outbox, Ask Anowa, chat bot). When on, a member without
 * production.keepers.manage may log a unit only when they are its effective
 * keeper that day (the assigned keeper, or the cover while they are away) or
 * its backup. Public API keys are integrations, not people: not affected.
 */
export async function assertMayLogUnit(ctx: MutationCtx, user: Doc<'users'>, unit: Doc<'cages'>, date: string) {
  if (!unit.companyId) return
  if (apiActorOf(ctx)?.apiKeyId) return
  if ((user.role ?? 'user') === 'super_admin') return
  const { settings } = await keeperSettingsOf(ctx, unit.companyId)
  if (!settings.ownCagesOnly) return
  // The real member (chat and Anowa actors are downgraded copies of the user).
  const account = await ctx.db.get(user._id)
  if (!account || actAsSessionOf(account)) return
  const m = await memberContextIn(ctx, account, unit.companyId)
  if (m && can(m, 'production.keepers.manage')) return
  const eff = await effectiveKeeper(ctx, unit, date)
  if (eff && (eff.keeperId === user._id || eff.backupId === user._id)) return
  throw userError('FORBIDDEN', `Only ${unit.name}'s keeper can log it. Ask a manager to make you its keeper or cover.`, {
    reason: 'NOT_YOUR_UNIT',
  })
}
