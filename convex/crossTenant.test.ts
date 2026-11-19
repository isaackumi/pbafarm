/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { applyStockChange } from './lib/feedLedger'
import * as farmLocations from './farmLocations'
import * as seed from './seed'
import * as notifications from './notifications'

const modules = import.meta.glob('./**/*.ts')

/**
 * SEC-002 (roadmap §0.3, doc 07 V1, V4, V6, V7, V9, V11, V14, V15).
 * Two approved companies A and B. Every fixed path gets one negative test:
 * company A passes company B's id and is refused, or a non-admin is refused
 * on a gated write.
 */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', {
      name: 'Lake Farm', code: 'LAKE', status: 'approved', createdAt: now,
    })
    const companyB = await ctx.db.insert('companies', {
      name: 'River Farm', code: 'RIVER', status: 'approved', createdAt: now,
    })
    const siteA = await ctx.db.insert('farmLocations', {
      companyId: companyA, name: 'Main A', active: true, updatedAt: now,
    })
    const siteA2 = await ctx.db.insert('farmLocations', {
      companyId: companyA, name: 'North A', active: true, updatedAt: now,
    })
    const siteB = await ctx.db.insert('farmLocations', {
      companyId: companyB, name: 'Main B', active: true, updatedAt: now,
    })
    const orphanSite = await ctx.db.insert('farmLocations', {
      name: 'No company', active: true, updatedAt: now,
    })
    const user = (email: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert('users', { email, role: 'user', ...extra } as any)
    const adminA = await user('admin@a.com', { role: 'admin', companyId: companyA, activeLocationId: siteA })
    const staffA = await user('staff@a.com', { companyId: companyA, activeLocationId: siteA })
    const adminB = await user('admin@b.com', { role: 'admin', companyId: companyB, activeLocationId: siteB })

    const supplierA = await ctx.db.insert('feedSuppliers', { name: 'Sup A', companyId: companyA, updatedAt: now })
    const supplierB = await ctx.db.insert('feedSuppliers', { name: 'Sup B', companyId: companyB, updatedAt: now })
    const feedType = (name: string, companyId: any) =>
      ctx.db.insert('feedTypes', {
        name, currentStock: 1000, minimumStock: 0, pricePerKg: 2, bagSizeKg: 25,
        active: true, companyId, updatedAt: now,
      })
    const feedA = await feedType('Feed A', companyA)
    const feedB = await feedType('Feed B', companyB)

    const cageA = await ctx.db.insert('cages', {
      name: 'A1', status: 'active', currentCount: 1000, initialCount: 1000,
      companyId: companyA, locationId: siteA, updatedAt: now,
    })
    const cageB = await ctx.db.insert('cages', {
      name: 'B1', status: 'active', currentCount: 1000, initialCount: 1000,
      companyId: companyB, locationId: siteB, updatedAt: now,
    })
    const harvestA = await ctx.db.insert('harvestRecords', {
      cageId: cageA, harvestDate: '2026-11-01', averageBodyWeight: 400, totalWeight: 40,
      estimatedCount: 100, fcr: 1.4, harvestType: 'partial',
      cageEffect: { fishRemoved: 100 },
      companyId: companyA, locationId: siteA,
    } as any)
    const customerA = await ctx.db.insert('customers', { name: 'Cust A', active: true, companyId: companyA, updatedAt: now })
    const customerB = await ctx.db.insert('customers', { name: 'Cust B', active: true, companyId: companyB, updatedAt: now })
    const saleA = await ctx.db.insert('sales', {
      saleDate: '2026-11-02', weightKg: 40, pricePerKg: 5, totalAmount: 200,
      paymentStatus: 'pending', customerId: customerA, customerName: 'Cust A',
      companyId: companyA, locationId: siteA, updatedAt: now,
    })
    const dailyA = await ctx.db.insert('dailyRecords', {
      cageId: cageA, date: '2026-11-03', feedAmount: 0, feedPrice: 0, feedCost: 0,
      mortality: 0, companyId: companyA, locationId: siteA,
    })
    return {
      companyA, companyB, siteA, siteA2, siteB, orphanSite, adminA, staffA, adminB,
      supplierA, supplierB, feedA, feedB, cageA, cageB, harvestA, customerA, customerB,
      saleA, dailyA,
    }
  })
  const as = (userId: string) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

async function messageOf(p: Promise<unknown>) {
  try {
    await p
  } catch (err) {
    // Permission refusals are ConvexErrors ("Insufficient permissions: <permission>").
    const message = (err as Error).message
    try {
      const data = JSON.parse(message.slice(message.indexOf('{')))
      if (typeof data.message === 'string') return data.message.replace(/: [a-z_.]+$/, '')
    } catch {
      // plain Error
    }
    return message
  }
  return 'resolved'
}

const DENIED = 'Insufficient permissions'

describe('SEC-002 (a) internal-only functions', () => {
  test('backfillLocations, seedDemo and notifications.create/createBulk are not public', () => {
    for (const fn of [
      farmLocations.backfillLocations,
      seed.seedDemo,
      notifications.create,
      notifications.createBulk,
    ] as any[]) {
      expect(fn.isInternal).toBe(true)
      expect(fn.isPublic).toBeUndefined()
    }
  })

  test('seedDemo still runs from the CLI for a named user', async () => {
    const { t } = await setup()
    const companyC = await t.run(async (ctx) => {
      const id = await ctx.db.insert('companies', {
        name: 'New Farm', code: 'NEW', status: 'approved', createdAt: Date.now(),
      })
      await ctx.db.insert('users', { email: 'new@c.com', role: 'admin', companyId: id })
      return id
    })
    const result = await t.mutation(internal.seed.seedDemo, { email: 'new@c.com' })
    expect(result.success).toBe(true)
    const cage = await t.run((ctx) => ctx.db.get(result.cage_ids[0]))
    expect(cage?.companyId).toBe(companyC)
  })

  test('notifications.create still works for server code and inherits the recipient company', async () => {
    const { t, staffA, companyA } = await setup()
    const id = await t.mutation(internal.notifications.create, {
      userId: staffA, title: 'Hi', message: 'Test',
    })
    const n = await t.run((ctx) => ctx.db.get(id))
    expect(n?.companyId).toBe(companyA)
  })
})

describe('SEC-002 (b) V1 feed type ownership in daily records', () => {
  const line = (cageId: any, feedTypeId: any) => ({
    cageId, date: '2026-11-10', feedAmount: 50, feedTypeId, feedPrice: 2, feedCost: 100, mortality: 0,
  })

  test('dailyRecords.create refuses another company feed type and leaves its stock alone', async () => {
    const { t, as, staffA, cageA, feedB } = await setup()
    expect(await messageOf(as(staffA).mutation(api.dailyRecords.create, line(cageA, feedB))))
      .toBe('Feed type not found')
    expect((await t.run((ctx) => ctx.db.get(feedB)))?.currentStock).toBe(1000)
  })

  test('dailyRecords.createBatch refuses another company feed type', async () => {
    const { as, staffA, cageA, feedB } = await setup()
    const msg = await messageOf(as(staffA).mutation(api.dailyRecords.createBatch, {
      date: '2026-11-10',
      records: [{ cageId: cageA, feedAmount: 50, feedTypeId: feedB, mortality: 0 }],
    }))
    expect(msg).toMatch(/feed type not found/)
  })

  test('dailyRecords.update refuses another company feed type', async () => {
    const { as, staffA, dailyA, feedB } = await setup()
    expect(await messageOf(as(staffA).mutation(api.dailyRecords.update, {
      id: dailyA, patch: { feedAmount: 10, feedTypeId: feedB },
    }))).toBe('Feed type not found')
  })

  test('dailyRecords.createMany refuses another company feed type', async () => {
    const { as, adminA, cageA, feedB } = await setup()
    expect(await messageOf(as(adminA).mutation(api.dailyRecords.createMany, {
      records: [line(cageA, feedB)],
    }))).toBe('Feed type not found')
  })

  test('applyStockChange refuses another company feed type whatever the caller checked', async () => {
    const { t, adminA, feedB } = await setup()
    const msg = await messageOf(t.run(async (ctx) => {
      const user = (await ctx.db.get(adminA))!
      await applyStockChange(ctx, {
        user, feedTypeId: feedB, deltaKg: -10, transactionType: 'daily_usage',
      })
    }))
    expect(msg).toBe('Feed type not found')
  })

  test('own feed type still works', async () => {
    const { t, as, staffA, cageA, feedA } = await setup()
    await as(staffA).mutation(api.dailyRecords.create, line(cageA, feedA))
    expect((await t.run((ctx) => ctx.db.get(feedA)))?.currentStock).toBe(950)
  })
})

describe('SEC-002 (b) V14 referenced ids', () => {
  test('createFeedType refuses another company supplier', async () => {
    const { as, staffA, supplierB } = await setup()
    expect(await messageOf(as(staffA).mutation(api.feed.createFeedType, {
      name: 'X', pricePerKg: 1, supplierId: supplierB,
    }))).toBe('Supplier not found')
  })

  test('updateFeedType refuses another company supplier', async () => {
    const { as, staffA, feedA, supplierB } = await setup()
    expect(await messageOf(as(staffA).mutation(api.feed.updateFeedType, {
      id: feedA, patch: { supplierId: supplierB },
    }))).toBe('Supplier not found')
  })

  test('harvest.createSampling refuses another company cage', async () => {
    const { as, staffA, harvestA, cageB } = await setup()
    expect(await messageOf(as(staffA).mutation(api.harvest.createSampling, {
      harvestId: harvestA, cageId: cageB, samples: [],
    }))).toBe('Cage not found')
  })

  test('sales.updateSale refuses another company customer', async () => {
    const { as, staffA, saleA, customerB } = await setup()
    expect(await messageOf(as(staffA).mutation(api.sales.updateSale, {
      id: saleA, patch: { customerId: customerB },
    }))).toBe('Customer not found')
  })

  test('inventory.createTransfer refuses another company from/to location', async () => {
    const { as, adminA, feedA, siteA, siteB } = await setup()
    expect(await messageOf(as(adminA).mutation(api.inventory.createTransfer, {
      feedTypeId: feedA, quantityKg: 10, fromLocationId: siteB, toLocationId: siteA,
    }))).toBe('From location not found')
    expect(await messageOf(as(adminA).mutation(api.inventory.createTransfer, {
      feedTypeId: feedA, quantityKg: 10, fromLocationId: siteA, toLocationId: siteB,
    }))).toBe('To location not found')
  })

  test('writeLocationId refuses another company location and a location with no company', async () => {
    const { as, adminA, cageA, siteB, orphanSite, siteA2 } = await setup()
    expect(await messageOf(as(adminA).mutation(api.cages.update, {
      id: cageA, patch: { locationId: siteB },
    }))).toBe('Location access denied')
    expect(await messageOf(as(adminA).mutation(api.cages.update, {
      id: cageA, patch: { locationId: orphanSite },
    }))).toBe('Location access denied')
    expect(await as(adminA).mutation(api.cages.update, {
      id: cageA, patch: { locationId: siteA2 },
    })).toBe(cageA)
  })
})

describe('SEC-002 (b) V11 / CF-004 logo upload binding', () => {
  const hexSha = async (text: string) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (x) =>
      x.toString(16).padStart(2, '0'),
    ).join('')
  type T = ReturnType<typeof convexTest>
  /** generateLogoUploadUrl as `who`, then store the bytes (as the browser would). */
  async function upload(t: T, who: ReturnType<T['withIdentity']>, text = 'logo') {
    const { uploadId } = await who.mutation(api.companies.generateLogoUploadUrl, { sha256: await hexSha(text) })
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([text])))
    return { uploadId, storageId }
  }

  test('happy path: own binding, matching bytes; a binding is used once', async () => {
    const { t, as, adminA } = await setup()
    const a = await upload(t, as(adminA))
    expect((await as(adminA).mutation(api.companies.setLogo, a)).logoUrl).toEqual(expect.any(String))
    const again = await t.run((ctx) => ctx.storage.store(new Blob(['logo'])))
    expect(await messageOf(as(adminA).mutation(api.companies.setLogo, { storageId: again, uploadId: a.uploadId })))
      .toBe('Logo file not found. Upload the logo again.')
  })

  test("another company's binding or storage id is refused and its file kept", async () => {
    const { t, as, adminA, adminB } = await setup()
    const b = await upload(t, as(adminB))
    await as(adminB).mutation(api.companies.setLogo, b)
    // A's binding cannot claim B's (already claimed) storage id…
    const a = await upload(t, as(adminA))
    expect(await messageOf(as(adminA).mutation(api.companies.setLogo, { storageId: b.storageId, uploadId: a.uploadId })))
      .toBe('Logo file not found. Upload the logo again.')
    // …and A cannot use B's pending binding.
    const b2 = await upload(t, as(adminB), 'logo-2')
    expect(await messageOf(as(adminA).mutation(api.companies.setLogo, b2)))
      .toBe('Logo file not found. Upload the logo again.')

    await as(adminA).mutation(api.companies.setLogo, a)
    await as(adminA).mutation(api.companies.clearLogo, {})
    expect(await t.run((ctx) => ctx.db.system.get(b.storageId))).not.toBeNull()
    expect(await t.run((ctx) => ctx.db.system.get(a.storageId))).toBeNull()
  })

  test("another admin's binding in the same company is refused", async () => {
    const { t, as, adminA } = await setup()
    const otherAdmin = await t.run(async (ctx) => {
      const me = await ctx.db.get(adminA)
      return ctx.db.insert('users', { email: 'admin2@a.com', role: 'admin', companyId: me!.companyId } as any)
    })
    const a = await upload(t, as(adminA))
    expect(await messageOf(as(otherAdmin).mutation(api.companies.setLogo, a)))
      .toBe('Logo file not found. Upload the logo again.')
  })

  test('an expired binding or different bytes are refused', async () => {
    const { t, as, adminA } = await setup()
    const expired = await upload(t, as(adminA))
    await t.run((ctx) => ctx.db.patch(expired.uploadId, { expiresAt: Date.now() - 1 }))
    expect(await messageOf(as(adminA).mutation(api.companies.setLogo, expired)))
      .toBe('Logo file not found. Upload the logo again.')

    const { uploadId } = await as(adminA).mutation(api.companies.generateLogoUploadUrl, { sha256: await hexSha('logo') })
    const other = await t.run((ctx) => ctx.storage.store(new Blob(['not the declared bytes'])))
    expect(await messageOf(as(adminA).mutation(api.companies.setLogo, { storageId: other, uploadId })))
      .toBe('Logo file not found. Upload the logo again.')
  })

  test("publishSettings refuses another company's logo", async () => {
    const { t, as, adminA, adminB } = await setup()
    const b = await upload(t, as(adminB))
    await as(adminB).mutation(api.companies.setLogo, b)
    const { draft } = (await as(adminA).query(api.companies.getSettingsDraft, {})) as any
    expect(await messageOf(as(adminA).mutation(api.companies.publishSettings, {
      draft: { ...draft, logoStorageId: b.storageId },
    }))).toBe('Logo file not found. Upload the logo again.')
  })
})

describe('SEC-002 (c) V9 admin-only high-risk writes', () => {
  test('harvest.update: count or type change needs admin, notes do not', async () => {
    const { as, staffA, harvestA } = await setup()
    expect(await messageOf(as(staffA).mutation(api.harvest.update, {
      id: harvestA, patch: { estimatedCount: 50 },
    }))).toBe(DENIED)
    expect(await messageOf(as(staffA).mutation(api.harvest.update, {
      id: harvestA, patch: { harvestType: 'complete' },
    }))).toBe(DENIED)
    const res = await as(staffA).mutation(api.harvest.update, {
      id: harvestA, patch: { notes: 'ok', estimatedCount: 100 },
    })
    expect(res.id).toBe(harvestA)
  })

  test('feed.updateFeedType: price change needs admin', async () => {
    const { as, staffA, feedA } = await setup()
    expect(await messageOf(as(staffA).mutation(api.feed.updateFeedType, {
      id: feedA, patch: { pricePerKg: 9 },
    }))).toBe(DENIED)
    expect(await as(staffA).mutation(api.feed.updateFeedType, {
      id: feedA, patch: { name: 'Renamed', pricePerKg: 2 },
    })).toBe(feedA)
  })

  test('sales.updateSale: price or payment change needs admin', async () => {
    const { as, staffA, adminA, saleA } = await setup()
    expect(await messageOf(as(staffA).mutation(api.sales.updateSale, {
      id: saleA, patch: { pricePerKg: 9 },
    }))).toBe(DENIED)
    expect(await messageOf(as(staffA).mutation(api.sales.updateSale, {
      id: saleA, patch: { paymentStatus: 'paid' },
    }))).toBe(DENIED)
    expect(await as(staffA).mutation(api.sales.updateSale, {
      id: saleA, patch: { notes: 'ok' },
    })).toBe(saleA)
    expect(await as(adminA).mutation(api.sales.updateSale, {
      id: saleA, patch: { paymentStatus: 'paid' },
    })).toBe(saleA)
  })

  test('dailyRecords.createMany needs admin', async () => {
    const { as, staffA, cageA } = await setup()
    expect(await messageOf(as(staffA).mutation(api.dailyRecords.createMany, {
      records: [{ cageId: cageA, date: '2026-11-11', feedAmount: 0, feedPrice: 0, feedCost: 0, mortality: 0 }],
    }))).toBe(DENIED)
  })

  test('biweeklyRecords.createMany needs admin', async () => {
    const { as, staffA, cageA } = await setup()
    expect(await messageOf(as(staffA).mutation(api.biweeklyRecords.createMany, {
      records: [{ cageId: cageA, date: '2026-11-11', batchCode: 'BW-9', averageBodyWeight: 100, totalFishCount: 10, totalWeight: 1 }],
    }))).toBe(DENIED)
  })

  test('cages.update: status change needs admin, a rename does not', async () => {
    const { as, staffA, cageA } = await setup()
    expect(await messageOf(as(staffA).mutation(api.cages.update, {
      id: cageA, patch: { status: 'maintenance' },
    }))).toBe(DENIED)
    expect(await as(staffA).mutation(api.cages.update, {
      id: cageA, patch: { name: 'A1 renamed', status: 'active' },
    })).toBe(cageA)
  })
})

describe('SEC-002 (d) V6 user management', () => {
  async function withSuperAdminMember(t: ReturnType<typeof convexTest>, companyId: any) {
    return t.run((ctx) =>
      ctx.db.insert('users', { email: 'owner@a.com', role: 'super_admin', companyId }),
    )
  }

  test('a company admin cannot modify, deactivate or reactivate a super_admin', async () => {
    const { t, as, adminA, companyA } = await setup()
    const ownerA = await withSuperAdminMember(t, companyA)
    expect(await messageOf(as(adminA).mutation(api.users.update, {
      id: ownerA, patch: { role: 'user' },
    }))).toBe('Only a super_admin can change a super_admin account')
    expect(await messageOf(as(adminA).mutation(api.users.update, {
      id: ownerA, patch: { name: 'Renamed' },
    }))).toBe('Only a super_admin can change a super_admin account')
    expect(await messageOf(as(adminA).mutation(api.users.deactivate, { id: ownerA })))
      .toBe('Only a super_admin can change a super_admin account')
    expect(await messageOf(as(adminA).mutation(api.users.reactivate, { id: ownerA })))
      .toBe('Only a super_admin can change a super_admin account')
  })

  test('the last active admin cannot be demoted or deactivated', async () => {
    const { t, as, adminA, staffA } = await setup()
    expect(await messageOf(as(adminA).mutation(api.users.update, {
      id: adminA, patch: { role: 'user' },
    }))).toBe('The company must keep at least one active admin')

    // Promote staff, then the old admin may step down; the new one may not.
    await as(adminA).mutation(api.users.update, { id: staffA, patch: { role: 'admin' } })
    await as(adminA).mutation(api.users.update, { id: adminA, patch: { role: 'user' } })
    expect(await messageOf(as(staffA).mutation(api.users.update, {
      id: staffA, patch: { role: 'user' },
    }))).toBe('The company must keep at least one active admin')
    // Super_admins always verify a second factor (audit B).
    const asPlatform = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { email: 'p@x.com', role: 'super_admin' })
      const sessionId = await ctx.db.insert('authSessions', { userId, expirationTime: Date.now() + 86_400_000 })
      await ctx.db.insert('mfaSessions', { userId, sessionId, purpose: 'verify', attempts: 0, verifiedAt: Date.now(), method: 'totp' })
      return `${userId}|${sessionId}`
    })
    expect(await messageOf(t.withIdentity({ subject: asPlatform }).mutation(api.users.deactivate, { id: staffA })))
      .toBe('The company must keep at least one active admin')
  })

  test('super_admins in the company count as admins (company with no plain admin)', async () => {
    // Live shape: super_admins + users, no admin. Demoting the only admin is
    // fine while a super_admin member remains.
    const { t, as, adminA, companyA } = await setup()
    await withSuperAdminMember(t, companyA)
    await as(adminA).mutation(api.users.update, { id: adminA, patch: { role: 'user' } })
    expect((await t.run((ctx) => ctx.db.get(adminA)))?.role).toBe('user')
  })
})

describe('SEC-002 (e) V15 batch codes are unique per company', () => {
  const record = (cageId: any, batchCode: string) => ({
    cageId, date: '2026-11-12', batchCode, averageBodyWeight: 100, totalFishCount: 10, totalWeight: 1,
  })

  test("another company's batch code does not block or leak", async () => {
    const { as, adminA, adminB, cageA, cageB } = await setup()
    await as(adminB).mutation(api.biweeklyRecords.create, record(cageB, 'BW-1'))
    await as(adminA).mutation(api.biweeklyRecords.create, record(cageA, 'BW-1'))
    expect(await messageOf(as(adminA).mutation(api.biweeklyRecords.create, record(cageA, 'BW-1'))))
      .toBe('Batch code already exists')
  })

  test('update checks uniqueness within the company only', async () => {
    const { as, adminA, adminB, cageA, cageB } = await setup()
    await as(adminB).mutation(api.biweeklyRecords.create, record(cageB, 'BW-2'))
    const a1 = await as(adminA).mutation(api.biweeklyRecords.create, record(cageA, 'BW-1'))
    await as(adminA).mutation(api.biweeklyRecords.create, record(cageA, 'BW-3'))
    expect(await as(adminA).mutation(api.biweeklyRecords.update, { id: a1, patch: { batchCode: 'BW-2' } })).toBe(a1)
    expect(await messageOf(as(adminA).mutation(api.biweeklyRecords.update, {
      id: a1, patch: { batchCode: 'BW-3' },
    }))).toBe('Batch code already exists')
  })
})
