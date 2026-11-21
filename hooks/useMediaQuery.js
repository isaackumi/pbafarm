import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether a CSS media query matches, kept current. False on the server and
 * during hydration, so the first client render matches the server HTML.
 */
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    [query],
  )
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false)
  return useSyncExternalStore(subscribe, get, () => false)
}

/** Below Tailwind's md breakpoint (768px): the phone layouts. */
export const PHONE_QUERY = '(max-width: 767.98px)'

export const useIsPhone = () => useMediaQuery(PHONE_QUERY)
