import { describe, expect, it } from 'vitest'
import {
  ANOTHER_ACCOUNT_ERROR,
  LEGACY_OUTBOX_KEY,
  clearOutbox,
  enqueue,
  enqueueEntry,
  kindOf,
  restoreOutbox,
  setOutboxMirror,
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
    expect(sentPayloads.map(({ n }) => ({ n }))).toEqual([{ n: 2 }])
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
    expect(sentPayloads.map(({ n }) => ({ n }))).toEqual([{ n: 2 }])
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

describe('offline outbox: field forms and replay keys (MOBILE-002)', () => {
  it('queues any known kind with a replay key, keeping a given one', () => {
    const s = memoryStorage()
    const a = enqueueEntry({ kind: 'harvest', payload: { x: 1 }, summary: 'A1' }, 'u', s)
    const b = enqueueEntry(
      { kind: 'biweekly-batch', payload: { clientMutationId: 'k-1' } },
      'u',
      s,
    )
    expect(a.kind).toBe('harvest')
    expect(a.payload.clientMutationId).toEqual(expect.any(String))
    expect(b.payload.clientMutationId).toBe('k-1')
    expect(() => enqueueEntry({ kind: 'nope', payload: {} }, 'u', s)).toThrow()
  })

  it('treats items without a kind as daily batches', () => {
    expect(kindOf({})).toBe('daily-batch')
    expect(kindOf({ kind: 'feed-issue' })).toBe('feed-issue')
    expect(kindOf({ kind: 'larval-log' })).toBe('larval-log')
  })

  it('passes the item to send, so each kind reaches its own mutation', async () => {
    const s = memoryStorage()
    enqueueEntry({ kind: 'feed-issue', payload: { q: 1 } }, 'u', s)
    enqueue({ d: 1 }, '', 'u', s)
    const kinds = []
    await flushOutbox((payload, item) => {
      kinds.push(item.kind)
      return ok()
    }, 'u', s)
    expect(kinds).toEqual(['feed-issue', 'daily-batch'])
  })

  it('gives a pre-upgrade item a stable key before the first send', async () => {
    const s = memoryStorage({
      [outboxKey('u')]: JSON.stringify([{ id: 'old1', payload: { d: 1 }, createdBy: 'u' }]),
    })
    const keys = []
    const fail = (payload) => {
      keys.push(payload.clientMutationId)
      return Promise.resolve({ error: new Error('Failed to fetch') })
    }
    await flushOutbox(fail, 'u', s)
    await flushOutbox(fail, 'u', s)
    expect(keys).toEqual(['outbox-old1', 'outbox-old1'])
  })

  it('retries one item only, and never sends an item twice at once', async () => {
    const s = memoryStorage()
    const a = enqueue({ n: 1 }, '', 'u', s)
    enqueue({ n: 2 }, '', 'u', s)
    const sent = []
    const slow = (payload) =>
      new Promise((r) => setTimeout(() => {
        sent.push(payload.n)
        r({ error: null })
      }, 5))
    await flushOutbox(slow, 'u', s, { only: a.id })
    expect(sent).toEqual([1])
    await Promise.all([flushOutbox(slow, 'u', s), flushOutbox(slow, 'u', s)])
    expect(sent).toEqual([1, 2])
    expect(outboxCount('u', s)).toBe(0)
  })
})

describe('offline outbox: IndexedDB copy (MOBILE-007)', () => {
  const fakeMirror = () => {
    const map = new Map()
    return {
      map,
      get: async (k) => (map.has(k) ? JSON.parse(map.get(k)) : null),
      set: async (k, v) => {
        map.set(k, JSON.stringify(v))
        return true
      },
      del: async (k) => {
        map.delete(k)
        return true
      },
    }
  }

  it('mirrors every write and restores items localStorage lost', async () => {
    const m = fakeMirror()
    setOutboxMirror(m)
    try {
      const s = memoryStorage()
      enqueue({ n: 1 }, 'a', 'u', s)
      enqueue({ n: 2 }, 'b', 'u', s)
      expect(JSON.parse(m.map.get(outboxKey('u')))).toHaveLength(2)
      // The browser dropped localStorage (quota, cleanup).
      s.removeItem(outboxKey('u'))
      expect(await restoreOutbox('u', s)).toBe(2)
      expect(listOutbox('u', s).map((i) => i.summary)).toEqual(['a', 'b'])
      expect(await restoreOutbox('u', s)).toBe(0)
    } finally {
      setOutboxMirror(null)
    }
  })

  it('clearing the queue clears the copy, so nothing comes back', async () => {
    const m = fakeMirror()
    setOutboxMirror(m)
    try {
      const s = memoryStorage()
      enqueue({ n: 1 }, '', 'u', s)
      clearOutbox('u', s)
      expect(m.map.has(outboxKey('u'))).toBe(false)
      expect(await restoreOutbox('u', s)).toBe(0)
    } finally {
      setOutboxMirror(null)
    }
  })

  it("never restores another user's items", async () => {
    const m = fakeMirror()
    setOutboxMirror(m)
    try {
      const s = memoryStorage()
      await m.set(outboxKey('u'), [{ id: 'x', createdBy: 'other', payload: {} }])
      expect(await restoreOutbox('u', s)).toBe(0)
    } finally {
      setOutboxMirror(null)
    }
  })
})
