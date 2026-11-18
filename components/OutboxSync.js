import { useEffect } from 'react'
import { useOutbox } from '../hooks/useOutbox'
import { listOutbox, restoreOutbox } from '../lib/offlineOutbox'
import { useToast } from './Toast'

/**
 * Sends this user's queued field entries when the app opens online and
 * whenever the connection comes back, on any page (MOBILE-002).
 */
export default function OutboxSync() {
  const { send, userId } = useOutbox()
  const { showToast } = useToast()
  useEffect(() => {
    if (!userId || typeof window === 'undefined') return undefined
    const run = async () => {
      // Bring back anything localStorage lost from the IndexedDB copy.
      await restoreOutbox(userId)
      if (navigator.onLine === false || listOutbox(userId).length === 0) return
      const { sent, failed } = await send()
      if (sent) showToast(`Sent ${sent} entr${sent === 1 ? 'y' : 'ies'} saved on this phone`, 'success')
      if (failed) {
        showToast(
          `${failed} saved entr${failed === 1 ? 'y needs' : 'ies need'} attention. Open Outbox`,
          'error',
        )
      }
    }
    const t = setTimeout(run, 0)
    window.addEventListener('online', run)
    return () => {
      clearTimeout(t)
      window.removeEventListener('online', run)
    }
  }, [userId, send, showToast])

  return null
}
