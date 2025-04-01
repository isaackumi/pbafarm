// pages/users.js (Updated)
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import UserManagement from '../components/UserManagement'

export default function UsersPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-100 font-montserrat">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center mb-6">
            <Link
              href="/dashboard"
              className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              User Management
            </h1>
          </div>

          {/* User Management Component */}
          <UserManagement />
        </div>
      </div>
    </ProtectedRoute>
  )
}
