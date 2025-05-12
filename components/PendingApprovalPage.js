// components/PendingApprovalPage.js
import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

const PendingApprovalPage = () => {
  const [loading, setLoading] = useState(true)
  const [registration, setRegistration] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    // Check URL for registration ID
    const urlParams = new URLSearchParams(window.location.search)
    const registrationId = urlParams.get('id')

    if (registrationId) {
      fetchRegistrationStatus(registrationId)
    } else {
      setLoading(false)
      setError('No registration ID provided')
    }
  }, [])

  const fetchRegistrationStatus = async (id) => {
    try {
      setLoading(true)

      // Fetch registration status
      const { data, error } = await supabase
        .from('company_registrations')
        .select('*')
        .eq('id', id)
        .single()

      if (error) throw error

      setRegistration(data)
    } catch (error) {
      console.error('Error fetching registration status:', error)
      setError('Failed to fetch registration status')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 font-montserrat">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link
          href="/"
          className="text-indigo-600 hover:text-indigo-800 flex items-center mb-8"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Home
        </Link>

        <div className="bg-white shadow rounded-lg p-8">
          {loading ? (
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            </div>
          ) : error ? (
            <div className="text-center">
              <div className="bg-red-50 text-red-800 p-4 rounded-md mb-6">
                {error}
              </div>
              <Link href="/register-company">
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
                  Register a Company
                </button>
              </Link>
            </div>
          ) : registration ? (
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <h2 className="text-lg font-medium text-gray-900 mb-2">
                Registration Received
              </h2>
              <p className="text-gray-600 mb-6">
                Your company registration for{' '}
                <strong>{registration.name}</strong> has been received and is
                pending approval by our administrators. You will receive an
                email when your registration is approved.
              </p>
              <div className="bg-gray-50 p-4 rounded-md text-sm text-left mb-6">
                <p>
                  <strong>Status:</strong> {registration.status || 'Pending'}
                </p>
                <p>
                  <strong>Submitted:</strong>{' '}
                  {new Date(registration.created_at).toLocaleString()}
                </p>
                {registration.approved_at && (
                  <p>
                    <strong>Approved:</strong>{' '}
                    {new Date(registration.approved_at).toLocaleString()}
                  </p>
                )}
              </div>
              <Link href="/login">
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
                  Go to Login
                </button>
              </Link>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-gray-600 mb-6">No registration found.</p>
              <Link href="/register-company">
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
                  Register a Company
                </button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default PendingApprovalPage
