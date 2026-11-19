import { useEffect } from 'react'
import { useOutbox } from '../hooks/useOutbox'
import { listOutbox, restoreOutbox } from '../lib/offlineOutbox'
import { useToast } from './Toast'
import { useT } from '../lib/i18n/context'

/**
 * Sends this user's queued field entries when the app opens online and
 * whenever the connection comes back, on any page (MOBILE-002).
 */
export default function OutboxSync() {
  const { send, userId } = useOutbox()
  const { showToast } = useToast()
  const t = useT()
  useEffect(() => {
    if (!userId || typeof window === 'undefined') return undefined
    const run = async () => {
      // Bring back anything localStorage lost from the IndexedDB copy.
      await restoreOutbox(userId)
      if (navigator.onLine === false || listOutbox(userId).length === 0) return
      const { sent, failed } = await send()
      if (sent) showToast(t('overlay.outbox.sent', { count: sent }), 'success')
      if (failed) {
        showToast(t('overlay.outbox.failed', { count: failed }), 'error')
      }
    }
    const timer = setTimeout(run, 0)
    window.addEventListener('online', run)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', run)
    }
  }, [userId, send, showToast, t])

  return null
}
