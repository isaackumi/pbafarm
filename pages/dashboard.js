// pages/dashboard.js (Updated)
import { useState, useEffect } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import Dashboard from '../components/Dashboard'
import { cages } from '../data/cages'

export default function DashboardPage() {
  const [title, setTitle] = useState('Dashboard')
  const [showCageSelector, setShowCageSelector] = useState(false)

  // Update title based on activeTab
  const handleActiveTabChange = (tab) => {
    switch (tab) {
      case 'dashboard':
        setTitle('Dashboard')
        setShowCageSelector(false)
        break
      case 'daily':
        setTitle('Daily Data Entry')
        setShowCageSelector(true)
        break
      case 'biweekly':
        setTitle('Biweekly ABW')
        setShowCageSelector(true)
        break
      case 'harvest':
        setTitle('Harvest Data')
        setShowCageSelector(true)
        break
      default:
        setTitle('Dashboard')
        setShowCageSelector(false)
    }
  }

  return (
    <ProtectedRoute>
      <Layout
        title={title}
        showCageSelector={showCageSelector}
        cages={cages}
        onActiveTabChange={handleActiveTabChange}
      >
        <Dashboard />
      </Layout>
    </ProtectedRoute>
  )
}
