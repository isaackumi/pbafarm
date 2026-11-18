import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n/context'
import { Button } from './ui'

/**
 * Registers the service worker and offers a reload when a new build is ready
 * (MOBILE-007). public/sw.js waits instead of taking over an open page, so a
 * field worker mid-entry is never switched to new code under their feet;
 * "Reload" tells the waiting worker to take over, then reloads once.
 */
export default function AppUpdatePrompt() {
  const t = useT()
  const [waiting, setWaiting] = useState(null)

  useEffect(() => {
    // Production only: a service worker caching dev bundles makes hot reload lie.
    if (process.env.NODE_ENV !== 'production') return undefined
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined
    const sw = navigator.serviceWorker
    let reloading = false
    const onControllerChange = () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    // A new URL per build installs a new worker, which drops the old build's cache.
    const build = window.__NEXT_DATA__?.buildId || 'dev'
    sw.register(`/sw.js?v=${encodeURIComponent(build)}`)
      .then((reg) => {
        const offer = (worker) => {
          // No controller: first install, nothing to replace.
          if (worker && sw.controller) setWaiting(worker)
        }
        offer(reg.waiting)
        reg.addEventListener('updatefound', () => {
          const next = reg.installing
          next?.addEventListener('statechange', () => {
            if (next.state === 'installed') offer(next)
          })
        })
      })
      .catch((err) => {
        console.warn('Service worker registration failed', err)
      })
    sw.addEventListener('controllerchange', onControllerChange)
    return () => sw.removeEventListener('controllerchange', onControllerChange)
  }, [])

  if (!waiting) return null
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-foam-deep bg-surface p-3 text-sm text-chart-ink shadow-lg md:bottom-6"
    >
      <p className="flex-1">{t('pwa.updateReady')}</p>
      <Button variant="ghost" size="sm" onClick={() => setWaiting(null)}>
        {t('pwa.later')}
      </Button>
      <Button size="sm" onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}>
        {t('pwa.reload')}
      </Button>
    </div>
  )
}
