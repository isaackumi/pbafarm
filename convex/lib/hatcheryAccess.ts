/**
 * Hatchery and nursery permissions (Phase 5, `hatchery.*`).
 *
 * Registered in the permission catalog (lib/permissionCatalog, group
 * Hatchery); requireHatchery is requireMember with one of these. Managers hold
 * all but HATCHERY_ADMIN_ONLY, field staff view and record, viewers view.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireMember } from './permissions'
import { AUTH_ERROR_MESSAGES } from './authErrors'
import { userError } from './errors'
import { isMutationCtx } from './actAs'
import { rowInSiteScope, siteScopeOf } from './scope'

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

export type HatcheryMember = {
  user: Doc<'users'>
  companyId: Id<'companies'>
  /** Sites the member is limited to (PERM-004); null = every site. */
  siteScope: ReadonlySet<string> | null
  /** Called from a mutation: out-of-scope rows are FORBIDDEN rather than hidden. */
  write: boolean
}

/** The signed-in member of a company holding `permission`, or a refusal. */
export async function requireHatchery(ctx: Ctx, permission: HatcheryPermission): Promise<HatcheryMember> {
  const { user } = await requireMember(ctx, { permission })
  if (!user.companyId) throw new Error(AUTH_ERROR_MESSAGES.NO_COMPANY)
  return { user, companyId: user.companyId, siteScope: siteScopeOf(user), write: isMutationCtx(ctx) }
}

/**
 * A document of the member's company and sites. Other tenants' rows are
 * NOT_FOUND. Rows at a site outside the member's scope (PERM-004) are
 * NOT_FOUND on reads and FORBIDDEN on writes.
 */
export function ownDoc<T extends { companyId?: Id<'companies'> }>(
  m: HatcheryMember,
  doc: T | null | undefined,
  label: string,
): T {
  if (!doc || doc.companyId !== m.companyId) throw userError('NOT_FOUND', `${label} not found`)
  if (!rowInSiteScope(m.siteScope, doc)) {
    if (m.write) throw userError('FORBIDDEN', `${label} is at a site you do not have access to`)
    throw userError('NOT_FOUND', `${label} not found`)
  }
  return doc
}

/** A site the member may use: of their company and within their site scope. */
export function ownSite(m: HatcheryMember, site: Doc<'farmLocations'> | null | undefined): Doc<'farmLocations'> {
  const s = ownDoc(m, site, 'Site')
  if (m.siteScope && !m.siteScope.has(s._id)) {
    throw userError(m.write ? 'FORBIDDEN' : 'NOT_FOUND', m.write ? 'Site is outside your access' : 'Site not found')
  }
  return s
}

/** Rows within the member's site scope (lists). */
export function inScope<T>(m: HatcheryMember, rows: T[]): T[] {
  return m.siteScope ? rows.filter((r) => rowInSiteScope(m.siteScope, r)) : rows
}
