import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import {
  SYSTEM_WALKTHROUGH_ID,
  clearTourState,
  getTourState,
  hasCompletedTour,
} from '../lib/tours/tourState'
import { useAuth } from '../contexts/AuthContext'

const TourContext = createContext(null)

let loading = null
/**
 * driver.js and the walkthrough copy load only when a tour starts or resumes,
 * so they stay off every page's first load (MOBILE-008).
 */
function loadTourEngine() {
  if (!loading) {
    loading = Promise.all([
      import('../lib/tours/tourEngine'),
      import('../lib/tours/systemWalkthrough'),
    ])
      .then(([engine, walkthrough]) => ({ engine, walkthrough }))
      .catch((err) => {
        loading = null
        throw err
      })
  }
  return loading
}

export function TourProvider({ children }) {
  const router = useRouter()
  const { user, initialized } = useAuth()
  const role = user?.role || 'user'
  const roleRef = useRef(role)
  roleRef.current = role
  const routerRef = useRef(router)
  routerRef.current = router

  /** Load the engine and give it the catalog for the current role. */
  const engine = useCallback(async () => {
    const { engine: e, walkthrough } = await loadTourEngine()
    const filtered = {}
    for (const [id, def] of Object.entries(walkthrough.tourCatalog)) {
      filtered[id] = {
        ...def,
        steps: walkthrough.filterTourStepsForRole(def.steps, roleRef.current),
      }
    }
    e.setTourCatalog(filtered)
    e.setTourNavigator((path) => {
      routerRef.current.push(path)
    })
    return e
  }, [])

  useEffect(() => {
    if (!router.isReady) return
    const handle = () => {
      if (!getTourState()?.active) return
      setTimeout(() => {
        engine()
          .then((e) => e.resumeTourIfNeeded())
          .catch(() => {})
      }, 350)
    }
    handle()
    router.events.on('routeChangeComplete', handle)
    return () => {
      router.events.off('routeChangeComplete', handle)
    }
  }, [router.isReady, router.events, engine])

  useEffect(() => {
    if (!initialized || !user) return
    if (typeof window === 'undefined') return
    // Phones: no automatic walkthrough over field screens; it stays in Help.
    if (window.matchMedia?.('(max-width: 1023px)').matches) return
    const publicRoutes = ['/login', '/signup', '/reset-password', '/verify-email']
    if (publicRoutes.includes(router.pathname)) return
    if (hasCompletedTour(SYSTEM_WALKTHROUGH_ID)) return
    if (getTourState()?.active) return
    try {
      if (sessionStorage.getItem('pbafarm:tour:autosuggested')) return
      sessionStorage.setItem('pbafarm:tour:autosuggested', '1')
    } catch {
      // ignore
    }
    const t = setTimeout(() => {
      if (
        router.pathname === '/dashboard' ||
        router.pathname.startsWith('/dashboard')
      ) {
        engine()
          .then((e) => e.startTour(SYSTEM_WALKTHROUGH_ID, 0))
          .catch(() => {})
      }
    }, 900)
    return () => clearTimeout(t)
  }, [initialized, user, router.pathname, engine])

  const startSystemWalkthrough = useCallback(() => {
    engine()
      .then((e) => {
        e.destroyActiveTour()
        e.clearTourState()
        return e.startTour(SYSTEM_WALKTHROUGH_ID, 0)
      })
      .catch(() => {})
  }, [engine])

  const value = useMemo(
    () => ({
      startSystemWalkthrough,
      startTour: (id, index) => engine().then((e) => e.startTour(id, index)),
      stopTour: () => {
        clearTourState()
        if (loading) loading.then(({ engine: e }) => e.destroyActiveTour()).catch(() => {})
      },
    }),
    [startSystemWalkthrough, engine],
  )

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) {
    throw new Error('useTour must be used within TourProvider')
  }
  return ctx
}
