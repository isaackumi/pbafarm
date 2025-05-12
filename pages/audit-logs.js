import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'

export default function AuditLogsPage() {
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
            <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
          </div>

          <div className="bg-white shadow rounded-lg p-8">
            <p className="text-center text-gray-600">
              Audit logs feature is coming soon.
            </p>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}
