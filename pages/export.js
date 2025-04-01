// pages/export.js
import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { ArrowLeft, Download, Database, FileDown } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { supabase } from '../lib/supabase'

export default function ExportPage() {
  return (
    <ProtectedRoute>
      <ExportData />
    </ProtectedRoute>
  )
}

function ExportData() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [exportType, setExportType] = useState('cages')
  const [format, setFormat] = useState('csv')
  const [dateRange, setDateRange] = useState({
    startDate: new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
  })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const handleDateRangeChange = (e) => {
    setDateRange({
      ...dateRange,
      [e.target.name]: e.target.value,
    })
  }

  const handleExport = async () => {
    setLoading(true)
    setError('')
    setMessage('')

    try {
      // Validate inputs
      if (!dateRange.startDate || !dateRange.endDate) {
        throw new Error('Please select a date range')
      }

      // Fetch data based on export type
      let data = []

      switch (exportType) {
        case 'cages':
          const { data: cagesData, error: cagesError } = await supabase
            .from('cages')
            .select('*')

          if (cagesError) throw cagesError
          data = cagesData
          break

        case 'daily':
          const { data: dailyData, error: dailyError } = await supabase
            .from('daily_records')
            .select('*')
            .gte('date', dateRange.startDate)
            .lte('date', dateRange.endDate)

          if (dailyError) throw dailyError
          data = dailyData
          break

        case 'biweekly':
          const {
            data: biweeklyData,
            error: biweeklyError,
          } = await supabase
            .from('biweekly_records')
            .select('*')
            .gte('date', dateRange.startDate)
            .lte('date', dateRange.endDate)

          if (biweeklyError) throw biweeklyError
          data = biweeklyData
          break

        case 'harvest':
          const {
            data: harvestData,
            error: harvestError,
          } = await supabase
            .from('harvest_records')
            .select('*')
            .gte('harvest_date', dateRange.startDate)
            .lte('harvest_date', dateRange.endDate)

          if (harvestError) throw harvestError
          data = harvestData
          break
      }

      // Create file based on format
      let content, blob, filename

      if (format === 'csv') {
        content = convertToCSV(data)
        blob = new Blob([content], { type: 'text/csv' })
        filename = `${exportType}-${new Date().toISOString().split('T')[0]}.csv`
      } else {
        content = JSON.stringify(data, null, 2)
        blob = new Blob([content], { type: 'application/json' })
        filename = `${exportType}-${
          new Date().toISOString().split('T')[0]
        }.json`
      }

      // Create download link
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      setMessage(`Successfully exported ${data.length} ${exportType} records`)
    } catch (error) {
      console.error('Error exporting data:', error.message)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  // Helper function to convert data to CSV
  const convertToCSV = (data) => {
    if (!data || data.length === 0) return ''

    const header = Object.keys(data[0]).join(',')
    const rows = data.map((row) => {
      return Object.values(row)
        .map((value) => {
          // Handle values that might contain commas
          if (
            typeof value === 'string' &&
            (value.includes(',') || value.includes('"'))
          ) {
            return `"${value.replace(/"/g, '""')}"`
          }
          return value
        })
        .join(',')
    })

    return [header, ...rows].join('\n')
  }

  return (
    <div className="min-h-screen bg-gray-100 font-montserrat">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center mb-6">
          <Link
            href="/dashboard"
            className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Export Data</h1>
        </div>

        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="font-medium text-gray-700">Export Options</h2>
          </div>

          <div className="p-6 space-y-6">
            {message && (
              <div className="bg-green-50 text-green-800 p-4 rounded-md">
                {message}
              </div>
            )}

            {error && (
              <div className="bg-red-50 text-red-800 p-4 rounded-md">
                {error}
              </div>
            )}

            {/* Export Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Data to Export
              </label>
              <select
                value={exportType}
                onChange={(e) => setExportType(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              >
                <option value="cages">Cages</option>
                <option value="daily">Daily Records</option>
                <option value="biweekly">Biweekly ABW Records</option>
                <option value="harvest">Harvest Records</option>
              </select>
            </div>

            {/* Export Format */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Export Format
              </label>
              <div className="flex space-x-4">
                <div className="flex items-center">
                  <input
                    id="format-csv"
                    name="format"
                    type="radio"
                    value="csv"
                    checked={format === 'csv'}
                    onChange={() => setFormat('csv')}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                  />
                  <label
                    htmlFor="format-csv"
                    className="ml-2 text-sm text-gray-700"
                  >
                    CSV
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    id="format-json"
                    name="format"
                    type="radio"
                    value="json"
                    checked={format === 'json'}
                    onChange={() => setFormat('json')}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                  />
                  <label
                    htmlFor="format-json"
                    className="ml-2 text-sm text-gray-700"
                  >
                    JSON
                  </label>
                </div>
              </div>
            </div>

            {/* Date Range */}
            {exportType !== 'cages' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date Range
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      From
                    </label>
                    <input
                      type="date"
                      name="startDate"
                      value={dateRange.startDate}
                      onChange={handleDateRangeChange}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      To
                    </label>
                    <input
                      type="date"
                      name="endDate"
                      value={dateRange.endDate}
                      onChange={handleDateRangeChange}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Export Button */}
            <div>
              <button
                onClick={handleExport}
                disabled={loading}
                className={`w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                  loading
                    ? 'bg-indigo-400'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
              >
                {loading ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Export{' '}
                    {exportType === 'cages'
                      ? 'Cages'
                      : exportType === 'daily'
                      ? 'Daily Records'
                      : exportType === 'biweekly'
                      ? 'Biweekly Records'
                      : 'Harvest Records'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Export Type Descriptions */}
        <div className="mt-6 bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="font-medium text-gray-700">Export Data Types</h2>
          </div>

          <div className="p-6">
            <dl className="space-y-6">
              <div>
                <dt className="text-sm font-medium text-gray-700">Cages</dt>
                <dd className="mt-1 text-sm text-gray-500">
                  Basic information about all cages including name, stocking
                  date, initial count, and status.
                </dd>
              </div>

              <div>
                <dt className="text-sm font-medium text-gray-700">
                  Daily Records
                </dt>
                <dd className="mt-1 text-sm text-gray-500">
                  Daily feeding and mortality records including feed amount,
                  feed type, feed cost, and mortality count.
                </dd>
              </div>

              <div>
                <dt className="text-sm font-medium text-gray-700">
                  Biweekly ABW Records
                </dt>
                <dd className="mt-1 text-sm text-gray-500">
                  Biweekly average body weight measurements including sample
                  size and estimated biomass.
                </dd>
              </div>

              <div>
                <dt className="text-sm font-medium text-gray-700">
                  Harvest Records
                </dt>
                <dd className="mt-1 text-sm text-gray-500">
                  Harvest data including total weight, average body weight, FCR,
                  and size distribution.
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
