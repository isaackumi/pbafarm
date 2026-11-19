import type { Doc } from '../_generated/dataModel'

/**
 * Whether an organization's members, API keys and sign-in paths may use it:
 * approved and not suspended (PLAT-104). requireUser applies the same rule
 * with a specific error (COMPANY_NOT_APPROVED / TENANT_SUSPENDED).
 */
export function companyUsable(
  company: Pick<Doc<'companies'>, 'status' | 'suspendedAt'> | null | undefined,
): company is Pick<Doc<'companies'>, 'status' | 'suspendedAt'> {
  return !!company && company.status === 'approved' && company.suspendedAt === undefined
}
