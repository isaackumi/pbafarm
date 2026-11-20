/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

test('operator anonymize: dry run changes nothing, real run deletes and demotes', async () => {
  const t = convexTest(schema, modules)
  const userId = await t.run((ctx) =>
    ctx.db.insert('users', { email: 'probe@example.com', name: 'Probe', role: 'super_admin' } as any),
  )

  await expect(
    t.mutation(internal.governance.anonymizeUserNow, { userId, reason: ' ' , dryRun: false }),
  ).rejects.toThrow()

  const dry = await t.mutation(internal.governance.anonymizeUserNow, { userId, reason: 'test cleanup' })
  expect(dry).toMatchObject({ dryRun: true, found: true, email: 'probe@example.com', role: 'super_admin' })
  expect((await t.run((ctx) => ctx.db.get(userId)))?.email).toBe('probe@example.com')

  await t.mutation(internal.governance.anonymizeUserNow, { userId, reason: 'test cleanup', dryRun: false })
  const after = await t.run((ctx) => ctx.db.get(userId))
  expect(after?.email).toBeUndefined()
  expect(after?.name).toBe('Deleted user')
  expect(after?.role).toBe('user')
  expect(after?.active).toBe(false)
  expect(after?.deletedAt).toBeTypeOf('number')

  const again = await t.mutation(internal.governance.anonymizeUserNow, { userId, reason: 'again', dryRun: false })
  expect(again.alreadyDeleted).toBe(true)
})
