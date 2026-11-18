import { describe, expect, it } from 'vitest'
import { saveOrQueue } from './outboxSenders'
import { listOutbox } from './offlineOutbox'

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

describe('saveOrQueue', () => {
  it('sends online with a replay key and queues nothing', async () => {
    const storage = memoryStorage()
    const seen = []
    const res = await saveOrQueue(
      { kind: 'harvest', payload: { a: 1 }, userId: 'u' },
      {
        storage,
        online: true,
        send: (p, item) => {
          seen.push([p, item.kind])
          return Promise.resolve({ data: 'id1', warnings: ['w'] })
        },
      },
    )
    expect(res).toEqual({ data: 'id1', warnings: ['w'] })
    expect(seen[0][0].clientMutationId).toEqual(expect.any(String))
    expect(seen[0][1]).toBe('harvest')
    expect(listOutbox('u', storage)).toEqual([])
  })

  it('queues offline without trying', async () => {
    const storage = memoryStorage()
    let tried = false
    const res = await saveOrQueue(
      { kind: 'feed-issue', payload: { q: 2 }, summary: 's', userId: 'u' },
      { storage, online: false, send: () => { tried = true } },
    )
    expect(res).toEqual({ queued: true })
    expect(tried).toBe(false)
    expect(listOutbox('u', storage)[0]).toMatchObject({ kind: 'feed-issue', summary: 's' })
  })

  it('a lost response queues the same key that was sent', async () => {
    const storage = memoryStorage()
    let sentKey
    const res = await saveOrQueue(
      { kind: 'biweekly-batch', payload: {}, userId: 'u' },
      {
        storage,
        online: true,
        send: (p) => {
          sentKey = p.clientMutationId
          return Promise.resolve({ error: new Error('Failed to fetch') })
        },
      },
    )
    expect(res).toEqual({ queued: true })
    expect(listOutbox('u', storage)[0].payload.clientMutationId).toBe(sentKey)
  })

  it('returns a server refusal instead of queueing it', async () => {
    const storage = memoryStorage()
    const error = new Error('Batch code already exists')
    const res = await saveOrQueue(
      { kind: 'harvest', payload: {}, userId: 'u' },
      { storage, online: true, send: () => Promise.resolve({ error }) },
    )
    expect(res).toEqual({ error })
    expect(listOutbox('u', storage)).toEqual([])
  })
})
