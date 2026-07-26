// pages/users.js (Updated)
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import UserManagement from '../components/UserManagement'

export default function UsersPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <div className="min-h-screen bg-foam font-sans">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center mb-6">
            <Link
              href="/dashboard"
              className="text-lagoon-800 hover:text-lagoon-950 flex items-center mr-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-chart-ink">
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
