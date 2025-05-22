// components/Sidebar.js
import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import {
  BarChart,
  AreaChart,
  PieChart,
  LineChart,
  Users,
  Database,
  FileText,
  LogOut,
  Droplets,
  PlusCircle,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Utensils,
  ShoppingCart,
  Package,
  Truck,
  Settings,
  Home,
  Bell,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import LogoutConfirmationModal from './LogoutConfirmationModal'

const Sidebar = ({ activeTab, setActiveTab }) => {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    feed: true,
    operations: false,
    admin: false
  })
  const [notifications, setNotifications] = useState(3) // Example notification count

  const toggleSidebar = () => {
    setCollapsed(!collapsed)
  }

  const handleLogout = async () => {
    const { error } = await signOut()
    if (!error) {
      router.push('/login')
    }
    setShowLogoutModal(false)
  }

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  const renderSectionHeader = (title) => {
    if (collapsed) return null
    return (
      <li className="px-3 py-2 text-xs font-semibold text-indigo-300 uppercase tracking-wider">
        {title}
      </li>
    )
  }

  const renderSectionDivider = () => {
    if (!collapsed) return null
    return <li className="py-2 border-t border-indigo-800 mx-3 my-2"></li>
  }

  const renderTooltip = (text) => {
    if (!collapsed) return null
    return (
      <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
        {text}
      </div>
    )
  }

  const isActive = (path) => {
    return router.pathname === path
  }

  return (
    <div
      className={`${
        collapsed ? 'w-16' : 'w-64'
      } bg-indigo-900 text-white flex flex-col transition-all duration-300 ease-in-out relative`}
    >
      {/* Toggle button */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-12 bg-indigo-900 text-white rounded-full p-1 shadow-md z-10 hidden md:block hover:bg-indigo-800 transition-colors"
        title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronLeft className="w-4 h-4" />
        )}
      </button>

      {/* Logo and Title */}
      <div
        className={`p-4 border-b border-indigo-800 flex items-center ${
          collapsed ? 'justify-center' : 'space-x-2'
        }`}
      >
        <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-indigo-900 font-bold">FM</span>
        </div>
        {!collapsed && (
          <span className="text-sm font-medium truncate">Farm Management</span>
        )}
      </div>

      {/* Quick Actions */}
      {!collapsed && (
        <div className="px-4 py-2 border-b border-indigo-800">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.push('/notifications')}
              className="relative p-2 text-indigo-200 hover:text-white hover:bg-indigo-800 rounded-lg transition-colors"
            >
              <Bell className="w-5 h-5" />
              {notifications > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                  {notifications}
                </span>
              )}
            </button>
            <button
              onClick={() => router.push('/')}
              className="p-2 text-indigo-200 hover:text-white hover:bg-indigo-800 rounded-lg transition-colors"
            >
              <Home className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Navigation Items */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1">
          {/* Dashboard */}
          <li className="relative group">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center w-full px-4 py-2 text-sm font-medium ${
                activeTab === 'dashboard'
                  ? 'bg-indigo-800 text-white'
                  : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
              } ${collapsed ? 'justify-center' : ''}`}
            >
              <span className={collapsed ? '' : 'mr-3'}>
                <BarChart className="w-5 h-5" />
              </span>
              {!collapsed && <span>Dashboard</span>}
            </button>
            {renderTooltip('Dashboard')}
          </li>

          {/* Operations Section */}
          {renderSectionHeader('Operations')}
          {renderSectionDivider()}
          <li className="relative group">
            <button
              onClick={() => toggleSection('operations')}
              className={`flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white ${
                collapsed ? 'justify-center' : ''
              }`}
            >
              <span className={collapsed ? '' : 'mr-3'}>
                <Droplets className="w-5 h-5" />
              </span>
              {!collapsed && (
                <div className="flex items-center justify-between w-full">
                  <span>Cage Operations</span>
                  <ChevronRight
                    className={`w-4 h-4 transition-transform ${
                      expandedSections.operations ? 'transform rotate-90' : ''
                    }`}
                  />
                </div>
              )}
            </button>
            {renderTooltip('Cage Operations')}
          </li>
          {!collapsed && expandedSections.operations && (
            <ul className="ml-8 space-y-1">
              <li className="relative group">
                <Link href="/cages">
                  <div className={`flex items-center px-4 py-2 text-sm font-medium ${
                    isActive('/cages') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                  } cursor-pointer`}>
                    <Droplets className="w-4 h-4 mr-3" />
                    <span>Cages</span>
                  </div>
                </Link>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('daily')}
                  className="flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white"
                >
                  <AreaChart className="w-4 h-4 mr-3" />
                  <span>Daily Entry</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('biweekly')}
                  className="flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white"
                >
                  <LineChart className="w-4 h-4 mr-3" />
                  <span>Biweekly ABW</span>
                </button>
              </li>
              <li>
                <Link href="/harvest">
                  <div className="flex items-center px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer">
                    <PieChart className="w-4 h-4 mr-3" />
                    <span>Harvest Data</span>
                  </div>
                </Link>
              </li>
              <li>
                <Link href="/bulk-upload">
                  <div className="flex items-center px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer">
                    <CloudUpload className="w-4 h-4 mr-3" />
                    <span>Bulk Upload</span>
                  </div>
                </Link>
              </li>
            </ul>
          )}

          {/* Feed Management Section */}
          {renderSectionHeader('Feed Management')}
          {renderSectionDivider()}
          <li>
            <button
              onClick={() => toggleSection('feed')}
              className={`flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white ${
                collapsed ? 'justify-center' : ''
              }`}
            >
              <span className={collapsed ? '' : 'mr-3'}>
                <Utensils className="w-5 h-5" />
              </span>
              {!collapsed && (
                <div className="flex items-center justify-between w-full">
                  <span>Feed Management</span>
                  <ChevronRight
                    className={`w-4 h-4 transition-transform ${
                      expandedSections.feed ? 'transform rotate-90' : ''
                    }`}
                  />
                </div>
              )}
            </button>
          </li>
          {!collapsed && expandedSections.feed && (
            <ul className="ml-8 space-y-1">
              <li>
                <Link href="/feed-management">
                  <div className="flex items-center px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer">
                    <Package className="w-4 h-4 mr-3" />
                    <span>Feed Types</span>
                  </div>
                </Link>
              </li>
              <li>
                <Link href="/feed-suppliers">
                  <div className="flex items-center px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer">
                    <Truck className="w-4 h-4 mr-3" />
                    <span>Suppliers</span>
                  </div>
                </Link>
              </li>
              <li>
                <Link href="/feed-purchases">
                  <div className="flex items-center px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer">
                    <ShoppingCart className="w-4 h-4 mr-3" />
                    <span>Purchases</span>
                  </div>
                </Link>
              </li>
              <li>
                <Link href="/feed-inventory">
                  <div className="flex items-center px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer">
                    <Database className="w-4 h-4 mr-3" />
                    <span>Inventory</span>
                  </div>
                </Link>
              </li>
            </ul>
          )}

          {/* Admin Section */}
          {renderSectionHeader('Admin')}
          {renderSectionDivider()}
          <li>
            <button
              onClick={() => toggleSection('admin')}
              className={`flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white ${
                collapsed ? 'justify-center' : ''
              }`}
            >
              <span className={collapsed ? '' : 'mr-3'}>
                <Settings className="w-5 h-5" />
              </span>
              {!collapsed && (
                <div className="flex items-center justify-between w-full">
                  <span>Administration</span>
                  <ChevronRight
                    className={`w-4 h-4 transition-transform ${
                      expandedSections.admin ? 'transform rotate-90' : ''
                    }`}
                  />
                </div>
              )}
            </button>
          </li>
          {!collapsed && expandedSections.admin && (
            <ul className="ml-8 space-y-1">
              <li>
                <Link href="/reports">
                  <div className="flex items-center px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer">
                    <FileText className="w-4 h-4 mr-3" />
                    <span>Reports</span>
                  </div>
                </Link>
              </li>
              <li>
                <Link href="/export">
                  <div className="flex items-center px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer">
                    <Database className="w-4 h-4 mr-3" />
                    <span>Export Data</span>
                  </div>
                </Link>
              </li>
              <li>
                <Link href="/create-cage">
                  <div className="flex items-center px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer">
                    <PlusCircle className="w-4 h-4 mr-3" />
                    <span>New Cage</span>
                  </div>
                </Link>
              </li>
            </ul>
          )}

          {/* User Section */}
          {renderSectionHeader('User')}
          {renderSectionDivider()}
          <li>
            <Link href="/users">
              <div
                className={`flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer ${
                  collapsed ? 'justify-center' : ''
                }`}
              >
                <span className={collapsed ? '' : 'mr-3'}>
                  <Users className="w-5 h-5" />
                </span>
                {!collapsed && <span>User Management</span>}
              </div>
            </Link>
          </li>
        </ul>
      </nav>

      {/* User Profile and Logout */}
      <div
        className={`p-4 border-t border-indigo-800 ${
          collapsed ? 'flex justify-center' : ''
        }`}
      >
        {collapsed ? (
          <div className="relative group">
            <button
              onClick={() => setShowLogoutModal(true)}
              className="text-indigo-200 hover:text-white transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
            {renderTooltip('Logout')}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold">
                  {user?.email?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
              <div>
                <div className="text-sm font-medium truncate max-w-[120px]">
                  {user?.user_metadata?.full_name || user?.email}
                </div>
                <div className="text-xs text-indigo-300">
                  {user?.role || 'User'}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowLogoutModal(true)}
              className="text-indigo-200 hover:text-white transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* Logout Confirmation Modal */}
      <LogoutConfirmationModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={handleLogout}
      />
    </div>
  )
}

export default Sidebar
