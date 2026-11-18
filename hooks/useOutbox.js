import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { flushOutbox, listOutbox, removeFromOutbox } from '../lib/offlineOutbox'
import { sendOutboxItem } from '../lib/outboxSenders'

/**
 * This user's outbox, live (MOBILE-002): items, `send(only?)`, `discard(id)`.
 * Re-reads whenever any page changes the queue (`pbafarm:outbox` event) or
 * another tab does (`storage`).
 */
export function useOutbox() {
  const { user } = useAuth()
  const userId = user?.id
  const [items, setItems] = useState([])
  const [sending, setSending] = useState(false)

  const refresh = useCallback(() => setItems(listOutbox(userId)), [userId])

  useEffect(() => {
    refresh()
    if (typeof window === 'undefined') return undefined
    const onStorage = (e) => {
      if (!e.key || e.key.startsWith('pbafarm:outbox:')) refresh()
    }
    window.addEventListener('pbafarm:outbox', refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('pbafarm:outbox', refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [refresh])

  const send = useCallback(
    async (only) => {
      if (!userId) return { sent: 0, failed: 0, refused: 0 }
      setSending(true)
      try {
        return await flushOutbox(sendOutboxItem, userId, undefined, only ? { only } : {})
      } finally {
        setSending(false)
        refresh()
      }
    },
    [userId, refresh],
  )

  const discard = useCallback(
    (id) => {
      removeFromOutbox(id, userId)
      refresh()
    },
    [userId, refresh],
  )

  return { items, count: items.length, sending, send, discard, userId }
}

/** navigator.onLine, kept current. */
export function useOnline() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    setOnline(navigator.onLine !== false)
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}
