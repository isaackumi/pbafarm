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
import { Button } from './ui'

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
          title: 'Status distribution',
          icon: <PieChart className="w-4 h-4" />,
          href: '/cages/analytics/status',
        },
        {
          title: 'Harvest readiness',
          icon: <LineChart className="w-4 h-4" />,
          href: '/cages/analytics/harvest',
        },
        {
          title: 'Growth trends',
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
    <div className="w-64 bg-surface border-r border-foam-deep h-screen">
      <div className="p-4">
        <h2 className="font-display text-lg font-medium text-chart-ink mb-4">Cage management</h2>
        
        <dl className="mb-6 grid grid-cols-2 gap-2">
          {[
            ['Total cages', analytics.totalCages, 'text-chart-ink'],
            ['Utilization', `${analytics.utilizationRate}%`, 'text-chart-ink'],
            ['Active', analytics.activeCages, 'text-kelp'],
            ['Ready to harvest', analytics.readyForHarvest, 'text-amber-700 dark:text-amber-300'],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-lg border border-foam-deep bg-foam p-3">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className={`mt-1 text-xl font-medium tabular-nums ${tone}`}>{value}</dd>
            </div>
          ))}
        </dl>

        {/* Navigation Menu */}
        <nav className="space-y-1">
          {menuItems.map((item) => (
            <div key={item.title}>
              <Link
                href={item.href}
                className="flex items-center justify-between px-3 py-2 text-sm font-medium text-muted rounded-lg hover:bg-foam hover:text-chart-ink group"
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
                      className="flex items-center px-3 py-2 text-sm font-medium text-muted rounded-lg hover:bg-foam hover:text-chart-ink"
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

        <div className="mt-6">
          <Button href="/create-cage" className="w-full">
            <Plus className="w-4 h-4" aria-hidden />
            Create cage
          </Button>
        </div>
      </div>
    </div>
  )
}

export default CageManagementSidebar 