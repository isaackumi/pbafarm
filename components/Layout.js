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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md">
        <div className="flex">
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Error</h3>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Sidebar is fixed, full height */}
      <Sidebar />
      {/* Main content is offset by sidebar width */}
      <div className="ml-64 min-h-screen bg-gray-100">
        {/* Header is sticky at the top */}
        <Header />
        <main className="p-6">
          {children}
        </main>
      </div>
    </div>
  )
}

export default Layout
