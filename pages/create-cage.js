// pages/create-cage.js
import React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import CreateCageForm from '../components/CreateCageForm'

export default function CreateCagePage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-100 font-montserrat">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center mb-6">
            <Link
              href="/cages"
              className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Cages
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              Create New Cage
            </h1>
          </div>

          <div className="mb-6">
            <p className="text-gray-600">
              Create a new cage by filling out the form below. This creates only
              the physical cage structure. You'll be able to stock it with fish
              in a separate step.
            </p>
          </div>

          <CreateCageForm />
        </div>
      </div>
    </ProtectedRoute>
  )
}
