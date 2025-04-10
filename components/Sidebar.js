// components/Sidebar.js (Collapsible version)
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
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const Sidebar = ({ activeTab, setActiveTab }) => {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)

  const toggleSidebar = () => {
    setCollapsed(!collapsed)
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
        className="absolute -right-3 top-12 bg-indigo-900 text-white rounded-full p-1 shadow-md z-10 hidden md:block"
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
          <span className="text-sm font-medium truncate">
            PBA Farm Management
          </span>
        )}
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1">
          <li>
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
          </li>
          <li>
            <Link href="/cages">
              <div
                className={`flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer ${
                  collapsed ? 'justify-center' : ''
                }`}
              >
                <span className={collapsed ? '' : 'mr-3'}>
                  <Droplets className="w-5 h-5" />
                </span>
                {!collapsed && <span>Cages</span>}
              </div>
            </Link>
          </li>
          <li>
            <button
              onClick={() => setActiveTab('daily')}
              className={`flex items-center w-full px-4 py-2 text-sm font-medium ${
                activeTab === 'daily'
                  ? 'bg-indigo-800 text-white'
                  : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
              } ${collapsed ? 'justify-center' : ''}`}
            >
              <span className={collapsed ? '' : 'mr-3'}>
                <AreaChart className="w-5 h-5" />
              </span>
              {!collapsed && <span>Daily Data Entry</span>}
            </button>
          </li>
          <li>
            <button
              onClick={() => setActiveTab('biweekly')}
              className={`flex items-center w-full px-4 py-2 text-sm font-medium ${
                activeTab === 'biweekly'
                  ? 'bg-indigo-800 text-white'
                  : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
              } ${collapsed ? 'justify-center' : ''}`}
            >
              <span className={collapsed ? '' : 'mr-3'}>
                <LineChart className="w-5 h-5" />
              </span>
              {!collapsed && <span>Biweekly ABW</span>}
            </button>
          </li>
          <li>
            <button
              onClick={() => setActiveTab('harvest')}
              className={`flex items-center w-full px-4 py-2 text-sm font-medium ${
                activeTab === 'harvest'
                  ? 'bg-indigo-800 text-white'
                  : 'text-indigo-100 hover:bg-indigo-800 hover:text-white'
              } ${collapsed ? 'justify-center' : ''}`}
            >
              <span className={collapsed ? '' : 'mr-3'}>
                <PieChart className="w-5 h-5" />
              </span>
              {!collapsed && <span>Harvest Data</span>}
            </button>
          </li>

          {!collapsed && (
            <li className="px-3 py-2 text-xs font-semibold text-indigo-300 uppercase tracking-wider">
              Admin
            </li>
          )}
          {collapsed && (
            <li className="py-2 border-t border-indigo-800 mx-3 my-2"></li>
          )}
          <li>
            <Link href="/reports">
              <div
                className={`flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer ${
                  collapsed ? 'justify-center' : ''
                }`}
              >
                <span className={collapsed ? '' : 'mr-3'}>
                  <FileText className="w-5 h-5" />
                </span>
                {!collapsed && <span>Reports</span>}
              </div>
            </Link>
          </li>
          <li>
            <Link href="/export">
              <div
                className={`flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer ${
                  collapsed ? 'justify-center' : ''
                }`}
              >
                <span className={collapsed ? '' : 'mr-3'}>
                  <Database className="w-5 h-5" />
                </span>
                {!collapsed && <span>Export Data</span>}
              </div>
            </Link>
          </li>
          <li>
            <Link href="/stocking">
              <div
                className={`flex items-center w-full px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-800 hover:text-white cursor-pointer ${
                  collapsed ? 'justify-center' : ''
                }`}
              >
                <span className={collapsed ? '' : 'mr-3'}>
                  <PlusCircle className="w-5 h-5" />
                </span>
                {!collapsed && <span>New Cage</span>}
              </div>
            </Link>
          </li>

          {!collapsed && (
            <li className="px-3 py-2 text-xs font-semibold text-indigo-300 uppercase tracking-wider">
              Super Admin
            </li>
          )}
          {collapsed && (
            <li className="py-2 border-t border-indigo-800 mx-3 my-2"></li>
          )}
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
          <button
            onClick={signOut}
            className="text-indigo-200 hover:text-white"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
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
              onClick={signOut}
              className="text-indigo-200 hover:text-white"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default Sidebar
