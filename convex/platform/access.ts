/**
 * Platform console access (PLAT-101). The hostname (console.heitechinc.com,
 * middleware.js) only decides which pages are served; this is the real gate:
 * a super_admin whose current sign-in session passed two-step verification.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requirePlatformAdmin } from '../lib/permissions'
import { sessionMfaVerified } from '../lib/authz'
import { AUTH_ERROR_MESSAGES } from '../lib/authErrors'

export async function requireConsoleAdmin(ctx: QueryCtx | MutationCtx): Promise<Doc<'users'>> {
  // The real account even while the admin has a support (act-as) session open.
  const user = await requirePlatformAdmin(ctx, { ignoreActAs: true })
  // requireUser already enforces this for super_admins; checked again so a
  // change to the shared MFA policy can never open the console.
  if (!(await sessionMfaVerified(ctx, user))) throw new Error(AUTH_ERROR_MESSAGES.MFA_REQUIRED)
  return user
}
