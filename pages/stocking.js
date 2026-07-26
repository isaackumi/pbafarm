// pages/stocking.js
import React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import StockingForm from '../components/StockingForm'

export default function StockingPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-foam font-sans">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center mb-6">
            <Link
              href="/cages"
              className="text-lagoon-800 hover:text-lagoon-950 flex items-center mr-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Cages
            </Link>
            <h1 className="text-2xl font-bold text-chart-ink">
              New Cage Stocking
            </h1>
          </div>

          <div className="mb-6">
            <p className="text-muted">
              Fill in the details below to stock a new cage. Required fields are
              marked with an asterisk (*).
            </p>
          </div>

          <StockingForm />
        </div>
      </div>
    </ProtectedRoute>
  )
}
