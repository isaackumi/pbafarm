import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n/context'

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
      className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-[340px] flex-col gap-3 rounded-[20px] border border-line-strong bg-surface-2 px-5 py-[18px] text-text shadow-[0_24px_64px_rgb(0_0_0/0.4)] md:inset-x-auto md:bottom-6 md:right-6 md:w-[340px]"
    >
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-cyan" aria-hidden />
        <p className="text-sm font-semibold leading-[18px]">{t('overlay.update.title')}</p>
      </div>
      <p className="text-sm leading-[18px] text-muted">{t('pwa.updateReady')}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}
          className="rounded-pill bg-button px-4 py-2 text-sm font-semibold leading-[18px] text-button-text hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2"
        >
          {t('pwa.reload')}
        </button>
        <button
          type="button"
          onClick={() => setWaiting(null)}
          className="rounded-pill px-4 py-2 text-sm leading-[18px] text-muted hover:bg-surface hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          {t('pwa.later')}
        </button>
      </div>
    </div>
  )
}
