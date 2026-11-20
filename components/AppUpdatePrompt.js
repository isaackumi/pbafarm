import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n/context'
import { TOAST_SURFACE } from './Toast'

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
  // Paper 63 "App update" card: 340 wide, 18/20 padding, 20px radius, 12px gaps; 32px from the corner.
  return (
    <div
      role="status"
      className={`fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-[340px] flex-col gap-3 rounded-[20px] border border-line-strong px-5 py-[18px] text-text md:inset-x-auto md:bottom-8 md:right-8 md:w-[340px] [[data-theme=light]_&]:border-line ${TOAST_SURFACE}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="size-2 shrink-0 rounded-full bg-sky-ink [[data-theme=light]_&]:bg-[#3D86E6]" aria-hidden />
        <p className="text-[14px] font-semibold leading-[18px]">{t('overlay.update.title')}</p>
      </div>
      <p className="text-[13px] leading-[18px] text-muted">{t('pwa.updateReady')}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}
          className="rounded-pill bg-button px-4 py-2 text-[13px] font-semibold leading-4 text-button-text hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2"
        >
          {t('pwa.reload')}
        </button>
        <button
          type="button"
          onClick={() => setWaiting(null)}
          className="rounded-pill border border-line-strong px-4 py-2 text-[13px] leading-4 text-text hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          {t('pwa.later')}
        </button>
      </div>
    </div>
  )
}
