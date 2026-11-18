/**
 * Hatchery and nursery permissions (Phase 5, `hatchery.*`).
 *
 * Until the Phase 3 member guard (`requireMember`, permission catalog) is on
 * main, these map onto today's roles: admins hold every hatchery permission,
 * other members every one except HATCHERY_ADMIN_ONLY, matching how grading,
 * transfers and stock corrections are gated elsewhere. When the catalog lands,
 * register HATCHERY_PERMISSIONS there and make `requireHatchery` call
 * `requireMember(ctx, { permission })`; callers do not change.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireUser } from './authz'
import { AUTH_ERROR_MESSAGES } from './authErrors'
import { userError } from './errors'

type Ctx = QueryCtx | MutationCtx

export const HATCHERY_PERMISSIONS = {
  'hatchery.view': 'See broodstock, spawnings, incubation and larval batches',
  'hatchery.broodstock.manage': 'Add and edit broodstock',
  'hatchery.spawning.record': 'Record spawnings, egg collections, incubation and hatches',
  'hatchery.larval.record': 'Record larval rearing logs and live feed',
  'hatchery.grade': 'Grade larvae into fingerling batches',
  'hatchery.dispatch': 'Transfer and sell fingerlings',
  'hatchery.correct': 'Reverse hatches and larval logs',
} as const

export type HatcheryPermission = keyof typeof HATCHERY_PERMISSIONS

export const HATCHERY_ADMIN_ONLY: readonly HatcheryPermission[] = [
  'hatchery.grade',
  'hatchery.dispatch',
  'hatchery.correct',
]

export type HatcheryMember = { user: Doc<'users'>; companyId: Id<'companies'> }

/** The signed-in member of a company holding `permission`, or a refusal. */
export async function requireHatchery(ctx: Ctx, permission: HatcheryPermission): Promise<HatcheryMember> {
  const user = await requireUser(ctx)
  if (!user.companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
  const role = user.role ?? 'user'
  if (role !== 'admin' && role !== 'super_admin' && HATCHERY_ADMIN_ONLY.includes(permission)) {
    throw userError('FORBIDDEN', `Insufficient permissions: ${permission}`, { permission })
  }
  return { user, companyId: user.companyId }
}

/** A document of the member's company, or NOT_FOUND (other tenants' rows are invisible). */
export function ownDoc<T extends { companyId?: Id<'companies'> }>(
  m: HatcheryMember,
  doc: T | null | undefined,
  label: string,
): T {
  if (!doc || doc.companyId !== m.companyId) throw userError('NOT_FOUND', `${label} not found`)
  return doc
}
