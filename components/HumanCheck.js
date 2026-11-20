import { useCallback, useEffect, useRef, useState } from 'react'
import { useAction } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useT } from '../lib/i18n/context'

/**
 * Cloudflare Turnstile on public forms (CF-003). Shown only when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is set; the Convex deployment checks the
 * token when TURNSTILE_SECRET_KEY is set. Set both, or neither.
 */
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let scriptPromise = null
function loadTurnstile() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SCRIPT_SRC
      s.async = true
      s.defer = true
      s.onload = () => resolve(window.turnstile)
      s.onerror = () => {
        scriptPromise = null
        reject(new Error('Could not load the human check'))
      }
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

export const turnstileEnabled = Boolean(SITE_KEY)

/**
 * `{ widget, getTicket }`: render `widget` in the form; before submitting,
 * `await getTicket()` returns the single-use ticket to send with the request
 * (null when Turnstile is off). Throws if the check is not complete.
 */
export function useHumanCheck(purpose) {
  const verify = useAction(api.humanVerification.verify)
  const t = useT()
  // Callback ref: the form holding the widget may mount after the page does.
  const [container, setContainer] = useState(null)
  const widgetIdRef = useRef(null)
  const [token, setToken] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!SITE_KEY || !container) return undefined
    let cancelled = false
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !container || widgetIdRef.current !== null) return
        widgetIdRef.current = turnstile.render(container, {
          sitekey: SITE_KEY,
          action: purpose,
          // Match the app theme (Paper dark default, light on request).
          theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
          // Paper 60 "Verified quietly · no puzzles": the box only appears
          // when Cloudflare needs the person to interact.
          appearance: 'interaction-only',
          callback: (t) => setToken(t),
          'expired-callback': () => setToken(''),
          'error-callback': () => setToken(''),
        })
      })
      .catch((e) => !cancelled && setLoadError(e.message))
    return () => {
      cancelled = true
      if (widgetIdRef.current !== null && window.turnstile) window.turnstile.remove(widgetIdRef.current)
      widgetIdRef.current = null
    }
  }, [purpose, container])

  const getTicket = useCallback(async () => {
    if (!SITE_KEY) return null
    if (!token) throw new Error(t('authUi.humanFirst'))
    try {
      const { ticket } = await verify({ token, purpose })
      return ticket
    } finally {
      // A token can be checked once: get a fresh one for any retry.
      setToken('')
      if (widgetIdRef.current !== null && window.turnstile) window.turnstile.reset(widgetIdRef.current)
    }
  }, [token, purpose, verify, t])

  // Paper 60 human-check card: 24px ring with a check (green border and
  // stroke), "You're human" 14/18, "Verified quietly · no puzzles" 12/16
  // muted, "Turnstile" 11/14 Geist Mono faint; 12×14 padding, 14px radius.
  const widget = SITE_KEY ? (
    <div className="flex flex-col rounded-input border border-line bg-surface px-3.5 py-3" role="status">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-pill border border-[color:var(--pill-green-border)] text-good [html[data-theme=light]_&]:border-[#BBE5C8]"
            aria-hidden
          >
            {token && (
              <svg width="12" height="12" viewBox="0 0 24 24">
                <path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="text-[14px] leading-[18px] text-text">{token ? t('authUi.human.title') : t('authUi.human.checking')}</p>
            {token && <p className="text-xs leading-4 text-muted">{t('authUi.human.body')}</p>}
          </div>
        </div>
        <span className="font-geist text-[11px] leading-[14px] text-faint">{t('authUi.human.provider')}</span>
      </div>
      {/* Holds the Turnstile box, which stays empty unless a challenge is needed. */}
      <div ref={setContainer} />
      {loadError && <p className="mt-2 text-xs leading-4 text-alert">{loadError}</p>}
    </div>
  ) : null

  return { widget, getTicket, ready: !SITE_KEY || Boolean(token), hasToken: Boolean(token) }
}
