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
import { useToast } from './Toast'

const Sidebar = ({ activeTab }) => {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    feed: false,
    operations: false,
    admin: false
  })
  const { showToast } = useToast()

  const toggleSidebar = () => {
    setCollapsed(!collapsed)
  }

  const handleLogout = async () => {
    try {
      await signOut()
      showToast('Logged out successfully', 'success')
      router.push('/login')
    } catch (error) {
      console.error('Logout failed:', error)
      showToast('Logout failed', 'error')
    } finally {
      setShowLogoutModal(false)
    }
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

      {/* Navigation Items */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1">
          {/* Dashboard */}
          <li className={`relative group ${isActive('/dashboard') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
            <Link href="/dashboard" className={`flex items-center w-full px-4 py-2 text-sm font-medium ${
              activeTab === 'dashboard'
                ? 'bg-indigo-800 text-white'
                : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
            } ${collapsed ? 'justify-center' : ''}`}>
              <span className={collapsed ? '' : 'mr-3'}>
                <BarChart className="w-5 h-5" />
              </span>
              {!collapsed && <span>Dashboard</span>}
            </Link>
            {renderTooltip('Dashboard')}
            <div className={`${isActive('/dashboard') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
          </li>

          {/* Operations Section */}
          {renderSectionHeader('Operations')}
          {renderSectionDivider()}
          <li className={`relative group ${isActive('/cages') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
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
            <div className={`${isActive('/cages') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
          </li>
          {!collapsed && expandedSections.operations && (
            <ul className="ml-8 space-y-1">
              <li className={`relative group ${isActive('/cages') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
                <Link href="/cages" className={`flex items-center px-4 py-2 text-sm font-medium ${
                  isActive('/cages') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                } cursor-pointer`}>
                  <Droplets className="w-4 h-4 mr-3" />
                  <span>Cages</span>
                </Link>
                <div className={`${isActive('/cages') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
              </li>
              <li>
                <Link href="/stocking" className="flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white">
                  <Package className="w-4 h-4 mr-3" />
                  <span>Stocking</span>
                </Link>
              </li>
              <li>
                <Link href="/daily-data" className="flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white">
                  <Utensils className="w-4 h-4 mr-3" />
                  <span>Daily Data</span>
                </Link>
              </li>
              <li>
                <Link href="/biweekly-data" className="flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white">
                  <LineChart className="w-4 h-4 mr-3" />
                  <span>Biweekly ABW</span>
                </Link>
              </li>
            </ul>
          )}

          {/* Feed Management Section */}
          {renderSectionHeader('Feed Management')}
          {renderSectionDivider()}
          <li className={`relative group ${isActive('/feed-management') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
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
            {renderTooltip('Feed Management')}
            <div className={`${isActive('/feed-management') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
          </li>
          {!collapsed && expandedSections.feed && (
            <ul className="ml-8 space-y-1">
              <li className={`relative group ${isActive('/feed-management') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
                <Link href="/feed-management" className={`flex items-center px-4 py-2 text-sm font-medium ${
                  isActive('/feed-management') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                } cursor-pointer`}>
                  <Package className="w-4 h-4 mr-3" />
                  <span>Feed Types</span>
                </Link>
                <div className={`${isActive('/feed-management') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
              </li>
              <li className={`relative group ${isActive('/suppliers') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
                <Link href="/suppliers" className={`flex items-center px-4 py-2 text-sm font-medium ${
                  isActive('/suppliers') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                } cursor-pointer`}>
                  <Truck className="w-4 h-4 mr-3" />
                  <span>Suppliers</span>
                </Link>
                <div className={`${isActive('/suppliers') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
              </li>
              <li className={`relative group ${isActive('/purchases') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
                <Link href="/purchases" className={`flex items-center px-4 py-2 text-sm font-medium ${
                  isActive('/purchases') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                } cursor-pointer`}>
                  <ShoppingCart className="w-4 h-4 mr-3" />
                  <span>Purchases</span>
                </Link>
                <div className={`${isActive('/purchases') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
              </li>
              <li className={`relative group ${isActive('/inventory') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
                <Link href="/inventory" className={`flex items-center px-4 py-2 text-sm font-medium ${
                  isActive('/inventory') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                } cursor-pointer`}>
                  <Database className="w-4 h-4 mr-3" />
                  <span>Inventory</span>
                </Link>
                <div className={`${isActive('/inventory') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
              </li>
            </ul>
          )}

          {/* Admin Section */}
          {renderSectionHeader('Admin')}
          {renderSectionDivider()}
          <li className={`relative group ${isActive('/reports') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
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
            {renderTooltip('Administration')}
            <div className={`${isActive('/reports') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
          </li>
          {!collapsed && expandedSections.admin && (
            <ul className="ml-8 space-y-1">
              <li className={`relative group ${isActive('/reports') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
                <Link href="/reports" className={`flex items-center px-4 py-2 text-sm font-medium ${
                  isActive('/reports') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                } cursor-pointer`}>
                  <FileText className="w-4 h-4 mr-3" />
                  <span>Reports</span>
                </Link>
                <div className={`${isActive('/reports') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
              </li>
              <li className={`relative group ${isActive('/export') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
                <Link href="/export" className={`flex items-center px-4 py-2 text-sm font-medium ${
                  isActive('/export') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                } cursor-pointer`}>
                  <Database className="w-4 h-4 mr-3" />
                  <span>Export Data</span>
                </Link>
                <div className={`${isActive('/export') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
              </li>
              <li className={`relative group ${isActive('/new-cage') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
                <Link href="/new-cage" className={`flex items-center px-4 py-2 text-sm font-medium ${
                  isActive('/new-cage') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
                } cursor-pointer`}>
                  <PlusCircle className="w-4 h-4 mr-3" />
                  <span>New Cage</span>
                </Link>
                <div className={`${isActive('/new-cage') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
              </li>
            </ul>
          )}

          {/* User Section */}
          {renderSectionHeader('User')}
          {renderSectionDivider()}
          <li className={`relative group ${isActive('/user-management') ? 'bg-indigo-800 text-white' : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'}`}>
            <Link href="/user-management" className={`flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer ${
              collapsed ? 'justify-center' : ''
            }`}>
              <span className={collapsed ? '' : 'mr-3'}>
                <Users className="w-5 h-5" />
              </span>
              {!collapsed && <span>User Management</span>}
            </Link>
            <div className={`${isActive('/user-management') ? 'absolute left-0 top-0 h-full w-1 bg-yellow-400 rounded-r' : ''}`}></div>
          </li>
        </ul>
      </nav>

      {/* Logout Confirmation Modal */}
      <LogoutConfirmationModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={handleLogout}
      />

      {!collapsed && (
        <div className="px-4 py-2 text-xs text-indigo-300 border-t border-indigo-800 mt-2">
          Farm Management v1.0.0<br />
          © 2024 Your Company
        </div>
      )}
    </div>
  )
}

export default Sidebar
