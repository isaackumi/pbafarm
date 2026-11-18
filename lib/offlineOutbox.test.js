import { describe, expect, it } from 'vitest'
import {
  ANOTHER_ACCOUNT_ERROR,
  LEGACY_OUTBOX_KEY,
  clearOutbox,
  enqueue,
  flushOutbox,
  listOutbox,
  migrateLegacyOutbox,
  outboxCount,
  outboxKey,
  removeFromOutbox,
} from './offlineOutbox'

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  }
}

const ok = () => Promise.resolve({ error: null })

describe('offline outbox: per-user namespace', () => {
  it('stores items under pbafarm:outbox:<userId>:daily-batch with createdBy', () => {
    const s = memoryStorage()
    const item = enqueue({ date: '2026-11-18' }, 'one cage', 'userA', s)
    expect(outboxKey('userA')).toBe('pbafarm:outbox:userA:daily-batch')
    expect(s.keys()).toEqual(['pbafarm:outbox:userA:daily-batch'])
    expect(item.createdBy).toBe('userA')
    expect(listOutbox('userA', s)).toHaveLength(1)
  })

  it("never shows one user's queue to another", () => {
    const s = memoryStorage()
    enqueue({ n: 1 }, '', 'userA', s)
    expect(listOutbox('userB', s)).toEqual([])
    expect(outboxCount('userB', s)).toBe(0)
    expect(outboxCount('userA', s)).toBe(1)
  })

  it('refuses to enqueue without a user', () => {
    expect(() => enqueue({}, '', undefined, memoryStorage())).toThrow()
  })

  it('removes one item and clears a whole queue', () => {
    const s = memoryStorage()
    const a = enqueue({ n: 1 }, '', 'userA', s)
    enqueue({ n: 2 }, '', 'userA', s)
    enqueue({ n: 3 }, '', 'userB', s)
    removeFromOutbox(a.id, 'userA', s)
    expect(listOutbox('userA', s).map((i) => i.payload.n)).toEqual([2])
    clearOutbox('userA', s)
    expect(outboxCount('userA', s)).toBe(0)
    expect(outboxCount('userB', s)).toBe(1)
  })
})

describe('offline outbox: flush ownership', () => {
  it("sends only the signed-in user's own items", async () => {
    const s = memoryStorage()
    enqueue({ n: 1 }, '', 'userA', s)
    enqueue({ n: 2 }, '', 'userB', s)
    const sentPayloads = []
    const send = (p) => {
      sentPayloads.push(p)
      return ok()
    }
    const res = await flushOutbox(send, 'userB', s)
    expect(res).toEqual({ sent: 1, failed: 0, refused: 0 })
    expect(sentPayloads).toEqual([{ n: 2 }])
    expect(outboxCount('userA', s)).toBe(1)
  })

  it('refuses an item in my queue that another user created', async () => {
    const s = memoryStorage({
      [outboxKey('userB')]: JSON.stringify([
        { id: 'x', payload: { n: 1 }, createdBy: 'userA', lastError: null },
        { id: 'y', payload: { n: 2 }, createdBy: 'userB', lastError: null },
        { id: 'z', payload: { n: 3 }, lastError: null },
      ]),
    })
    const sentPayloads = []
    const res = await flushOutbox(
      (p) => {
        sentPayloads.push(p)
        return ok()
      },
      'userB',
      s,
    )
    expect(sentPayloads).toEqual([{ n: 2 }])
    expect(res).toEqual({ sent: 1, failed: 0, refused: 2 })
    const left = listOutbox('userB', s)
    expect(left.map((i) => i.id)).toEqual(['x', 'z'])
    expect(left.every((i) => i.lastError === ANOTHER_ACCOUNT_ERROR)).toBe(true)
  })

  it('does nothing without a user', async () => {
    const s = memoryStorage()
    enqueue({ n: 1 }, '', 'userA', s)
    let calls = 0
    const res = await flushOutbox(() => {
      calls += 1
      return ok()
    }, undefined, s)
    expect(calls).toBe(0)
    expect(res.sent).toBe(0)
  })

  it('keeps a rejected item with its error and stops on a network error', async () => {
    const s = memoryStorage()
    enqueue({ n: 1 }, '', 'userA', s)
    enqueue({ n: 2 }, '', 'userA', s)
    enqueue({ n: 3 }, '', 'userA', s)
    const res = await flushOutbox(
      (p) => {
        if (p.n === 1) return Promise.resolve({ error: new Error('Daily record already exists') })
        if (p.n === 2) return Promise.reject(new Error('Failed to fetch'))
        return ok()
      },
      'userA',
      s,
    )
    expect(res).toEqual({ sent: 0, failed: 1, refused: 0 })
    const left = listOutbox('userA', s)
    expect(left).toHaveLength(3)
    expect(left[0].lastError).toMatch(/already exists/)
  })
})

describe('offline outbox: legacy migration', () => {
  it('adopts an un-owned legacy queue for the current user and removes the old key', () => {
    const s = memoryStorage({
      [LEGACY_OUTBOX_KEY]: JSON.stringify([
        { id: 'old1', payload: { n: 1 }, summary: 'a', queuedAt: 1, lastError: null },
      ]),
    })
    expect(migrateLegacyOutbox('userA', s)).toBe(1)
    expect(s.getItem(LEGACY_OUTBOX_KEY)).toBeNull()
    const mine = listOutbox('userA', s)
    expect(mine).toHaveLength(1)
    expect(mine[0].createdBy).toBe('userA')
  })

  it('leaves items owned by someone else in the legacy key', () => {
    const s = memoryStorage({
      [LEGACY_OUTBOX_KEY]: JSON.stringify([
        { id: 'a', payload: { n: 1 }, createdBy: 'userA' },
        { id: 'b', payload: { n: 2 } },
      ]),
    })
    expect(migrateLegacyOutbox('userB', s)).toBe(1)
    expect(listOutbox('userB', s).map((i) => i.id)).toEqual(['b'])
    expect(JSON.parse(s.getItem(LEGACY_OUTBOX_KEY)).map((i) => i.id)).toEqual(['a'])
    // userA picks up their own item later.
    expect(migrateLegacyOutbox('userA', s)).toBe(1)
    expect(s.getItem(LEGACY_OUTBOX_KEY)).toBeNull()
  })

  it('is idempotent and a no-op without a legacy queue', () => {
    const s = memoryStorage()
    expect(migrateLegacyOutbox('userA', s)).toBe(0)
    expect(migrateLegacyOutbox(undefined, s)).toBe(0)
  })
})
