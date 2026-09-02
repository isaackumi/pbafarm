import React, { useState, useEffect } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button } from '../components/ui'
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
  RefreshCw,
  BarChart3,
  FileText,
  Pencil,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import { useToast } from '../components/Toast'

export default function BiweeklyRecords() {
  const { showToast } = useToast()
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
  const [editRecord, setEditRecord] = useState(null)
  const [deleteRecord, setDeleteRecord] = useState(null)
  const [editForm, setEditForm] = useState({
    date: '',
    batch_code: '',
    average_body_weight: '',
    total_fish_count: '',
    total_weight: '',
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
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

  const handleEditRecord = (record) => {
    setEditRecord(record)
    setEditForm({
      date: record.date || '',
      batch_code: record.batch_code || '',
      average_body_weight: record.average_body_weight ?? '',
      total_fish_count: record.total_fish_count ?? '',
      total_weight: record.total_weight ?? '',
    })
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault()
    if (!editRecord) return
    setSaving(true)
    try {
      const { error } = await biweeklyRecordService.updateBiweeklyRecord(
        editRecord.id || editRecord._id,
        {
          date: editForm.date,
          batch_code: editForm.batch_code,
          average_body_weight: Number(editForm.average_body_weight),
          total_fish_count: Number(editForm.total_fish_count),
          total_weight: Number(editForm.total_weight),
        },
      )
      if (error) throw error
      showToast('Biweekly record updated', 'success')
      setEditRecord(null)
      fetchData()
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteRecord) return
    setDeleting(true)
    try {
      const { error } = await biweeklyRecordService.deleteBiweeklyRecord(
        deleteRecord.id || deleteRecord._id,
      )
      if (error) throw error
      showToast('Biweekly record deleted', 'success')
      setDeleteRecord(null)
      fetchData()
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error')
    } finally {
      setDeleting(false)
    }
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
        <Layout title="Bi-weekly Records">
          <div className="page-card p-8">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-lagoon-800 border-t-transparent"></div>
              <p className="mt-4 text-lg text-muted">Loading biweekly records...</p>
            </div>
          </div>
        </Layout>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <Layout title="Bi-weekly Records">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Bi-weekly records' },
          ]}
          description="View and manage all bi-weekly sampling records across your cages."
          related={[
            { label: 'New record', href: '/biweekly-entry' },
            { label: 'Daily entry', href: '/daily-entry' },
            { label: 'Harvest sampling', href: '/harvest-sampling' },
          ]}
          actions={
            <>
              <Button href="/biweekly-entry" size="sm">
                <Plus className="w-4 h-4" />
                New Record
              </Button>
              <button
                onClick={exportData}
                className="inline-flex items-center px-3 py-2 border border-foam-deep text-sm font-semibold rounded-xl text-chart-ink bg-white hover:bg-foam min-h-10"
              >
                <Download className="w-4 h-4 mr-2" />
                Export
              </button>
            </>
          }
        />

            {/* Statistics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
              <div className="bg-white rounded-xl shadow-sm p-6 border border-foam-deep">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <FileText className="h-8 w-8 text-lagoon-800" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-muted">Total Records</p>
                    <p className="text-2xl font-bold text-chart-ink">{stats.totalRecords}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-6 border border-foam-deep">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Fish className="h-8 w-8 text-green-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-muted">Total Fish</p>
                    <p className="text-2xl font-bold text-chart-ink">{stats.totalFish.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-6 border border-foam-deep">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Scale className="h-8 w-8 text-lagoon-800" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-muted">Total Weight</p>
                    <p className="text-2xl font-bold text-chart-ink">{(stats.totalWeight / 1000).toFixed(1)}kg</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-6 border border-foam-deep">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <TrendingUp className="h-8 w-8 text-purple-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-muted">Avg ABW</p>
                    <p className="text-2xl font-bold text-chart-ink">{stats.averageABW.toFixed(1)}g</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-6 border border-foam-deep">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <BarChart3 className="h-8 w-8 text-orange-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-muted">Active Cages</p>
                    <p className="text-2xl font-bold text-chart-ink">{stats.activeCages}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Filters and Search */}
            <div className="bg-white rounded-xl shadow-sm p-6 border border-foam-deep mb-8">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-2">Search</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted" />
                    <input
                      type="text"
                      placeholder="Search by cage or batch code..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 block w-full border-input-border rounded-lg shadow-sm focus:ring-lagoon-800 focus:border-lagoon-800"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-2">Cage</label>
                  <select
                    value={selectedCage}
                    onChange={(e) => setSelectedCage(e.target.value)}
                    className="block w-full border-input-border rounded-lg shadow-sm focus:ring-lagoon-800 focus:border-lagoon-800"
                  >
                    <option value="all">All Cages</option>
                    {cages.map(cage => (
                      <option key={cage.id} value={cage.id}>{cage.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-2">Date Filter</label>
                  <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="block w-full border-input-border rounded-lg shadow-sm focus:ring-lagoon-800 focus:border-lagoon-800"
                  >
                    <option value="all">All Time</option>
                    <option value="recent">Last 30 Days</option>
                    <option value="month">This Month</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={fetchData}
                    className="inline-flex items-center px-4 py-2 border border-input-border text-sm font-medium rounded-lg text-chart-ink bg-white hover:bg-foam-deep/40"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh
                  </button>
                </div>
              </div>
            </div>

            {/* Records Table */}
            <div className="bg-white shadow rounded-xl overflow-hidden border border-foam-deep">
              <div className="px-6 py-4 border-b border-foam-deep">
                <h3 className="text-lg font-medium text-chart-ink">
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
                  <FileText className="mx-auto h-12 w-12 text-muted" />
                  <h3 className="mt-2 text-sm font-medium text-chart-ink">No biweekly records found</h3>
                  <p className="mt-1 text-sm text-muted">
                    Get started by creating your first bi-weekly record.
                  </p>
                  <div className="mt-6">
                    <Link href="/biweekly-entry">
                      <button className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-lagoon-800 hover:bg-lagoon-950">
                        <Plus className="w-4 h-4 mr-2" />
                        Create Record
                      </button>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-foam-deep">
                    <thead className="bg-foam-deep/40">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                          Date
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                          Cage
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                          Batch Code
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                          Total Fish
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                          Total Weight
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                          Average ABW
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                          Samples
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-foam-deep">
                      {filteredRecords.map((record) => (
                        <tr key={record.id} className="hover:bg-foam-deep/40">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <Calendar className="h-4 w-4 text-muted mr-2" />
                              <span className="text-sm font-medium text-chart-ink">
                                {format(new Date(record.date), 'MMM d, yyyy')}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-medium text-chart-ink">
                              {record.cages?.name || 'Unknown Cage'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-mono text-lagoon-800 font-medium">
                              {record.batch_code}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <Fish className="h-4 w-4 text-green-500 mr-2" />
                              <span className="text-sm text-chart-ink">
                                {record.total_fish_count.toLocaleString()}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <Scale className="h-4 w-4 text-blue-500 mr-2" />
                              <span className="text-sm text-chart-ink">
                                {record.total_weight.toFixed(2)}g
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <TrendingUp className="h-4 w-4 text-purple-500 mr-2" />
                              <span className="text-sm font-medium text-chart-ink">
                                {record.average_body_weight.toFixed(2)}g
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-foam-deep text-lagoon-950">
                              {record.biweekly_sampling?.length || 0} samples
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => handleViewDetails(record)}
                                className="text-lagoon-800 hover:text-lagoon-950 flex items-center"
                                title="View"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleEditRecord(record)}
                                className="text-lagoon-800 hover:text-lagoon-950"
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteRecord(record)}
                                className="text-signal hover:opacity-80"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-6 py-4 border-t border-foam-deep">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-chart-ink">
                      Showing page {currentPage} of {totalPages} ({totalCount} total records)
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-2 border border-input-border rounded-md text-sm font-medium text-chart-ink bg-white hover:bg-foam-deep/40 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-2 border border-input-border rounded-md text-sm font-medium text-chart-ink bg-white hover:bg-foam-deep/40 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

        {/* Details Modal */}
        {showDetails && selectedRecord && (
          <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowDetails(false)}></div>
            <div className="relative bg-white rounded-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="px-6 py-4 border-b border-foam-deep">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-chart-ink">Record Details</h3>
                  <button
                    onClick={() => setShowDetails(false)}
                    className="text-muted hover:text-muted"
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
                    <h4 className="text-sm font-medium text-muted mb-2">Record Information</h4>
                    <dl className="space-y-2">
                      <div>
                        <dt className="text-sm font-medium text-chart-ink">Date</dt>
                        <dd className="text-sm text-chart-ink">{format(new Date(selectedRecord.date), 'MMMM d, yyyy')}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-chart-ink">Cage</dt>
                        <dd className="text-sm text-chart-ink">{selectedRecord.cages?.name || 'Unknown'}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-chart-ink">Batch Code</dt>
                        <dd className="text-sm font-mono text-lagoon-800">{selectedRecord.batch_code}</dd>
                      </div>
                    </dl>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-muted mb-2">Summary</h4>
                    <dl className="space-y-2">
                      <div>
                        <dt className="text-sm font-medium text-chart-ink">Total Fish Count</dt>
                        <dd className="text-sm text-chart-ink">{selectedRecord.total_fish_count.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-chart-ink">Total Weight</dt>
                        <dd className="text-sm text-chart-ink">{selectedRecord.total_weight.toFixed(2)}g</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-chart-ink">Average ABW</dt>
                        <dd className="text-sm text-chart-ink">{selectedRecord.average_body_weight.toFixed(2)}g</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                {selectedRecord.biweekly_sampling && selectedRecord.biweekly_sampling.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted mb-4">Sampling Details</h4>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-foam-deep">
                        <thead className="bg-foam-deep/40">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Sample #</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Fish Count</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Total Weight</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Average ABW</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-foam-deep">
                          {selectedRecord.biweekly_sampling.map((sampling, index) => (
                            <tr key={sampling.id}>
                              <td className="px-4 py-3 text-sm text-chart-ink">{sampling.sampling_number}</td>
                              <td className="px-4 py-3 text-sm text-chart-ink">{sampling.fish_count}</td>
                              <td className="px-4 py-3 text-sm text-chart-ink">{sampling.total_weight.toFixed(2)}g</td>
                              <td className="px-4 py-3 text-sm text-chart-ink">{sampling.average_body_weight.toFixed(2)}g</td>
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

        {editRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => !saving && setEditRecord(null)}
            />
            <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-chart-ink mb-4">
                Edit biweekly record
              </h3>
              <form onSubmit={handleSaveEdit} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={editForm.date}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, date: e.target.value }))
                    }
                    className="w-full border border-input-border rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Batch code</label>
                  <input
                    required
                    value={editForm.batch_code}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, batch_code: e.target.value }))
                    }
                    className="w-full border border-input-border rounded-md px-3 py-2 text-sm font-data"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">ABW (g)</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={editForm.average_body_weight}
                      onChange={(e) =>
                        setEditForm((p) => ({
                          ...p,
                          average_body_weight: e.target.value,
                        }))
                      }
                      className="w-full border border-input-border rounded-md px-3 py-2 text-sm font-data"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Fish</label>
                    <input
                      type="number"
                      required
                      value={editForm.total_fish_count}
                      onChange={(e) =>
                        setEditForm((p) => ({
                          ...p,
                          total_fish_count: e.target.value,
                        }))
                      }
                      className="w-full border border-input-border rounded-md px-3 py-2 text-sm font-data"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Weight</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={editForm.total_weight}
                      onChange={(e) =>
                        setEditForm((p) => ({
                          ...p,
                          total_weight: e.target.value,
                        }))
                      }
                      className="w-full border border-input-border rounded-md px-3 py-2 text-sm font-data"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setEditRecord(null)}
                    className="px-4 py-2 border rounded-md text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-lagoon-950 text-white rounded-md text-sm"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {deleteRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => !deleting && setDeleteRecord(null)}
            />
            <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-6 h-6 text-signal" />
                <h3 className="text-lg font-semibold">Delete record</h3>
              </div>
              <p className="text-sm text-muted mb-5">
                Delete batch{' '}
                <span className="font-semibold">{deleteRecord.batch_code}</span> from{' '}
                {deleteRecord.date}? This cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteRecord(null)}
                  className="px-4 py-2 border rounded-md text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 bg-signal text-white rounded-md text-sm"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Layout>
    </ProtectedRoute>
  )
} 