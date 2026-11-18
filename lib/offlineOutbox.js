/**
 * Tiny offline outbox for field entries.
 *
 * When a phone has no signal, a batch is kept in localStorage and sent when the
 * connection comes back. Each item remembers its last server error so a rejected
 * batch (duplicate, out of stock) is shown instead of silently retried forever.
 */
const KEY = 'pbafarm:outbox:daily-batch'

function read() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list))
    window.dispatchEvent(new Event('pbafarm:outbox'))
  } catch {
    // storage full or blocked: nothing else we can do offline
  }
}

export function listOutbox() {
  return read()
}

export function enqueue(payload, summary = '') {
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload,
    summary,
    queuedAt: Date.now(),
    lastError: null,
  }
  write([...read(), item])
  return item
}

export function removeFromOutbox(id) {
  write(read().filter((i) => i.id !== id))
}

/** True when the failure is about connectivity, not about the data. */
export function isNetworkError(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = String(err?.message || err || '')
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out|ECONN|offline/i.test(
    msg,
  )
}

/**
 * Try to send every queued item. `send(payload)` must resolve to { error }.
 * Returns { sent, failed } counts. Stops early if the network drops again.
 */
export async function flushOutbox(send) {
  let sent = 0
  let failed = 0
  for (const item of read()) {
    let error = null
    try {
      const res = await send(item.payload)
      error = res?.error || null
    } catch (err) {
      error = err
    }
    if (!error) {
      removeFromOutbox(item.id)
      sent += 1
      continue
    }
    if (isNetworkError(error)) break
    failed += 1
    write(
      read().map((i) =>
        i.id === item.id ? { ...i, lastError: cleanError(error) } : i,
      ),
    )
  }
  return { sent, failed }
}

/** Strip Convex's request-id/stack noise down to the human sentence. */
export function cleanError(err) {
  const msg = String(err?.message || err || 'Something went wrong')
  return msg.replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0].trim()
}
