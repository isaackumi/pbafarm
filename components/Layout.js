// components/Layout.js (Updated with collapsible sidebar)
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Sidebar from './Sidebar'
import Header from './Header'
import { supabase } from '../lib/supabase'

const Layout = ({
  children,
  title: initialTitle = 'Dashboard',
  showCageSelector = false,
  onActiveTabChange = () => {},
}) => {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('dashboard')
  const [selectedCage, setSelectedCage] = useState('')
  const [title, setTitle] = useState(initialTitle)
  const [cages, setCages] = useState([])
  const [loading, setLoading] = useState(true)

  // Fetch cages for selection
  useEffect(() => {
    async function fetchCages() {
      try {
        const { data, error } = await supabase
          .from('cages')
          .select('id, name, status')
          .order('name')

        if (error) throw error

        setCages(data || [])
        // Set default cage if none is selected
        if (!selectedCage && data && data.length > 0) {
          setSelectedCage(data[0].id)
        }
        setLoading(false)
      } catch (error) {
        console.error('Error fetching cages:', error.message)
        setLoading(false)
      }
    }

    fetchCages()
  }, [])

  // When activeTab changes, update title and notify parent
  useEffect(() => {
    let newTitle = 'Dashboard'
    let shouldShowCageSelector = false

    switch (activeTab) {
      case 'dashboard':
        newTitle = 'Dashboard'
        shouldShowCageSelector = false
        break
      case 'daily':
        newTitle = 'Daily Data Entry'
        shouldShowCageSelector = true
        break
      case 'biweekly':
        newTitle = 'Biweekly ABW'
        shouldShowCageSelector = true
        break
      default:
        newTitle = 'Dashboard'
        shouldShowCageSelector = false
    }

    setTitle(newTitle)
    onActiveTabChange(activeTab)
  }, [activeTab, onActiveTabChange])

  // Handler for setting active tab
  const handleSetActiveTab = (tab) => {
    setActiveTab(tab)
  }

  return (
    <div className="flex h-screen bg-gray-100 font-montserrat">
      {/* Sidebar - now using the collapsible version */}
      <Sidebar activeTab={activeTab} setActiveTab={handleSetActiveTab} />

      {/* Main content - adjusted to work with collapsible sidebar */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          title={title}
          showCageSelector={showCageSelector}
          selectedCage={selectedCage}
          setSelectedCage={setSelectedCage}
          cages={cages}
        />

        <main className="flex-1 overflow-y-auto p-6">
          {/* Pass active tab and selected cage to children */}
          {React.isValidElement(children)
            ? React.cloneElement(children, { activeTab, selectedCage })
            : children}
        </main>
      </div>
    </div>
  )
}

export default Layout
