import React, { useState, useEffect } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { harvestRecordService, cageService } from '../lib/databaseService'
import { useToast } from '../components/Toast'
import { Download, Filter, Search } from 'lucide-react'
import DataTable from '../components/DataTable'
import HarvestForm from '../components/HarvestForm'

const HarvestPage = () => {
  const [harvestRecords, setHarvestRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedCage, setSelectedCage] = useState(null)
  const [cages, setCages] = useState([])
  const { showToast } = useToast()

  // Fetch harvest records
  const fetchHarvestRecords = async () => {
    try {
      const { data, error } = await harvestRecordService.getAllHarvestRecords()
      if (error) throw error
      setHarvestRecords(data || [])
    } catch (error) {
      console.error('Error fetching harvest records:', error)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  // Fetch active cages
  const fetchActiveCages = async () => {
    try {
      const { data, error } = await cageService.getActiveCages()
      if (error) throw error
      setCages(data || [])
    } catch (error) {
      console.error('Error fetching active cages:', error)
      showToast('Error fetching active cages', 'error')
    }
  }

  useEffect(() => {
    fetchHarvestRecords()
    fetchActiveCages()
  }, [])

  // Table columns configuration
  const columns = [
    {
      Header: 'Cage',
      accessor: 'cages.name',
    },
    {
      Header: 'Harvest Date',
      accessor: 'harvest_date',
      Cell: ({ value }) => new Date(value).toLocaleDateString(),
    },
    {
      Header: 'Total Weight (kg)',
      accessor: 'total_weight',
      Cell: ({ value }) => value.toFixed(2),
    },
    {
      Header: 'Avg Weight (g)',
      accessor: 'average_body_weight',
      Cell: ({ value }) => value.toFixed(1),
    },
    {
      Header: 'Est. Count',
      accessor: 'estimated_count',
    },
    {
      Header: 'FCR',
      accessor: 'fcr',
      Cell: ({ value }) => value.toFixed(2),
    },
    {
      Header: 'Size Range',
      accessor: 'size_breakdown',
      Cell: ({ value }) => {
        if (!value) return 'N/A'
        return value.map((size) => `${size.range}: ${size.percentage}%`).join(', ')
      },
    },
  ]

  // Filter records based on search term and date range
  const filteredRecords = harvestRecords.filter((record) => {
    const matchesSearch =
      record.cages?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.notes?.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesDateRange =
      (!dateRange.start ||
        new Date(record.harvest_date) >= new Date(dateRange.start)) &&
      (!dateRange.end ||
        new Date(record.harvest_date) <= new Date(dateRange.end))

    return matchesSearch && matchesDateRange
  })

  // Export to CSV
  const handleExport = () => {
    const headers = [
      'Cage',
      'Harvest Date',
      'Total Weight (kg)',
      'Average Weight (g)',
      'Estimated Count',
      'FCR',
      'Size Breakdown',
      'Notes',
    ]

    const csvContent = [
      headers.join(','),
      ...filteredRecords.map((record) => [
        record.cages?.name || '',
        new Date(record.harvest_date).toLocaleDateString(),
        record.total_weight.toFixed(2),
        record.average_body_weight.toFixed(1),
        record.estimated_count,
        record.fcr.toFixed(2),
        record.size_breakdown
          ?.map((size) => `${size.range}: ${size.percentage}%`)
          .join('; ') || '',
        record.notes || '',
      ].join(',')),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `harvest_records_${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleAddHarvest = () => {
    setShowAddModal(true)
  }

  const handleCageSelect = (cageId) => {
    setSelectedCage(cageId)
  }

  const handleHarvestComplete = () => {
    setShowAddModal(false)
    setSelectedCage(null)
    fetchHarvestRecords()
    showToast('Harvest record added successfully', 'success')
  }

  return (
    <ProtectedRoute>
      <Layout title="Harvest Data">
        <div className="space-y-6">
          {/* Header with Export button */}
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-semibold text-gray-900">Harvest Data</h1>
            <div className="flex space-x-3">
              <button
                onClick={handleAddHarvest}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Add Harvest
              </button>
              <button
                onClick={handleExport}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Export to CSV
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <input
                type="text"
                placeholder="Search by cage or notes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
            <div>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, start: e.target.value }))
                }
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
            <div>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, end: e.target.value }))
                }
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
          </div>

          {/* Data Table */}
          <DataTable
            columns={columns}
            data={filteredRecords}
            loading={loading}
            error={error}
          />
        </div>

        {/* Add Harvest Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-medium text-gray-900">
                    Add Harvest Record
                  </h2>
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="text-gray-400 hover:text-gray-500"
                  >
                    <span className="sr-only">Close</span>
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="px-6 py-4">
                {!selectedCage ? (
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-gray-700">
                      Select a Cage
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {cages.map((cage) => (
                        <button
                          key={cage.id}
                          onClick={() => handleCageSelect(cage.id)}
                          className="p-4 border border-gray-300 rounded-md hover:border-indigo-500 hover:bg-indigo-50 text-left"
                        >
                          <div className="font-medium text-gray-900">
                            {cage.name}
                          </div>
                          <div className="text-sm text-gray-500">
                            Code: {cage.code}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <HarvestForm
                    cageId={selectedCage}
                    onComplete={handleHarvestComplete}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </Layout>
    </ProtectedRoute>
  )
}

export default HarvestPage 