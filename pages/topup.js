// pages/topup.js
import React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import TopUpForm from '../components/TopUpForm'

export default function TopUpPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-100 font-montserrat">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center mb-6">
            <Link
              href="/stocking-management"
              className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Stocking Management
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              Top-Up Existing Batch
            </h1>
          </div>

          <div className="mb-6">
            <p className="text-gray-600">
              Add additional fish to an existing stocked cage. Top-ups will be
              recorded separately from the original stocking but tracked
              together.
            </p>
          </div>

          <TopUpForm />
        </div>
      </div>
    </ProtectedRoute>
  )
}
