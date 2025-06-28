// components/Sidebar.js
import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import {
  LayoutDashboard,
  Fish,
  Package,
  Truck,
  Calculator,
  Scale,
  AlertTriangle,
  Droplets,
  Settings,
  Users,
  BarChart2,
  Calendar,
  FileText,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Home,
  Plus,
  ShoppingCart,
  DollarSign,
  TrendingUp,
  ClipboardList,
  Database,
  ChartBar,
  PieChart,
  LineChart,
  Bell,
  Layers,
  LogOut,
  LayoutGrid,
  Target,
  Activity,
  Shield,
  Building,
  FileSpreadsheet,
  Upload,
  CheckCircle,
  Eye,
  Download,
  Clock
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import LogoutConfirmationModal from './LogoutConfirmationModal'
import { useToast } from './Toast'
import { useSelector, useDispatch } from 'react-redux'
import { signOut } from '../store/slices/authSlice'

const Sidebar = () => {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const dispatch = useDispatch()
  const [collapsed, setCollapsed] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    production: true,
    cages: true,
    feed: true,
    inventory: true,
    analytics: true,
    management: true,
    admin: true
  })
  const { showToast } = useToast()

  const toggleSidebar = () => {
    setCollapsed(!collapsed)
  }

  const handleLogout = async () => {
    try {
      await dispatch(signOut())
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

  const isActive = (path) => router.pathname === path

  const menuItems = {
    production: {
      title: 'Production',
      icon: Fish,
      items: [
        { title: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
        { title: 'Daily Entry', path: '/daily-entry', icon: Calendar },
        { title: 'Bi-weekly Entry', path: '/biweekly-entry', icon: Scale },
        { title: 'Bi-weekly Records', path: '/biweekly-records', icon: FileText },
        { title: 'Harvest Data', path: '/harvest', icon: Package },
        { title: 'Harvest Sampling', path: '/harvest-sampling', icon: Target },
        { title: 'Stocking Management', path: '/stocking-management', icon: Activity },
        { title: 'New Stocking', path: '/stocking', icon: Plus },
      ],
    },
    cages: {
      title: 'Cage Management',
      icon: LayoutGrid,
      items: [
        { title: 'All Cages', path: '/cages', icon: Database },
        { title: 'Active Cages', path: '/cages/active', icon: Activity },
        { title: 'Maintenance', path: '/cages/maintenance', icon: AlertTriangle },
        { title: 'Harvest Ready', path: '/cages/harvest-ready', icon: Target },
        { title: 'Analytics', path: '/cages/analytics', icon: BarChart2 },
        { title: 'Settings', path: '/cages/settings', icon: Settings },
        { title: 'Create Cage', path: '/create-cage', icon: Plus },
      ],
    },
    feed: {
      title: 'Feed Management',
      icon: Package,
      items: [
        { title: 'Overview', path: '/feed-management', icon: BarChart2 },
        { title: 'Feed Types', path: '/feed-types', icon: Package },
        { title: 'Feed Suppliers', path: '/feed-suppliers', icon: Truck },
        { title: 'Feed Purchases', path: '/feed-purchases', icon: ShoppingCart },
        { title: 'Feed Analytics', path: '/feed-management/analytics', icon: LineChart },
      ],
    },
    inventory: {
      title: 'Inventory',
      icon: Database,
      items: [
        { title: 'Overview', path: '/inventory/overview', icon: BarChart2 },
        { title: 'Stock Levels', path: '/stock-levels', icon: Package },
        { title: 'Alerts', path: '/inventory-alerts', icon: AlertTriangle },
        { title: 'Transactions', path: '/inventory-transactions', icon: FileText },
        { title: 'Analytics', path: '/inventory/analytics', icon: LineChart },
      ],
    },
    analytics: {
      title: 'Reports & Analytics',
      icon: BarChart2,
      items: [
        { title: 'Production Report', path: '/report', icon: FileSpreadsheet },
        { title: 'Export Data', path: '/export', icon: Download },
        { title: 'Audit Logs', path: '/audit-logs', icon: Eye },
      ],
    },
    management: {
      title: 'Management',
      icon: Settings,
      items: [
        { title: 'User Management', path: '/users', icon: Users },
        { title: 'Company Settings', path: '/company-settings', icon: Building },
        { title: 'Approvals', path: '/approvals', icon: CheckCircle },
        { title: 'Pending Approval', path: '/pending-approval', icon: Clock },
        { title: 'Bulk Upload', path: '/bulk-upload', icon: Upload },
      ],
    },
    admin: {
      title: 'Admin',
      icon: Shield,
      items: [
        { title: 'Admin Dashboard', path: '/admin/admin', icon: LayoutDashboard },
        { title: 'Company Registrations', path: '/admin/company-registrations', icon: Building },
      ],
    },
  }

  return (
    <div className="fixed top-0 left-0 h-screen w-64 bg-gray-900 border-r border-gray-800 flex flex-col z-40">
      {/* Logo and Brand */}
      <div className="p-4 border-b border-gray-800">
        <Link href="/dashboard" className="flex items-center space-x-2">
          <Fish className="h-8 w-8 text-indigo-400" />
          <span className="text-xl font-bold text-white">FishFarm</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {Object.entries(menuItems).map(([key, section]) => (
          <div key={key} className="mb-2">
            <button
              onClick={() => toggleSection(key)}
              className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 focus:outline-none"
            >
              <div className="flex items-center">
                {React.createElement(section.icon, { className: "h-5 w-5 text-indigo-400 mr-2" })}
                {section.title}
              </div>
              {expandedSections[key] ? (
                <ChevronDown className="h-4 w-4 text-gray-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-400" />
              )}
            </button>

            {expandedSections[key] && (
              <div className="mt-1 space-y-1">
                {section.items.map((item) => (
                  <Link
                    key={item.path}
                    href={item.path}
                    className={`flex items-center px-8 py-2 text-sm ${
                      isActive(item.path)
                        ? 'text-white bg-indigo-600'
                        : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    {React.createElement(item.icon, { className: "h-4 w-4 mr-2 text-indigo-400" })}
                    {item.title}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* User Section */}
      <div className="p-4 border-t border-gray-800 bg-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center">
              <Users className="h-5 w-5 text-white" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-white">
                {user?.email?.split('@')[0] || 'Admin User'}
              </p>
              <p className="text-xs text-gray-400">
                {user?.email || 'admin@fishfarm.com'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowLogoutModal(true)}
            className="text-gray-400 hover:text-white"
            title="Logout"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <LogoutConfirmationModal
          isOpen={showLogoutModal}
          onClose={() => setShowLogoutModal(false)}
          onConfirm={handleLogout}
        />
      )}
    </div>
  )
}

export default Sidebar