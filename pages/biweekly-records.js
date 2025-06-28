import React, { useState, useEffect } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { biweeklyRecordService, cageService } from '../lib/databaseService'
import {
  Search,
  Filter,
  Calendar,
  Fish,
  Scale,
  TrendingUp,
  Eye,
  Download,
  Plus,
  ArrowLeft,
  RefreshCw,
  BarChart3,
  FileText,
} from 'lucide-react'

export default function BiweeklyRecords() {
  const [records, setRecords] = useState([])
  const [cages, setCages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCage, setSelectedCage] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [showDetails, setShowDetails] = useState(false)
  const [stats, setStats] = useState({
    totalRecords: 0,
    totalFish: 0,
    totalWeight: 0,
    averageABW: 0,
    activeCages: 0
  })

  useEffect(() => {
    fetchData()
  }, [currentPage, selectedCage, dateFilter])

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)

      // Fetch cages for filter
      const { data: cagesData } = await cageService.getAllCages()
      setCages(cagesData || [])

      // Fetch biweekly records with pagination
      const { data, error, totalCount: count, totalPages: pages } = 
        await biweeklyRecordService.getBiweeklyRecordsPaginated(currentPage, 20)

      if (error) {
        console.error('Error fetching biweekly records:', error)
        setError('Failed to load biweekly records')
        return
      }

      setRecords(data || [])
      setTotalCount(count || 0)
      setTotalPages(pages || 1)

      // Calculate stats
      calculateStats(data || [])
    } catch (error) {
      console.error('Error fetching biweekly records:', error)
      setError('Failed to load biweekly records')
    } finally {
      setLoading(false)
    }
  }

  const calculateStats = (recordsData) => {
    const totalRecords = recordsData.length
    const totalFish = recordsData.reduce((sum, record) => sum + (record.total_fish_count || 0), 0)
    const totalWeight = recordsData.reduce((sum, record) => sum + (record.total_weight || 0), 0)
    const averageABW = recordsData.length > 0 
      ? recordsData.reduce((sum, record) => sum + (record.average_body_weight || 0), 0) / recordsData.length 
      : 0
    const activeCages = new Set(recordsData.map(record => record.cage_id)).size

    setStats({
      totalRecords,
      totalFish,
      totalWeight,
      averageABW,
      activeCages
    })
  }

  const filteredRecords = records.filter(record => {
    const matchesSearch = searchTerm === '' || 
      record.batch_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.cages?.name?.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesCage = selectedCage === 'all' || record.cage_id === selectedCage
    
    const matchesDate = dateFilter === 'all' || 
      (dateFilter === 'recent' && new Date(record.date) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) ||
      (dateFilter === 'month' && new Date(record.date).getMonth() === new Date().getMonth())

    return matchesSearch && matchesCage && matchesDate
  })

  const handleViewDetails = (record) => {
    setSelectedRecord(record)
    setShowDetails(true)
  }

  const exportData = () => {
    const csvContent = [
      ['Date', 'Cage', 'Batch Code', 'Total Fish', 'Total Weight (g)', 'Average ABW (g)', 'Samples'],
      ...filteredRecords.map(record => [
        format(new Date(record.date), 'yyyy-MM-dd'),
        record.cages?.name || 'Unknown',
        record.batch_code,
        record.total_fish_count,
        record.total_weight,
        record.average_body_weight,
        record.biweekly_sampling?.length || 0
      ])
    ].map(row => row.join(',')).join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `biweekly-records-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <ProtectedRoute>
        <Layout>
          <div className="min-h-screen bg-gray-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <div className="bg-white shadow rounded-lg p-8">
                <div className="text-center">
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
                  <p className="mt-4 text-lg text-gray-600">Loading biweekly records...</p>
                </div>
              </div>
            </div>
          </div>
        </Layout>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <Layout>
        <div className="min-h-screen bg-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <Link href="/dashboard">
                    <button className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4">
                      <ArrowLeft className="w-4 h-4 mr-1" />
                      Back to Dashboard
                    </button>
                  </Link>
                  <h1 className="text-3xl font-bold text-gray-900">Bi-weekly Records</h1>
                </div>
                <div className="flex space-x-3">
                  <Link href="/biweekly-entry">
                    <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700">
                      <Plus className="w-4 h-4 mr-2" />
                      New Record
                    </button>
                  </Link>
                  <button
                    onClick={exportData}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </button>
                </div>
              </div>
              <p className="text-gray-600">
                View and manage all bi-weekly sampling records across your cages
              </p>
            </div>

            {/* Statistics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
              <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <FileText className="h-8 w-8 text-indigo-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Total Records</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.totalRecords}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Fish className="h-8 w-8 text-green-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Total Fish</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.totalFish.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Scale className="h-8 w-8 text-blue-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Total Weight</p>
                    <p className="text-2xl font-bold text-gray-900">{(stats.totalWeight / 1000).toFixed(1)}kg</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <TrendingUp className="h-8 w-8 text-purple-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Avg ABW</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.averageABW.toFixed(1)}g</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <BarChart3 className="h-8 w-8 text-orange-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Active Cages</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.activeCages}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Filters and Search */}
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 mb-8">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search by cage or batch code..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 block w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Cage</label>
                  <select
                    value={selectedCage}
                    onChange={(e) => setSelectedCage(e.target.value)}
                    className="block w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="all">All Cages</option>
                    {cages.map(cage => (
                      <option key={cage.id} value={cage.id}>{cage.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Date Filter</label>
                  <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="block w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="all">All Time</option>
                    <option value="recent">Last 30 Days</option>
                    <option value="month">This Month</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={fetchData}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh
                  </button>
                </div>
              </div>
            </div>

            {/* Records Table */}
            <div className="bg-white shadow rounded-xl overflow-hidden border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">
                  Bi-weekly Records ({filteredRecords.length})
                </h3>
              </div>

              {error && (
                <div className="p-6">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-red-800">Error</h3>
                        <div className="mt-2 text-sm text-red-700">
                          <p>{error}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {filteredRecords.length === 0 ? (
                <div className="p-12 text-center">
                  <FileText className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No biweekly records found</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Get started by creating your first bi-weekly record.
                  </p>
                  <div className="mt-6">
                    <Link href="/biweekly-entry">
                      <button className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700">
                        <Plus className="w-4 h-4 mr-2" />
                        Create Record
                      </button>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Date
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Cage
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Batch Code
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Total Fish
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Total Weight
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Average ABW
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Samples
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredRecords.map((record) => (
                        <tr key={record.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                              <span className="text-sm font-medium text-gray-900">
                                {format(new Date(record.date), 'MMM d, yyyy')}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-medium text-gray-900">
                              {record.cages?.name || 'Unknown Cage'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-mono text-indigo-600 font-medium">
                              {record.batch_code}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <Fish className="h-4 w-4 text-green-500 mr-2" />
                              <span className="text-sm text-gray-900">
                                {record.total_fish_count.toLocaleString()}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <Scale className="h-4 w-4 text-blue-500 mr-2" />
                              <span className="text-sm text-gray-900">
                                {record.total_weight.toFixed(2)}g
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <TrendingUp className="h-4 w-4 text-purple-500 mr-2" />
                              <span className="text-sm font-medium text-gray-900">
                                {record.average_body_weight.toFixed(2)}g
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                              {record.biweekly_sampling?.length || 0} samples
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <button
                              onClick={() => handleViewDetails(record)}
                              className="text-indigo-600 hover:text-indigo-900 flex items-center"
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              View Details
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-6 py-4 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-700">
                      Showing page {currentPage} of {totalPages} ({totalCount} total records)
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Details Modal */}
        {showDetails && selectedRecord && (
          <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowDetails(false)}></div>
            <div className="relative bg-white rounded-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-gray-900">Record Details</h3>
                  <button
                    onClick={() => setShowDetails(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-2">Record Information</h4>
                    <dl className="space-y-2">
                      <div>
                        <dt className="text-sm font-medium text-gray-700">Date</dt>
                        <dd className="text-sm text-gray-900">{format(new Date(selectedRecord.date), 'MMMM d, yyyy')}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-700">Cage</dt>
                        <dd className="text-sm text-gray-900">{selectedRecord.cages?.name || 'Unknown'}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-700">Batch Code</dt>
                        <dd className="text-sm font-mono text-indigo-600">{selectedRecord.batch_code}</dd>
                      </div>
                    </dl>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-2">Summary</h4>
                    <dl className="space-y-2">
                      <div>
                        <dt className="text-sm font-medium text-gray-700">Total Fish Count</dt>
                        <dd className="text-sm text-gray-900">{selectedRecord.total_fish_count.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-700">Total Weight</dt>
                        <dd className="text-sm text-gray-900">{selectedRecord.total_weight.toFixed(2)}g</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-700">Average ABW</dt>
                        <dd className="text-sm text-gray-900">{selectedRecord.average_body_weight.toFixed(2)}g</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                {selectedRecord.biweekly_sampling && selectedRecord.biweekly_sampling.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-4">Sampling Details</h4>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sample #</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fish Count</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Weight</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Average ABW</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {selectedRecord.biweekly_sampling.map((sampling, index) => (
                            <tr key={sampling.id}>
                              <td className="px-4 py-3 text-sm text-gray-900">{sampling.sampling_number}</td>
                              <td className="px-4 py-3 text-sm text-gray-900">{sampling.fish_count}</td>
                              <td className="px-4 py-3 text-sm text-gray-900">{sampling.total_weight.toFixed(2)}g</td>
                              <td className="px-4 py-3 text-sm text-gray-900">{sampling.average_body_weight.toFixed(2)}g</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Layout>
    </ProtectedRoute>
  )
} 