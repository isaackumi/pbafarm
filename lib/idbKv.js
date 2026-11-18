/**
 * A very small IndexedDB key-value store (MOBILE-007): one database, one
 * object store, get/set/delete of JSON-able values. Every call resolves (null
 * or false) instead of throwing when IndexedDB is missing, blocked (private
 * mode) or fails, so callers can treat it as best-effort durable storage.
 *
 * `createIdbKv(factory)` takes the IDBFactory for tests; `idbKv` uses the
 * browser's.
 */

const DB_NAME = 'pbafarm'
const STORE = 'kv'

function promisify(request) {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(undefined)
  })
}

export function createIdbKv(factory) {
  let opening = null

  const open = () => {
    if (!factory) return Promise.resolve(null)
    if (!opening) {
      opening = new Promise((resolve) => {
        let req
        try {
          req = factory.open(DB_NAME, 1)
        } catch {
          resolve(null)
          return
        }
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      })
    }
    return opening
  }

  const run = async (mode, fn) => {
    try {
      const db = await open()
      if (!db) return undefined
      const tx = db.transaction(STORE, mode)
      return await promisify(fn(tx.objectStore(STORE)))
    } catch {
      return undefined
    }
  }

  return {
    async get(key) {
      const value = await run('readonly', (s) => s.get(key))
      return value === undefined ? null : value
    },
    async set(key, value) {
      return (await run('readwrite', (s) => s.put(value, key))) !== undefined
    },
    async del(key) {
      await run('readwrite', (s) => s.delete(key))
      return true
    },
  }
}

export const idbKv = createIdbKv(
  typeof indexedDB === 'undefined' ? null : indexedDB,
)
