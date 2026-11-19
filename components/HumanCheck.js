import { useCallback, useEffect, useRef, useState } from 'react'
import { useAction } from 'convex/react'
import { api } from '../convex/_generated/api'

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
    if (!token) throw new Error('Please complete the human check first.')
    try {
      const { ticket } = await verify({ token, purpose })
      return ticket
    } finally {
      // A token can be checked once: get a fresh one for any retry.
      setToken('')
      if (widgetIdRef.current !== null && window.turnstile) window.turnstile.reset(widgetIdRef.current)
    }
  }, [token, purpose, verify])

  const widget = SITE_KEY ? (
    <div>
      <div ref={setContainer} />
      {loadError && <p className="mt-1 text-xs text-signal">{loadError}</p>}
    </div>
  ) : null

  return { widget, getTicket, ready: !SITE_KEY || Boolean(token), hasToken: Boolean(token) }
}
