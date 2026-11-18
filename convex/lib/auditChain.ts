/**
 * Tamper-evident audit log (TRACE-007, doc 07 §4.3).
 *
 * Every auditLogs row of a company is a link in a hash chain: it carries its
 * position (`seq`), the previous row's hash (`prevHash`) and
 * `hash = SHA-256(canonical JSON of the row without hash and system fields)`.
 * The chain head (auditChainHeads) holds the last seq and hash, so deleting
 * rows from the end is detected as well as editing or deleting in the middle.
 *
 * All inserts into auditLogs go through insertAuditLog. Rows without a
 * company (platform actions with no tenant) are written unchained.
 *
 * Contention: the head is one document per company, so audit writes of one
 * company serialize (Convex retries the conflicting mutation). Fine at farm
 * scale; shard the chain per site if that ever shows in insights.
 */
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { sha256Hex } from './tokens'

export const GENESIS_HASH = '0'.repeat(64)

export type AuditRow = {
  userId?: Id<'users'>
  actionType: string
  tableName: string
  recordId?: string
  previousValues?: unknown
  newValues?: unknown
  locationId?: Id<'farmLocations'>
  companyId?: Id<'companies'>
  apiKeyId?: Id<'apiKeys'>
}

/** JSON with sorted keys and no undefined values: one string per value. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'bigint') return JSON.stringify(`${value.toString()}n`)
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value))
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (value instanceof ArrayBuffer) {
    return JSON.stringify(`bytes:${Array.from(new Uint8Array(value)).join(',')}`)
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

/** The hash a chained row must carry: everything but hash, _id and _creationTime. */
export async function hashAuditRow(row: Record<string, unknown>): Promise<string> {
  const { hash: _hash, _id, _creationTime, ...rest } = row
  void _hash
  void _id
  void _creationTime
  return await sha256Hex(canonicalJson(rest))
}

export async function chainHead(ctx: MutationCtx, companyId: Id<'companies'>) {
  return await ctx.db
    .query('auditChainHeads')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .unique()
}

/** Insert an audit row, chained when it belongs to a company. */
export async function insertAuditLog(ctx: MutationCtx, row: AuditRow): Promise<Id<'auditLogs'>> {
  const clean = Object.fromEntries(
    Object.entries(row).filter(([, v]) => v !== undefined),
  ) as AuditRow
  if (!clean.companyId) {
    return await ctx.db.insert('auditLogs', clean)
  }
  const head = await chainHead(ctx, clean.companyId)
  const seq = (head?.seq ?? 0) + 1
  const prevHash = head?.hash ?? GENESIS_HASH
  const at = Date.now()
  const linked = { ...clean, seq, prevHash, at }
  const hash = await hashAuditRow(linked)
  const id = await ctx.db.insert('auditLogs', { ...linked, hash })
  if (head) {
    await ctx.db.patch(head._id, { seq, hash, updatedAt: at })
  } else {
    await ctx.db.insert('auditChainHeads', { companyId: clean.companyId, seq, hash, updatedAt: at })
  }
  return id
}

export type LinkCheck =
  | { ok: true; hash: string }
  | { ok: false; reason: string }

/** Check one row against the expected position and previous hash. */
export async function checkLink(
  row: Doc<'auditLogs'>,
  expectedSeq: number,
  expectedPrevHash: string,
): Promise<LinkCheck> {
  if (row.seq !== expectedSeq) {
    return { ok: false, reason: `expected entry ${expectedSeq}, found ${row.seq} (entries missing)` }
  }
  if (row.prevHash !== expectedPrevHash) {
    return { ok: false, reason: 'link to the previous entry does not match' }
  }
  const actual = await hashAuditRow(row as unknown as Record<string, unknown>)
  if (actual !== row.hash) {
    return { ok: false, reason: 'entry content does not match its hash (edited)' }
  }
  return { ok: true, hash: actual }
}
