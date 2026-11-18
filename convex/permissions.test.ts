/// <reference types="vite/client" />
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { authErrorCode } from './lib/authErrors'
import { ADMIN_ONLY, PERMISSIONS, ROLE_TEMPLATES } from './lib/permissions'

const modules = import.meta.glob('./**/*.ts')

// ─── Static: every public function names its guard (PERM-002) ───────────────

const ROOT = __dirname

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === '_generated' || name === 'node_modules') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts') ? [path] : []
  })
}

/** Local helpers that call requireMember with a fixed permission. */
const HELPER_PERMISSIONS: Record<string, string> = {
  'requireCompanyAdmin(ctx)': 'org.members.manage',
  'changeStatus(ctx': 'org.members.manage',
  'requireMessagingAdmin(ctx)': 'integrations.manage',
  'recordOutboundUsage(ctx': 'inventory.issue',
  'requireApiAdmin(ctx)': 'integrations.manage',
  'requireAdmin(ctx)': 'automation.manage',
  'requireWebhookAdmin(ctx)': 'integrations.manage',
}

/** Functions without an organization guard, and why. */
const ALLOWLIST: Record<string, string> = {
  'users.current': 'the signed-in account itself; must answer even when access is refused',
  'memberships.inviteInfo': 'public by design: the 64-hex invite token is the credential',
  'userAccounts.changePassword': 'own password; replaces a temporary password before requireUser passes',
  'mfa.startChallenge': 'own two-step code; guarded by requireUser({ allowPendingMfa }) in internal.mfa',
  'mfa.startEnrolment': 'own two-step enrolment; guarded in internal.mfa',
  'mfa.verifyChallenge': 'own two-step code; guarded in internal.mfa',
  'messaging/channels.saveCredentials': 'action; guarded by requireMessagingAdmin in internal.messaging.channels.channelForAdmin',
  'webhooks.create': 'action; guarded by requireWebhookAdmin in internal.webhooks.createEndpointRow',
  'webhooks.rotateSecret': 'action; guarded by requireWebhookAdmin in internal.webhooks.endpointOwner',
  'weather.refreshSite': 'action; guarded by requireMember(org.sites.manage) in internal.weather.siteForRefresh',
  'apiKeys.create': 'action; guarded by requireApiAdmin in internal.apiKeys.insertKey',
  'customFields.setValues': 'guarded by requireEntityEditor: the permission that edits that entity (ENTITY_EDIT_PERMISSION in customFields.ts) plus site scope',
  'messaging/channels.sendTest': 'action; guarded by requireMessagingAdmin in internal.messaging.channels.prepareTest',
}

type Guard = string // a permission, 'account', 'platform' or 'allowlisted'

function publicFunctions(): Array<{ name: string; kind: string; guard: Guard | null }> {
  const out = []
  for (const file of sourceFiles(ROOT)) {
    const src = readFileSync(file, 'utf8')
    const mod = relative(ROOT, file).replace(/\.ts$/, '')
    const heads = [...src.matchAll(/^export const (\w+) = (query|mutation|action|idempotentMutation)\(/gm)]
    const allHeads = [...src.matchAll(/^export const \w+ = /gm)].map((m) => m.index!)
    for (const h of heads) {
      const end = allHeads.find((i) => i > h.index!) ?? src.length
      const body = src.slice(h.index!, end)
      const name = `${mod}.${h[1]}`
      let guard: Guard | null = null
      const member = /requireMember\(ctx, \{ permission: '([\w.]+)'/.exec(body)
      const action = /authorizedMember, \{\s*permission: '([\w.]+)'/.exec(body)
      const hatchery = /requireHatchery\(ctx, '([\w.]+)'\)/.exec(body)
      if (member) guard = member[1]
      else if (action) guard = action[1]
      else if (hatchery) guard = hatchery[1]
      else if (body.includes('requirePlatformAdmin(ctx)')) guard = 'platform'
      else if (body.includes('requireAccount(ctx')) guard = 'account'
      else {
        for (const [helper, perm] of Object.entries(HELPER_PERMISSIONS)) {
          if (body.includes(helper)) guard = perm
        }
      }
      if (!guard && ALLOWLIST[name]) guard = 'allowlisted'
      out.push({ name, kind: h[2] === 'idempotentMutation' ? 'mutation' : h[2], guard })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const ROLES = Object.keys(ROLE_TEMPLATES) as Array<keyof typeof ROLE_TEMPLATES>

describe('permission matrix (generated from the source)', () => {
  const fns = publicFunctions()

  test('every public function goes through requireMember, requirePlatformAdmin or requireAccount', () => {
    expect(fns.length).toBeGreaterThan(200)
    expect(fns.filter((f) => !f.guard).map((f) => f.name)).toEqual([])
  })

  test('every named permission is in the catalog, and every admin-only permission is used', () => {
    const named = new Set(fns.map((f) => f.guard).filter((g) => g && g.includes('.')))
    for (const p of named) expect(PERMISSIONS).toContain(p)
    // Permissions checked inside a function (conditional edits, overrides) count too.
    for (const file of sourceFiles(ROOT)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/assertUserCan\(ctx, [\w.]+, '([\w.]+)'\)/g)) {
        named.add(m[1])
      }
    }
    // Catalogued ahead of the functions that will use them (later hatchery phases).
    const reserved = new Set(['hatchery.grade', 'hatchery.dispatch'])
    for (const p of ADMIN_ONLY) {
      expect({ p, used: named.has(p) || reserved.has(p) }).toEqual({ p, used: true })
    }
  })

  test('templates: viewer writes nothing, field staff and managers never hold admin-only permissions', () => {
    const viewer = new Set<string>(ROLE_TEMPLATES.viewer)
    // Not farm data: remember my site; make sure a first site exists; issue a
    // short-lived download link for a file the viewer may already read.
    const preferences = new Set([
      'farmLocations.setActiveLocation',
      'farmLocations.ensureDefault',
      'files.requestDownload',
      // own dashboard arrangement; the org default additionally needs customization.manage
      'dashboardLayouts.save',
      'dashboardLayouts.reset',
    ])
    for (const f of fns) {
      if (f.kind === 'query' || !f.guard || !f.guard.includes('.') || preferences.has(f.name)) continue
      expect({ fn: f.name, viewer: viewer.has(f.guard) }).toEqual({ fn: f.name, viewer: false })
    }
    for (const p of ADMIN_ONLY) {
      expect(ROLE_TEMPLATES.manager as readonly string[]).not.toContain(p)
      expect(ROLE_TEMPLATES.field_staff as readonly string[]).not.toContain(p)
    }
    expect([...ROLE_TEMPLATES.admin].sort()).toEqual([...PERMISSIONS].sort())
    expect([...ROLE_TEMPLATES.manager].sort()).toEqual(PERMISSIONS.filter((p) => !ADMIN_ONLY.includes(p)).sort())
  })

  test('allow/deny per function and role template', () => {
    const matrix: Record<string, string> = {}
    for (const f of fns) {
      const g = f.guard!
      const cells = ROLES.map((r) => {
        if (g === 'platform') return '-'
        if (g === 'account' || g === 'allowlisted') return 'self'
        return (ROLE_TEMPLATES[r] as readonly string[]).includes(g) ? 'Y' : '-'
      })
      matrix[f.name] = `${g.padEnd(28)} ${ROLES.map((r, i) => `${r}=${cells[i]}`).join(' ')}`
    }
    // Reviewed copy: docs/architecture/20-permission-matrix.md, rewritten with
    //   WRITE_PERMISSION_MATRIX=1 npx vitest run convex/permissions.test.ts
    if (process.env.WRITE_PERMISSION_MATRIX) {
      const word = (c: string) => (c === 'Y' ? 'yes' : c === '-' ? 'no' : c)
      const rows = fns.map((f) => {
        const g = f.guard!
        const cells = ROLES.map((r) =>
          g === 'platform' ? 'no' : g === 'account' ? 'self' : g === 'allowlisted' ? 'see test'
            : word((ROLE_TEMPLATES[r] as readonly string[]).includes(g) ? 'Y' : '-'),
        )
        return `| \`${f.name}\` | \`${g}\` | ${cells.join(' | ')} |`
      })
      writeFileSync(
        join(ROOT, '..', 'docs', 'architecture', '20-permission-matrix.md'),
        [
          '# Permission matrix',
          '',
          'Generated from the source by `convex/permissions.test.ts`: every public function and the permission its guard names. ' +
            '`self` = self-service (`requireAccount`: the caller\'s own account, notifications, invites, tasks); `platform` = `requirePlatformAdmin` (super_admin only); ' +
            '`see test` = guarded inside an internal function or public by design; the allow-list in the test says which. Templates are in `convex/lib/permissionCatalog.ts`; custom roles pick any subset of the catalog.',
          '',
          'Regenerate: `WRITE_PERMISSION_MATRIX=1 npx vitest run convex/permissions.test.ts`. The test fails on any public function without a guard; it does not compare against this file.',
          '',
          '| Function | Permission | Owner | Admin | Manager | Field staff | Viewer |',
          '|---|---|---|---|---|---|---|',
          ...rows,
          '',
        ].join('\n'),
      )
    }
    expect(Object.keys(matrix)).toHaveLength(fns.length)
    for (const row of Object.values(matrix)) expect(row).toMatch(/viewer=(Y|-|self)$/)
  })
})

// ─── Behaviour ───────────────────────────────────────────────────────────────

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
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now,
    })
    const other = await ctx.db.insert('companies', {
      name: 'River Farm', code: 'RIVER', status: 'approved', createdAt: now,
    })
    const siteA = await ctx.db.insert('farmLocations', { companyId, name: 'Site A', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId, name: 'Site B', active: true, updatedAt: now })
    const otherSite = await ctx.db.insert('farmLocations', { companyId: other, name: 'River', active: true, updatedAt: now })
    const member = async (email: string, roleKey: string, extra: Record<string, unknown> = {}) => {
      const legacy = roleKey === 'owner' || roleKey === 'admin' ? 'admin' : 'user'
      const userId = await ctx.db.insert('users', {
        email, role: legacy, companyId, activeLocationId: siteA, ...(extra.user as object ?? {}),
      } as any)
      await ctx.db.insert('memberships', {
        userId, companyId, roleKey, allLocations: true, status: 'active', updatedAt: now,
        ...(extra.membership as object ?? {}),
      } as any)
      return userId
    }
    const owner = await member('owner@a.com', 'owner')
    const admin2 = await member('admin2@a.com', 'admin')
    const manager = await member('manager@a.com', 'manager')
    const viewer = await member('viewer@a.com', 'viewer')
    const field = await member('field@a.com', 'field_staff', {
      user: { locationIds: [siteA] },
      membership: { allLocations: false, locationIds: [siteA] },
    })
    const cageA = await ctx.db.insert('cages', { name: 'A1', status: 'active', companyId, locationId: siteA, updatedAt: now })
    const cageB = await ctx.db.insert('cages', { name: 'B1', status: 'active', companyId, locationId: siteB, updatedAt: now })
    return { companyId, other, siteA, siteB, otherSite, owner, admin2, manager, viewer, field, cageA, cageB }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|s` })
  return { t, as, ...ids }
}

const daily = (cageId: any) => ({
  cageId, date: '2026-01-05', feedAmount: 0, feedPrice: 0, feedCost: 0, mortality: 0,
})

describe('requireMember in practice', () => {
  test('a viewer can read but not write', async () => {
    const { as, viewer, cageA } = await setup()
    expect((await as(viewer).query(api.cages.list, {})).length).toBe(2)
    expect(await codeOf(as(viewer).mutation(api.cages.create, { name: 'X' }))).toBe('FORBIDDEN')
    expect(await codeOf(as(viewer).mutation(api.dailyRecords.create, daily(cageA)))).toBe('FORBIDDEN')
    expect(await codeOf(as(viewer).mutation(api.farmLocations.create, { name: 'New' }))).toBe('FORBIDDEN')
    expect(await codeOf(as(viewer).query(api.audit.list, {}))).toBe('FORBIDDEN')
  })

  test('SEC-004: aiAssistantStatus.canUse follows ai.use (viewer refused by the LLM proxy)', async () => {
    const { t, as, viewer, manager, companyId } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.patch(companyId, { settings: { aiAssistantEnabled: true } } as any)
    })
    expect(await as(viewer).query(api.companies.aiAssistantStatus, {})).toMatchObject({ enabled: true, canUse: false })
    expect(await as(manager).query(api.companies.aiAssistantStatus, {})).toMatchObject({ enabled: true, canUse: true })
    expect(await codeOf(as(viewer).query(api.assistant.context, { asOf: '2026-01-05' }))).toBe('FORBIDDEN')
  })

  test('a field_staff user scoped to site A cannot read or write site B', async () => {
    const { as, field, cageA, cageB, siteB } = await setup()
    const cages = await as(field).query(api.cages.list, {})
    expect(cages.map((c: any) => c.name)).toEqual(['A1'])
    expect(await as(field).query(api.cages.get, { id: cageB })).toBeNull()
    const sites = await as(field).query(api.farmLocations.list, {})
    expect(sites.map((s: any) => s.name)).toEqual(['Site A'])
    await expect(as(field).mutation(api.dailyRecords.create, daily(cageA))).resolves.toBeTruthy()
    expect(await codeOf(as(field).mutation(api.dailyRecords.create, daily(cageB)))).toMatch(/not found/)
    expect(await codeOf(as(field).mutation(api.farmLocations.setActiveLocation, { locationId: siteB }))).toMatch(/denied/)
    // Field staff do not create units or see finance.
    expect(await codeOf(as(field).mutation(api.cages.create, { name: 'X' }))).toBe('FORBIDDEN')
    expect(await codeOf(as(field).query(api.sales.listSales, {}))).toBe('FORBIDDEN')
  })

  test('a manager keeps today\'s user access: records yes, admin-only actions no', async () => {
    const { as, manager, cageA, cageB } = await setup()
    await expect(as(manager).mutation(api.dailyRecords.create, daily(cageB))).resolves.toBeTruthy()
    await expect(as(manager).mutation(api.cages.update, { id: cageA, patch: { name: 'A1 north' } })).resolves.toBeTruthy()
    expect(await codeOf(as(manager).mutation(api.cages.update, { id: cageA, patch: { status: 'fallow' } }))).toBe('FORBIDDEN')
    expect(await codeOf(as(manager).mutation(api.cages.remove, { id: cageA }))).toBe('FORBIDDEN')
    expect(await codeOf(as(manager).query(api.memberships.listMembers, {}))).toBe('FORBIDDEN')
  })

  test('myPermissions reflects the template and the site scope', async () => {
    const { as, field, owner, siteA } = await setup()
    const mine = await as(field).query(api.roles.myPermissions, {})
    expect(mine).toMatchObject({ roleKey: 'field_staff', roleName: 'Field staff', allSites: false, siteIds: [siteA] })
    expect(mine.permissions).toContain('production.daily.record')
    expect(mine.permissions).not.toContain('finance.view')
    const own = await as(owner).query(api.roles.myPermissions, {})
    expect(own.permissions).toEqual([...PERMISSIONS].sort())
  })

  test('custom roles: create, assign, enforce, refuse archive while held', async () => {
    const { as, owner, viewer } = await setup()
    await expect(as(owner).mutation(api.roles.create, { name: 'Feeder', permissions: ['nope'] })).rejects.toThrow(/Unknown permissions/)
    expect(await codeOf(as(viewer).mutation(api.roles.create, { name: 'X', permissions: [] }))).toBe('FORBIDDEN')
    const roleId = await as(owner).mutation(api.roles.create, {
      name: 'Feeder',
      basedOn: 'field_staff',
      permissions: ['org.view', 'production.view', 'production.daily.record', 'production.units.manage'],
    })
    await as(owner).mutation(api.memberships.setRole, { userId: viewer, roleId })
    const mine = await as(viewer).query(api.roles.myPermissions, {})
    expect(mine).toMatchObject({ roleName: 'Feeder' })
    await expect(as(viewer).mutation(api.cages.create, { name: 'Custom cage' })).resolves.toBeTruthy()
    expect(await codeOf(as(viewer).query(api.sales.listSales, {}))).toBe('FORBIDDEN')
    expect(await codeOf(as(owner).mutation(api.roles.archive, { roleId }))).toBe('CONFLICT')
    await as(owner).mutation(api.memberships.setRole, { userId: viewer, roleKey: 'viewer' })
    await as(owner).mutation(api.roles.archive, { roleId })
    const list = await as(owner).query(api.roles.list, {})
    expect(list.custom).toEqual([])
    expect(list.templates.map((r: any) => r.key)).toEqual(['owner', 'admin', 'manager', 'field_staff', 'viewer'])
  })

  test('site assignment: validated, mirrored, and enforced', async () => {
    const { t, as, owner, manager, siteA, siteB, otherSite } = await setup()
    expect(await codeOf(as(owner).mutation(api.memberships.setSites, { userId: manager, allLocations: false, locationIds: [otherSite] }))).toBe('NOT_FOUND')
    expect(await codeOf(as(owner).mutation(api.memberships.setSites, { userId: manager, allLocations: false, locationIds: [] }))).toBe('VALIDATION')
    await as(owner).mutation(api.memberships.setSites, { userId: manager, allLocations: false, locationIds: [siteB] })
    expect(await t.run((ctx) => ctx.db.get(manager))).toMatchObject({ locationIds: [siteB], activeLocationId: siteB })
    expect((await as(manager).query(api.cages.list, {})).map((c: any) => c.name)).toEqual(['B1'])
    await as(owner).mutation(api.memberships.setSites, { userId: manager, allLocations: true })
    expect((await t.run((ctx) => ctx.db.get(manager)))?.locationIds).toBeUndefined()
    expect((await as(manager).query(api.cages.list, {})).length).toBe(2)
    void siteA
  })

  test('segregation of duties: when required, the requester cannot approve', async () => {
    const { t, as, owner, admin2, companyId, cageA, siteA } = await setup()
    const stockingId = await t.run(async (ctx) => {
      await ctx.db.patch(companyId, {
        settings: {
          aiAssistantEnabled: false,
          stockingRules: {
            requireApprovalForStocking: true,
            requireApprovalForTopup: true,
            enforceCageCapacity: false,
            requireDifferentApprover: true,
          },
        },
      })
      await ctx.db.patch(cageA, { status: 'empty' })
      return ctx.db.insert('stockingHistory', {
        cageId: cageA, batchNumber: 'B-1', stockingDate: '2026-01-01', fishCount: 100,
        initialAbw: 10, initialBiomass: 1, status: 'pending_approval', companyId, locationId: siteA,
        createdBy: owner,
      } as any)
    })
    expect(await codeOf(as(owner).mutation(api.stocking.approveStocking, { id: stockingId }))).toBe('SAME_APPROVER')
    expect(await codeOf(as(admin2).mutation(api.stocking.approveStocking, { id: stockingId }))).not.toBe('SAME_APPROVER')
  })
})
