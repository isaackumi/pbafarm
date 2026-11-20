/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { authErrorCode } from './lib/authErrors'
import { insertAuditLog, canonicalJson } from './lib/auditChain'
import { SKIPPED_TABLES, TENANT_TABLES } from './lib/governance'
import { buildZip, crc32, readZip, toCsv } from './lib/zip'

const modules = import.meta.glob('./**/*.ts')

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

async function codeOf(p: Promise<unknown>) {
  try {
    await p
  } catch (err) {
    const message = (err as Error).message
    const auth = authErrorCode(err)
    if (auth) return auth
    try {
      const data = JSON.parse(message.slice(message.indexOf('{')))
      return data.details?.reason ?? data.code ?? message
    } catch {
      return message
    }
  }
  return 'resolved'
}

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyId = await ctx.db.insert('companies', { name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now })
    const other = await ctx.db.insert('companies', { name: 'River Farm', code: 'RIVER', status: 'approved', createdAt: now })
    const site = await ctx.db.insert('farmLocations', { companyId, name: 'Site A', active: true, updatedAt: now })
    const otherSite = await ctx.db.insert('farmLocations', { companyId: other, name: 'River', active: true, updatedAt: now })
    const member = async (email: string, roleKey: string, company = companyId) => {
      const userId = await ctx.db.insert('users', {
        email,
        name: email,
        role: roleKey === 'owner' ? 'admin' : 'user',
        companyId: company,
      })
      await ctx.db.insert('memberships', {
        userId, companyId: company, roleKey, allLocations: true, status: 'active', updatedAt: now,
      })
      return userId
    }
    const owner = await member('owner@a.com', 'owner')
    const viewer = await member('viewer@a.com', 'viewer')
    const field = await member('field@a.com', 'field_staff')
    const riverOwner = await member('owner@b.com', 'owner', other)
    const platform = await ctx.db.insert('users', { email: 'root@p.com', role: 'super_admin' })
    // Super_admins always verify a second factor (audit B).
    const platformSession = await ctx.db.insert('authSessions', { userId: platform, expirationTime: Date.now() + 86_400_000 })
    await ctx.db.insert('mfaSessions', { userId: platform, sessionId: platformSession, purpose: 'verify', attempts: 0, verifiedAt: Date.now(), method: 'totp' })
    await ctx.db.insert('cages', { name: 'A1', status: 'active', companyId, locationId: site, updatedAt: now })
    await ctx.db.insert('cages', { name: 'A2', status: 'empty', companyId, locationId: site, updatedAt: now })
    await ctx.db.insert('cages', { name: 'R1', status: 'active', companyId: other, locationId: otherSite, updatedAt: now })
    await ctx.db.insert('userInvites', {
      email: 'new@a.com', role: 'user', companyId, createdAt: now, status: 'pending', tokenHash: 'secret-hash',
    })
    return { companyId, other, site, owner, viewer, field, riverOwner, platform, platformSession }
  })
  const as = (userId: string) =>
    t.withIdentity({ subject: `${userId}|${userId === ids.platform ? ids.platformSession : 's'}` })
  const drain = () => t.finishAllScheduledFunctions(vi.runAllTimers, 2000)
  return { t, as, drain, ...ids }
}

describe('zip writer', () => {
  test('CRC-32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  test('round trip: names, contents and checksums survive', () => {
    const zip = buildZip([
      { name: 'a.json', data: '{"x":1}' },
      { name: 'dir/é.csv', data: 'a,b\r\n1,2\r\n' },
      { name: 'empty.txt', data: '' },
    ])
    const files = readZip(zip)
    expect(files.map((f) => f.name)).toEqual(['a.json', 'dir/é.csv', 'empty.txt'])
    expect(files.every((f) => f.crcOk)).toBe(true)
    expect(new TextDecoder().decode(files[1].data)).toBe('a,b\r\n1,2\r\n')
  })

  test('CSV quotes commas, quotes and newlines; objects as JSON', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"' }, { a: 1, c: { k: 2 } }])).toBe(
      'a,b,c\r\n"x,y","say ""hi""",\r\n1,,"{""k"":2}"\r\n',
    )
  })

  test('CSV neutralises spreadsheet formulas but keeps numbers', () => {
    expect(toCsv([{ note: '=1+1', at: '@SUM(A1)', qty: -5, amount: '-12.50', cmd: '-2+3' }])).toBe(
      "note,at,qty,amount,cmd\r\n'=1+1,'@SUM(A1),-5,-12.50,'-2+3\r\n",
    )
  })
})

describe('tenant table list matches the schema', () => {
  test('every index named starts with companyId, and every company-indexed table is covered', () => {
    const tables = (schema as any).tables as Record<string, any>
    const companyIndexed = new Set<string>()
    for (const [name, def] of Object.entries(tables)) {
      const indexes = def[' indexes']() as Array<{ indexDescriptor: string; fields: string[] }>
      if (indexes.some((i) => i.fields[0] === 'companyId')) companyIndexed.add(name)
    }
    for (const spec of TENANT_TABLES) {
      const indexes = tables[spec.table][' indexes']() as Array<{ indexDescriptor: string; fields: string[] }>
      const index = indexes.find((i) => i.indexDescriptor === spec.index)
      expect({ table: spec.table, first: index?.fields[0] }).toEqual({ table: spec.table, first: 'companyId' })
    }
    const covered = new Set([...TENANT_TABLES.map((s) => s.table as string), ...Object.keys(SKIPPED_TABLES)])
    expect([...companyIndexed].filter((n) => !covered.has(n))).toEqual([])
    // Secrets never go into an export.
    const exported = TENANT_TABLES.filter((s) => s.export !== false).map((s) => s.table as string)
    for (const secret of ['integrationSecrets', 'phoneLoginCodes', 'mfaSessions', 'fileDownloadTokens', 'authAccounts']) {
      expect(exported).not.toContain(secret)
    }
  })
})

describe('tamper-evident audit log (TRACE-007)', () => {
  test('canonical JSON ignores key order and undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [1, 'x'] } })).toBe('{"a":{"c":[1,"x"]},"b":1}')
  })

  test('chain verifies; an edited, a removed middle and a removed last entry are each reported', async () => {
    const { t, as, drain, owner, companyId, viewer } = await setup()
    const ids = await t.run(async (ctx) => {
      const out = []
      for (let i = 1; i <= 4; i += 1) {
        out.push(
          await insertAuditLog(ctx, {
            userId: owner, companyId, actionType: 'update', tableName: 'cages', recordId: `c${i}`,
            newValues: { count: i, nested: { note: `n${i}` } },
          }),
        )
      }
      // A legacy row written before the chain.
      await ctx.db.insert('auditLogs', { companyId, actionType: 'old', tableName: 'cages' })
      return out
    })
    const rows = await t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))))
    expect(rows.map((r) => r!.seq)).toEqual([1, 2, 3, 4])
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash)

    expect(await codeOf(as(viewer).mutation(api.audit.verifyChain, {}))).toBe('FORBIDDEN')
    await as(owner).mutation(api.audit.verifyChain, {})
    await drain()
    let status = await as(owner).query(api.audit.chainStatus, {})
    expect(status).toMatchObject({ chainLength: 4, unchainedCount: 1, latest: { status: 'ok', checkedCount: 4 } })

    // Edit a row's values.
    await t.run((ctx) => ctx.db.patch(ids[1], { newValues: { count: 999, nested: { note: 'n2' } } }))
    await as(owner).mutation(api.audit.verifyChain, {})
    await drain()
    status = await as(owner).query(api.audit.chainStatus, {})
    expect(status?.latest).toMatchObject({ status: 'broken', brokenAtSeq: 2, checkedCount: 1 })
    expect(status?.latest?.reason).toMatch(/edited/)

    // Restore it, then delete the last entry.
    await t.run((ctx) => ctx.db.patch(ids[1], { newValues: { count: 2, nested: { note: 'n2' } } }))
    await t.run((ctx) => ctx.db.delete(ids[3]))
    await as(owner).mutation(api.audit.verifyChain, {})
    await drain()
    status = await as(owner).query(api.audit.chainStatus, {})
    expect(status?.latest).toMatchObject({ status: 'broken', brokenAtSeq: 4 })
    expect(status?.latest?.reason).toMatch(/removed/)

    // Delete a middle entry.
    await t.run((ctx) => ctx.db.delete(ids[1]))
    await as(owner).mutation(api.audit.verifyChain, {})
    await drain()
    status = await as(owner).query(api.audit.chainStatus, {})
    expect(status?.latest).toMatchObject({ status: 'broken', brokenAtSeq: 2 })
    expect(status?.latest?.reason).toMatch(/missing/)
  })

  test('audit rows written by ordinary mutations are chained per company', async () => {
    const { t, as, owner, riverOwner, companyId, other } = await setup()
    await as(owner).mutation(api.cages.create, { name: 'New A' })
    await as(riverOwner).mutation(api.cages.create, { name: 'New R' })
    await as(owner).mutation(api.cages.create, { name: 'New A2' })
    const heads = await t.run(async (ctx) => ({
      a: await ctx.db.query('auditChainHeads').withIndex('by_companyId', (q) => q.eq('companyId', companyId)).unique(),
      b: await ctx.db.query('auditChainHeads').withIndex('by_companyId', (q) => q.eq('companyId', other)).unique(),
    }))
    expect(heads.a?.seq).toBeGreaterThanOrEqual(2)
    expect(heads.b?.seq).toBeGreaterThanOrEqual(1)
    await t.mutation(internal.audit.verifyAll, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await as(owner).query(api.audit.chainStatus, {}))?.latest?.status).toBe('ok')
    expect((await as(riverOwner).query(api.audit.chainStatus, {}))?.latest?.status).toBe('ok')
  })
})

describe('organization data export', () => {
  test('admin-only; zip has this organization only, without secrets; download is audited', async () => {
    const { t, as, drain, owner, viewer, field } = await setup()
    expect(await codeOf(as(viewer).mutation(api.governance.requestExport, {}))).toBe('FORBIDDEN')
    expect(await codeOf(as(field).query(api.governance.listExports, {}))).toBe('FORBIDDEN')
    const exportId = await as(owner).mutation(api.governance.requestExport, {})
    expect(await codeOf(as(owner).mutation(api.governance.requestExport, {}))).toBe('CONFLICT')
    await drain()
    const [row] = await as(owner).query(api.governance.listExports, {})
    expect(row).toMatchObject({ status: 'ready', tableCounts: { cages: 2, userInvites: 1 } })
    const job = await t.run((ctx) => ctx.db.get(exportId))
    const bytes = await t.run(async (ctx) => (await ctx.storage.get(job!.storageId!))!.arrayBuffer())
    const files = readZip(new Uint8Array(bytes))
    const byName = Object.fromEntries(files.map((f) => [f.name, new TextDecoder().decode(f.data)]))
    expect(Object.keys(byName)).toEqual(expect.arrayContaining(['manifest.json', 'json/cages.json', 'csv/cages.csv']))
    expect(JSON.parse(byName['json/cages.json']).map((c: any) => c.name).sort()).toEqual(['A1', 'A2'])
    expect(byName['json/userInvites.json']).not.toContain('secret-hash')
    expect(byName['csv/cages.csv'].split('\r\n')[0]).toContain('name')
    expect(files.every((f) => f.crcOk)).toBe(true)

    const url = await as(owner).mutation(api.governance.exportDownloadUrl, { exportId })
    expect(typeof url).toBe('string')
    const audits = await t.run((ctx) => ctx.db.query('auditLogs').collect())
    expect(audits.map((a) => a.actionType)).toEqual(
      expect.arrayContaining(['data_export_requested', 'data_export_downloaded']),
    )

    // Expired exports are deleted by the retention job.
    await t.run((ctx) => ctx.db.patch(exportId, { expiresAt: Date.now() - 1 }))
    expect(await codeOf(as(owner).mutation(api.governance.exportDownloadUrl, { exportId }))).toBe('CONFLICT')
    expect(await t.mutation(internal.governance.pruneExports, {})).toBe(1)
    expect((await t.run((ctx) => ctx.db.get(exportId)))?.status).toBe('expired')
  })
})

describe('deletion requests and retention (ENT-005)', () => {
  test('organization deletion: request, approve, block, grace, purge, keep audit, then purge audit', async () => {
    const { t, as, drain, owner, viewer, field, platform, companyId, other } = await setup()
    expect(await codeOf(as(viewer).mutation(api.governance.requestOrgDeletion, {}))).toBe('FORBIDDEN')
    const requestId = await as(owner).mutation(api.governance.requestOrgDeletion, { reason: 'closing' })
    expect(await codeOf(as(owner).mutation(api.governance.requestOrgDeletion, {}))).toBe('CONFLICT')
    expect(await codeOf(as(field).mutation(api.governance.cancelRequest, { requestId }))).toBe('FORBIDDEN')
    expect(await codeOf(as(owner).mutation(api.governance.decideRequest, { requestId, approve: true }))).toBe('FORBIDDEN')

    const open = await as(platform).query(api.governance.platformListRequests, {})
    expect(open).toMatchObject([{ kind: 'org_deletion', status: 'requested', companyName: 'Lake Farm' }])

    await as(platform).mutation(api.governance.decideRequest, { requestId, approve: true })
    expect(await codeOf(as(owner).query(api.cages.list, {}))).toBe('COMPANY_NOT_APPROVED')

    // Dry run (the default) counts and changes nothing.
    const dry = await t.mutation(internal.governance.purgeCompanyBatch, { companyId })
    expect(dry).toMatchObject({ dryRun: true, counts: { cages: 2 } })
    expect(await t.run((ctx) => ctx.db.query('cages').collect())).toHaveLength(3)

    // Within the grace period nothing happens.
    await t.mutation(internal.governance.processDueRequests, {})
    await drain()
    expect(await t.run((ctx) => ctx.db.query('cages').collect())).toHaveLength(3)

    // A photo with its thumbnail (CF-004): the purge deletes both blobs.
    const photo = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(['photo']))
      const thumbStorageId = await ctx.storage.store(new Blob(['thumb']))
      await ctx.db.insert('files', {
        companyId, entityType: 'healthTreatments', entityId: 'h', provider: 'convex', storageId, thumbStorageId,
        name: 'p.jpg', mime: 'image/jpeg', size: 5, uploadedBy: owner, createdAt: Date.now(),
      })
      return { storageId, thumbStorageId }
    })
    await t.run((ctx) => ctx.db.patch(requestId, { graceEndsAt: Date.now() - 1 }))
    await t.mutation(internal.governance.processDueRequests, {})
    await drain()
    expect(await t.run((ctx) => ctx.db.system.get(photo.storageId))).toBeNull()
    expect(await t.run((ctx) => ctx.db.system.get(photo.thumbStorageId))).toBeNull()
    const after = await t.run(async (ctx) => ({
      cages: await ctx.db.query('cages').collect(),
      request: await ctx.db.get(requestId),
      company: await ctx.db.get(companyId),
      owner: await ctx.db.get(owner),
      memberships: await ctx.db.query('memberships').withIndex('by_companyId', (q) => q.eq('companyId', companyId)).collect(),
      audit: await ctx.db.query('auditLogs').withIndex('by_company', (q) => q.eq('companyId', companyId)).collect(),
      otherCages: await ctx.db.query('cages').withIndex('by_company', (q) => q.eq('companyId', other)).collect(),
    }))
    expect(after.cages.map((c) => c.name)).toEqual(['R1'])
    expect(after.otherCages).toHaveLength(1)
    expect(after.request).toMatchObject({ status: 'completed', purgedCounts: { cages: 2, memberships: 3, users: 3 } })
    expect(after.company).toMatchObject({ name: 'Deleted organization', status: 'rejected' })
    expect(after.owner?.companyId).toBeUndefined()
    expect(after.owner?.email).toBe('owner@a.com')
    expect(after.memberships).toEqual([])
    expect(after.audit.map((a) => a.actionType)).toEqual(expect.arrayContaining(['org_deletion_requested', 'org_deleted']))

    // Audit rows stay until the retention period ends.
    await t.mutation(internal.governance.processDueRequests, {})
    await drain()
    expect((await t.run((ctx) => ctx.db.query('auditLogs').withIndex('by_company', (q) => q.eq('companyId', companyId)).collect())).length).toBeGreaterThan(0)
    await t.run((ctx) => ctx.db.patch(requestId, { auditRetainUntil: Date.now() - 1 }))
    await t.mutation(internal.governance.processDueRequests, {})
    await drain()
    expect(await t.run((ctx) => ctx.db.query('auditLogs').withIndex('by_company', (q) => q.eq('companyId', companyId)).collect())).toEqual([])
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.auditPurgedAt).toBeTypeOf('number')
  })

  test('platform can cancel an approved organization deletion in the grace period; access returns', async () => {
    const { as, owner, platform } = await setup()
    const requestId = await as(owner).mutation(api.governance.requestOrgDeletion, {})
    await as(platform).mutation(api.governance.decideRequest, { requestId, approve: true })
    expect(await codeOf(as(owner).query(api.cages.list, {}))).toBe('COMPANY_NOT_APPROVED')
    await as(platform).mutation(api.governance.platformCancelRequest, { requestId })
    expect((await as(owner).query(api.cages.list, {})).length).toBe(2)
  })

  test('account deletion: own request, cancel, re-request, approval, anonymized after grace', async () => {
    const { t, as, drain, field, platform } = await setup()
    const first = await as(field).mutation(api.governance.requestAccountDeletion, { reason: 'leaving' })
    await as(field).mutation(api.governance.cancelRequest, { requestId: first })
    const requestId = await as(field).mutation(api.governance.requestAccountDeletion, {})
    const mine = await as(field).query(api.governance.myRequests, {})
    expect(mine.map((r: any) => r.status)).toEqual(['requested', 'cancelled'])
    await as(platform).mutation(api.governance.decideRequest, { requestId, approve: true })
    // Still usable in the grace period, and the owner can change their mind.
    expect((await as(field).query(api.governance.myRequests, {}))[0]).toMatchObject({ status: 'approved' })
    await t.run((ctx) => ctx.db.patch(requestId, { graceEndsAt: Date.now() - 1 }))
    await t.mutation(internal.governance.processDueRequests, {})
    await drain()
    const user = await t.run((ctx) => ctx.db.get(field))
    expect(user).toMatchObject({ name: 'Deleted user', active: false })
    expect(user?.email).toBeUndefined()
    expect(user?.companyId).toBeUndefined()
    const memberships = await t.run((ctx) => ctx.db.query('memberships').withIndex('by_userId', (q) => q.eq('userId', field)).collect())
    expect(memberships.map((m) => m.status)).toEqual(['removed'])
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe('completed')
  })
})
