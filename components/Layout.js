// components/Layout.js — app shell (Paper Shell 7Z-0)
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Header from './Header'
import QueryBoundary from './QueryBoundary'
import Sidebar from './Sidebar'
import MobileTabBar from './MobileTabBar'
import { ActAsBanner } from './ActAs'
import { PageTitle } from './ui/PageTitle'

const TITLE_BY_PREFIX = [
  ['/admin/company-registrations', 'Company Registrations'],
  ['/admin', 'Admin'],
  ['/cages/analytics', 'Cage Analytics'],
  ['/cages/settings', 'Cage Settings'],
  ['/cages', 'Cage Management'],
  ['/feed-issue', 'Issue Feed'],
  ['/feed-purchases', 'Feed Purchases'],
  ['/feed-suppliers', 'Feed Suppliers'],
  ['/feed-types', 'Feed Types'],
  ['/feed-management', 'Feed Management'],
  ['/inventory/items', 'Stock items'],
  ['/inventory', 'Inventory'],
  ['/stock-levels', 'Stock Levels'],
  ['/inventory-alerts', 'Inventory Alerts'],
  ['/inventory-transactions', 'Inventory Ledger'],
  ['/harvest-sampling', 'Harvest Sampling'],
  ['/trace', 'Harvest lots'],
  ['/hatchery', 'Hatchery'],
  ['/compliance', 'Compliance'],
  ['/harvest', 'Harvest'],
  ['/sales', 'Sales'],
  ['/health', 'Health & Treatments'],
  ['/pnl', 'Cage P&L'],
  ['/analytics', 'Analytics'],
  ['/expenses', 'Expenses'],
  ['/procurement', 'Purchase orders'],
  ['/farm-locations', 'Farm Locations'],
  ['/daily-entry', 'Daily Entry'],
  ['/daily-data', 'Daily records'],
  ['/biweekly-entry', 'Bi-weekly Entry'],
  ['/biweekly-records', 'Bi-weekly Records'],
  ['/stocking-management', 'Stocking Management'],
  ['/stocking', 'Stocking'],
  ['/topup', 'Top-up'],
  ['/approvals', 'Approvals'],
  ['/pending-approval', 'Pending Approval'],
  ['/company-settings', 'Company Settings'],
  ['/users', 'Users'],
  ['/report', 'Reports'],
  ['/export', 'Export'],
  ['/audit-logs', 'Audit Logs'],
  ['/bulk-upload', 'Bulk Upload'],
  ['/create-cage', 'Create Cage'],
  ['/dashboard', 'Dashboard'],
]

/**
 * `eyebrow` and `actions` (up to two GradientButtons) fill the Paper page
 * header; `hideTitle` lets a page render its own.
 */
const Layout = ({ children, title: initialTitle, eyebrow, actions, hideTitle = false }) => {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle || 'Dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    if (initialTitle) {
      setTitle(initialTitle)
      return
    }
    const path = router.pathname
    const match = TITLE_BY_PREFIX.find(([prefix]) => path.startsWith(prefix))
    setTitle(match ? match[1] : 'Anowa')
  }, [router.pathname, initialTitle])

  // Close the phone drawer whenever the route changes
  useEffect(() => {
    setMobileNavOpen(false)
  }, [router.asPath])

  return (
    <div className="min-h-screen bg-bg font-sans text-text" data-tour="app-shell">
      <Sidebar
        collapsed={sidebarCollapsed && !mobileNavOpen}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <div
        className={`min-h-screen flex flex-col transition-[margin] duration-200 ease-out print:ml-0 ${
          sidebarCollapsed ? 'lg:ml-[4.5rem]' : 'lg:ml-sidebar'
        }`}
      >
        <ActAsBanner />
        <Header onOpenMenu={() => setMobileNavOpen(true)} />
        <main className="flex-1 px-4 pt-6 pb-24 sm:px-8 sm:pt-8 lg:px-10 lg:pt-9 lg:pb-10 animate-fade-in bg-transparent">
          {!hideTitle && (
            <PageTitle
              className="mb-7 print:hidden"
              eyebrow={eyebrow}
              title={title}
              actions={actions}
              titleProps={{ 'data-tour': 'header-title' }}
            />
          )}
          <QueryBoundary resetKey={router.asPath}>{children}</QueryBoundary>
        </main>
      </div>
      <MobileTabBar onOpenMenu={() => setMobileNavOpen(true)} />
    </div>
  )
}

export default Layout
