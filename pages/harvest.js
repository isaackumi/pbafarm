import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import HarvestForm from '../components/HarvestForm'
import SamplingForm from '../components/SamplingForm'
import { harvestRecordService } from '../lib/databaseService'
import { useToast } from '../components/Toast'

const HarvestPage = () => {
  const [harvestRecords, setHarvestRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showHarvestForm, setShowHarvestForm] = useState(false)
  const [showSamplingForm, setShowSamplingForm] = useState(false)
  const [selectedHarvest, setSelectedHarvest] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [dateRange, setDateRange] = useState({
    start: '',
    end: ''
  })
  const { showToast } = useToast()
  const router = useRouter()

  useEffect(() => {
    fetchHarvestRecords()
  }, [])

  const fetchHarvestRecords = async () => {
    try {
      setLoading(true)
      const { data, error } = await harvestRecordService.getHarvestRecords()
      if (error) throw error
      setHarvestRecords(data || [])
    } catch (error) {
      console.error('Error fetching harvest records:', error)
      setError('Failed to fetch harvest records')
      showToast('Error fetching harvest records', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleAddHarvest = () => {
    setShowHarvestForm(true)
    setShowSamplingForm(false)
    setSelectedHarvest(null)
  }

  const handleAddSampling = (harvest) => {
    setSelectedHarvest(harvest)
    setShowSamplingForm(true)
    setShowHarvestForm(false)
  }

  const handleHarvestComplete = () => {
    setShowHarvestForm(false)
    fetchHarvestRecords()
  }

  const handleSamplingComplete = () => {
    setShowSamplingForm(false)
    setSelectedHarvest(null)
    fetchHarvestRecords()
  }

  const handleExport = async () => {
    try {
      const { data, error } = await harvestRecordService.exportHarvestRecords()
      if (error) throw error

      // Convert to CSV
      const headers = Object.keys(data[0])
      const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => row[header]).join(','))
      ].join('\n')

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)
      link.setAttribute('download', `harvest_records_${new Date().toISOString().split('T')[0]}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      console.error('Error exporting harvest records:', error)
      showToast('Error exporting harvest records', 'error')
    }
  }

  const filteredRecords = harvestRecords.filter(record => {
    const matchesSearch = 
      record.cages.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.cages.code.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesDateRange = 
      (!dateRange.start || new Date(record.harvest_date) >= new Date(dateRange.start)) &&
      (!dateRange.end || new Date(record.harvest_date) <= new Date(dateRange.end))

    return matchesSearch && matchesDateRange
  })

  const columns = [
    {
      header: 'Cage',
      accessor: record => `${record.cages.name} (${record.cages.code})`
    },
    {
      header: 'Harvest Date',
      accessor: record => new Date(record.harvest_date).toLocaleDateString()
    },
    {
      header: 'Type',
      accessor: 'harvest_type'
    },
    {
      header: 'Status',
      accessor: 'status'
    },
    {
      header: 'Total Weight (kg)',
      accessor: 'total_weight'
    },
    {
      header: 'Sampling Data',
      accessor: record => record.harvest_sampling ? 'Yes' : 'No'
    },
    {
      header: 'Actions',
      accessor: record => (
        <div className="flex space-x-2">
          <button
            onClick={() => handleAddSampling(record)}
            className="text-indigo-600 hover:text-indigo-900"
            disabled={record.harvest_sampling}
          >
            Add Sampling
          </button>
        </div>
      )
    }
  ]

  return (
    <ProtectedRoute>
      <Layout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-semibold text-gray-900">Harvest Management</h1>
            <div className="flex space-x-4">
              <button
                onClick={handleExport}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Export
              </button>
              <button
                onClick={handleAddHarvest}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Add Harvest
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white shadow rounded-lg p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Search
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by cage name or code"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading harvest records...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <p className="text-red-700">{error}</p>
            </div>
          ) : showHarvestForm ? (
            <div className="bg-white shadow rounded-lg p-6">
              <HarvestForm onComplete={handleHarvestComplete} />
            </div>
          ) : showSamplingForm ? (
            <div className="bg-white shadow rounded-lg p-6">
              <SamplingForm
                harvestId={selectedHarvest.id}
                onComplete={handleSamplingComplete}
              />
            </div>
          ) : (
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {columns.map((column, index) => (
                      <th
                        key={index}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {column.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredRecords.map((record, index) => (
                    <tr key={record.id}>
                      {columns.map((column, index) => (
                        <td
                          key={index}
                          className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                        >
                          {column.accessor(record)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Layout>
    </ProtectedRoute>
  )
}

export default HarvestPage 