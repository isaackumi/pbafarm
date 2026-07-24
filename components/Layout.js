// components/Layout.js (Updated with collapsible sidebar)
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useDispatch, useSelector } from 'react-redux'
import { fetchCages } from '../store/slices/cagesSlice'
import Header from './Header'
import Sidebar from './Sidebar'

const Layout = ({
  children,
  title: initialTitle = 'Dashboard',
}) => {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('')
  const [title, setTitle] = useState(initialTitle)
  const dispatch = useDispatch()
  const { cages, loading, error } = useSelector((state) => state.cages)

  useEffect(() => {
    // Set active tab and title based on current route
    const path = router.pathname
    let newTitle = 'Dashboard'
    if (path === '/dashboard') {
      setActiveTab('dashboard')
      newTitle = 'Dashboard'
    } else if (path.includes('/cages')) {
      setActiveTab('cages')
      newTitle = 'Cage Management'
    } else if (path.includes('/harvest')) {
      setActiveTab('harvest')
      newTitle = 'Harvest Management'
    } else if (path.includes('/feed-management')) {
      setActiveTab('feed')
      newTitle = 'Feed Management'
    } else {
      setActiveTab('')
      newTitle = 'Dashboard'
    }
    setTitle(newTitle)
  }, [router.pathname])

  useEffect(() => {
    dispatch(fetchCages())
  }, [dispatch])

  return (
    <div className="min-h-screen bg-foam font-sans">
      <Sidebar />
      <div className="ml-64 min-h-screen">
        <Header title={title} />
        <main className="p-6 animate-fade-in">
          {error && (
            <div className="mb-4 p-3 rounded-md border border-signal/30 bg-signal/10 text-sm text-signal">
              Cage data temporarily unavailable during Convex migration: {error}
            </div>
          )}
          {loading && (
            <div className="mb-4 text-sm text-muted font-data">Loading cages…</div>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}

export default Layout
