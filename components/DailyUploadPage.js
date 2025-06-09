// components/DailyUploadPage.js
import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import DailyEntryForm from './DailyEntryForm'
import { cageService } from '../lib/databaseService'

const statusColors = {
  active: 'bg-green-100 text-green-800',
  harvested: 'bg-blue-100 text-blue-800',
  harvesting: 'bg-orange-100 text-orange-800',
  maintenance: 'bg-yellow-100 text-yellow-800',
  fallow: 'bg-gray-100 text-gray-800',
  empty: 'bg-purple-100 text-purple-800',
}

const DailyUploadPage = () => {
  const [cages, setCages] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCage, setSelectedCage] = useState(null)

  useEffect(() => {
    async function fetchCages() {
      setLoading(true)
      const { data, error } = await cageService.getAllCages()
      setCages(data || [])
      setLoading(false)
    }
    fetchCages()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-lg text-gray-700">Loading cages...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 font-montserrat">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center mb-6">
          <Link
            href="/dashboard"
            className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
          >
            <ArrowLeft className="w-5 h-5 mr-1" />
            Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            Daily Records Upload
          </h1>
        </div>
        {!selectedCage ? (
          <div className="">
            <div className="mb-6">
              <p className="text-gray-600">
                Select a cage to enter daily records. Only active cages are shown.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {cages.filter(cage => cage.status === 'active').map(cage => (
                <button
                  key={cage.id}
                  onClick={() => setSelectedCage(cage)}
                  className="bg-white rounded-lg shadow hover:shadow-lg transition p-6 flex flex-col items-start border border-gray-200 hover:border-indigo-400 focus:outline-none"
                >
                  <div className="flex items-center mb-2 w-full justify-between">
                    <span className="text-lg font-semibold text-gray-900">{cage.name}</span>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[cage.status] || 'bg-gray-100 text-gray-800'}`}>{cage.status.charAt(0).toUpperCase() + cage.status.slice(1)}</span>
                  </div>
                  <div className="text-sm text-gray-500 mb-1">Code: <span className="font-mono">{cage.code}</span></div>
                  {cage.location && <div className="text-xs text-gray-400 mb-1">Location: {cage.location}</div>}
                  {cage.capacity && <div className="text-xs text-gray-400">Capacity: {cage.capacity}</div>}
                </button>
              ))}
            </div>
            {cages.filter(cage => cage.status === 'active').length === 0 && (
              <div className="text-gray-500 mt-8 text-center">No active cages available.</div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-6">
            <button
              onClick={() => setSelectedCage(null)}
              className="mb-4 text-indigo-600 hover:text-indigo-800 flex items-center"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Cage Selection
            </button>
            <div className="mb-4">
              <div className="text-lg font-semibold text-gray-900">{selectedCage.name} <span className="text-xs text-gray-500">({selectedCage.code})</span></div>
              <div className="text-xs text-gray-500">Location: {selectedCage.location || 'N/A'} | Capacity: {selectedCage.capacity || 'N/A'}</div>
            </div>
            <DailyEntryForm cage={selectedCage} />
          </div>
        )}
      </div>
    </div>
  )
}

export default DailyUploadPage
