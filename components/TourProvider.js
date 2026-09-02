import { createContext, useCallback, useContext, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import {
  setTourNavigator,
  setTourCatalog,
  startTour,
  resumeTourIfNeeded,
  clearTourState,
  destroyActiveTour,
  getTourState,
  hasCompletedTour,
} from '../lib/tours/tourEngine'
import {
  tourCatalog,
  SYSTEM_WALKTHROUGH_ID,
  filterTourStepsForRole,
} from '../lib/tours/systemWalkthrough'
import { useAuth } from '../contexts/AuthContext'

const TourContext = createContext(null)

export function TourProvider({ children }) {
  const router = useRouter()
  const { user, initialized } = useAuth()
  const role = user?.role || 'user'

  useEffect(() => {
    const filtered = {}
    for (const [id, def] of Object.entries(tourCatalog)) {
      filtered[id] = {
        ...def,
        steps: filterTourStepsForRole(def.steps, role),
      }
    }
    setTourCatalog(filtered)
    setTourNavigator((path) => {
      router.push(path)
    })
  }, [router, role])

  useEffect(() => {
    if (!router.isReady) return
    const handle = () => {
      setTimeout(() => {
        resumeTourIfNeeded()
      }, 350)
    }
    handle()
    router.events.on('routeChangeComplete', handle)
    return () => {
      router.events.off('routeChangeComplete', handle)
    }
  }, [router.isReady, router.events])

  useEffect(() => {
    if (!initialized || !user) return
    if (typeof window === 'undefined') return
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
        startTour(SYSTEM_WALKTHROUGH_ID, 0)
      }
    }, 900)
    return () => clearTimeout(t)
  }, [initialized, user, router.pathname])

  const startSystemWalkthrough = useCallback(() => {
    destroyActiveTour()
    clearTourState()
    startTour(SYSTEM_WALKTHROUGH_ID, 0)
  }, [])

  const value = useMemo(
    () => ({
      startSystemWalkthrough,
      startTour: (id, index) => startTour(id, index),
      stopTour: () => {
        clearTourState()
        destroyActiveTour()
      },
      tourCatalog,
    }),
    [startSystemWalkthrough],
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
