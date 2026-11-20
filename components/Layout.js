// components/Layout.js — app shell (Paper Shell 7Z-0)
import React, { useState, useEffect } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import Header from './Header'
import QueryBoundary from './QueryBoundary'
import Sidebar from './Sidebar'
import MobileTabBar from './MobileTabBar'
import { ActAsBanner } from './ActAs'
import { PageTitle } from './ui/PageTitle'
import { useActiveOrganization } from '../lib/useActiveOrganization'
import { documentTitle } from '../lib/activeOrganization'
import { getSidebarCollapsed, peekSidebarCollapsed, setSidebarCollapsed } from '../lib/sidebarState'

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
  // Remembered across pages and reloads (lib/sidebarState): Layout remounts per page.
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(peekSidebarCollapsed)
  useEffect(() => {
    setSidebarCollapsedState(getSidebarCollapsed())
  }, [])
  const toggleSidebar = () => {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    setSidebarCollapsedState(next)
  }
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // Browser tab: "<page> · <active farm>" so members can tell farms apart.
  const { active: activeOrg } = useActiveOrganization()

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
      <Head>
        <title>{documentTitle(title, activeOrg?.name)}</title>
      </Head>
      <Sidebar
        collapsed={sidebarCollapsed && !mobileNavOpen}
        onToggle={toggleSidebar}
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
          {/* Paper shell: page sections stack 28px apart. A page that wraps its
              sections in one element is unaffected. */}
          <QueryBoundary resetKey={router.asPath}>
            <div className="flex min-w-0 flex-col gap-7" data-page-stack>
              {children}
            </div>
          </QueryBoundary>
        </main>
      </div>
      <MobileTabBar onOpenMenu={() => setMobileNavOpen(true)} />
    </div>
  )
}

export default Layout
