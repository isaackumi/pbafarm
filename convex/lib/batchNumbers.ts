import type { QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { asOfDate } from './scope'

function cageBatchSlug(cage: { code?: string; name?: string }) {
  const raw = (cage.code || cage.name || 'CAGE')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 10)
  return raw || 'CAGE'
}

/**
 * Unique batch number like CAGE01-20260904 or CAGE01-20260904-2, unique
 * within the cage's company. Reads only the company's numbers that start with
 * the base (`by_company_and_batchNumber` prefix range), not the whole
 * stocking table.
 */
export async function allocateBatchNumber(
  ctx: QueryCtx,
  user: Doc<'users'>,
  cage: { code?: string; name?: string; companyId?: Id<'companies'> },
  stockingDate: string | undefined,
) {
  const datePart = asOfDate(stockingDate).replace(/-/g, '')
  const base = `${cageBatchSlug(cage)}-${datePart}`
  const companyId = cage.companyId ?? user.companyId
  const rows = await ctx.db
    .query('stockingHistory')
    .withIndex('by_company_and_batchNumber', (q) =>
      q
        .eq('companyId', companyId)
        .gte('batchNumber', base)
        .lte('batchNumber', `${base}￿`),
    )
    .collect()
  const existing = new Set(rows.map((r) => r.batchNumber))
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
