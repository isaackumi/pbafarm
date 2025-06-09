// components/Layout.js (Updated with collapsible sidebar)
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Sidebar from './Sidebar'
import TopBar from './Header' // Renamed Header to TopBar

const Layout = ({
  children,
  title: initialTitle = 'Dashboard',
}) => {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('')
  const [title, setTitle] = useState(initialTitle)

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

  return (
    <div className="flex h-screen bg-gray-100 font-montserrat">
      <Sidebar activeTab={activeTab} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar title={title} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}

export default Layout
