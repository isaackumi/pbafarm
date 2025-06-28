import React from 'react'
import { useSelector } from 'react-redux'
import Link from 'next/link'
import {
  LayoutGrid,
  BarChart2,
  Settings,
  Plus,
  PieChart,
  LineChart,
} from 'lucide-react'

const CageManagementSidebar = () => {
  const { cages, loading } = useSelector((state) => state.cages)
  
  // Calculate analytics
  const analytics = React.useMemo(() => {
    if (!cages) return {
      totalCages: 0,
      activeCages: 0,
      readyForHarvest: 0,
      maintenanceNeeded: 0,
      emptyCages: 0,
      utilizationRate: 0,
      statusDistribution: [],
      harvestReadiness: [],
    }

    const totalCages = cages.length
    const activeCages = cages.filter(cage => cage.status === 'active').length
    const readyForHarvest = cages.filter(cage => {
      if (!cage.stocking_date) return false
      const stockingDate = new Date(cage.stocking_date)
      const today = new Date()
      const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))
      return doc >= 100
    }).length
    const maintenanceNeeded = cages.filter(cage => cage.status === 'maintenance').length
    const emptyCages = cages.filter(cage => cage.status === 'empty').length
    const utilizationRate = totalCages ? ((activeCages / totalCages) * 100).toFixed(1) : 0

    // Status distribution
    const statusCount = cages.reduce((acc, cage) => {
      acc[cage.status] = (acc[cage.status] || 0) + 1
      return acc
    }, {})

    const statusDistribution = Object.entries(statusCount).map(([status, count]) => ({
      name: status.charAt(0).toUpperCase() + status.slice(1),
      value: count,
    }))

    // Harvest readiness
    const harvestData = cages.reduce((acc, cage) => {
      if (!cage.stocking_date) return acc
      const stockingDate = new Date(cage.stocking_date)
      const today = new Date()
      const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))
      
      if (doc >= 100) {
        acc.ready++
      } else if (doc >= 80) {
        acc.soon++
      } else {
        acc.growing++
      }
      return acc
    }, { ready: 0, soon: 0, growing: 0 })

    const harvestReadiness = [
      { name: 'Ready for Harvest', value: harvestData.ready },
      { name: 'Harvest Soon', value: harvestData.soon },
      { name: 'Growing', value: harvestData.growing },
    ]

    return {
      totalCages,
      activeCages,
      readyForHarvest,
      maintenanceNeeded,
      emptyCages,
      utilizationRate,
      statusDistribution,
      harvestReadiness,
    }
  }, [cages])

  const menuItems = [
    {
      title: 'Overview',
      icon: <LayoutGrid className="w-5 h-5" />,
      href: '/cages',
      badge: null,
    },
    {
      title: 'Analytics',
      icon: <BarChart2 className="w-5 h-5" />,
      href: '/cages/analytics',
      badge: null,
      subItems: [
        {
          title: 'Status Distribution',
          icon: <PieChart className="w-4 h-4" />,
          href: '/cages/analytics/status',
        },
        {
          title: 'Harvest Readiness',
          icon: <LineChart className="w-4 h-4" />,
          href: '/cages/analytics/harvest',
        },
        {
          title: 'Growth Trends',
          icon: <LineChart className="w-4 h-4" />,
          href: '/cages/analytics/growth',
        },
      ],
    },
    {
      title: 'Settings',
      icon: <Settings className="w-5 h-5" />,
      href: '/cages/settings',
      badge: null,
    },
  ]

  return (
    <div className="w-64 bg-white border-r border-gray-200 h-screen">
      <div className="p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Cage Management</h2>
        
        {/* Quick Stats */}
        <div className="mb-6 space-y-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-sm text-gray-500">Total Cages</div>
            <div className="text-2xl font-semibold text-gray-900">{analytics.totalCages}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-sm text-gray-500">Utilization Rate</div>
            <div className="text-2xl font-semibold text-gray-900">{analytics.utilizationRate}%</div>
          </div>
          <div className="bg-green-50 rounded-lg p-3">
            <div className="text-sm text-green-600">Active Cages</div>
            <div className="text-2xl font-semibold text-green-700">{analytics.activeCages}</div>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3">
            <div className="text-sm text-yellow-600">Ready for Harvest</div>
            <div className="text-2xl font-semibold text-yellow-700">{analytics.readyForHarvest}</div>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="space-y-1">
          {menuItems.map((item) => (
            <div key={item.title}>
              <Link
                href={item.href}
                className="flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-600 rounded-md hover:bg-gray-50 hover:text-gray-900 group"
              >
                <div className="flex items-center">
                  {item.icon}
                  <span className="ml-3">{item.title}</span>
                </div>
                {item.badge !== null && (
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${item.badgeColor}`}>
                    {item.badge}
                  </span>
                )}
              </Link>
              {item.subItems && (
                <div className="ml-8 mt-1 space-y-1">
                  {item.subItems.map((subItem) => (
                    <Link
                      key={subItem.title}
                      href={subItem.href}
                      className="flex items-center px-3 py-2 text-sm font-medium text-gray-500 rounded-md hover:bg-gray-50 hover:text-gray-900"
                    >
                      {subItem.icon}
                      <span className="ml-3">{subItem.title}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Create New Cage Button */}
        <div className="mt-6">
          <Link
            href="/create-cage"
            className="flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <Plus className="w-5 h-5 mr-2" />
            Create New Cage
          </Link>
        </div>
      </div>
    </div>
  )
}

export default CageManagementSidebar 