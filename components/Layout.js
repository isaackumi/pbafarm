// components/Layout.js (Updated)
import React, { useState, useEffect } from 'react'
import Sidebar from './Sidebar'
import Header from './Header'

const Layout = ({
  children,
  title: initialTitle = 'Dashboard',
  showCageSelector = false,
  cages = [],
  defaultCageId = '',
  onActiveTabChange = () => {},
}) => {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [selectedCage, setSelectedCage] = useState(defaultCageId)
  const [title, setTitle] = useState(initialTitle)

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
      case 'harvest':
        newTitle = 'Harvest Data'
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
      {/* Sidebar */}
      <Sidebar activeTab={activeTab} setActiveTab={handleSetActiveTab} />

      {/* Main content */}
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
