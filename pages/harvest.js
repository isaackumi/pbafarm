import React, { useState, useEffect } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button } from '../components/ui'
import HarvestForm from '../components/HarvestForm'
import SamplingForm from '../components/SamplingForm'
import { harvestRecordService } from '../lib/databaseService'
import { useToast } from '../components/Toast'
import { PlusCircle } from 'lucide-react'

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
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingHarvest, setEditingHarvest] = useState(null)
  const [editForm, setEditForm] = useState({
    harvest_date: '',
    harvest_type: 'complete',
    total_weight: '',
    average_body_weight: '',
    estimated_count: '',
    fcr: '',
    notes: '',
    status: 'completed',
  })
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const { showToast } = useToast()

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
    setEditingHarvest(null)
  }

  const handleEditHarvest = (record) => {
    setEditingHarvest(record)
    setEditForm({
      harvest_date: record.harvest_date || record.harvestDate || '',
      harvest_type: record.harvest_type || record.harvestType || 'complete',
      total_weight: record.total_weight ?? record.totalWeight ?? '',
      average_body_weight:
        record.average_body_weight ?? record.averageBodyWeight ?? '',
      estimated_count: record.estimated_count ?? record.estimatedCount ?? '',
      fcr: record.fcr ?? '',
      notes: record.notes || '',
      status: record.status || 'completed',
    })
    setShowEditModal(true)
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault()
    if (!editingHarvest) return
    try {
      const { error } = await harvestRecordService.updateHarvestRecord(
        editingHarvest.id || editingHarvest._id,
        {
          harvest_date: editForm.harvest_date,
          harvest_type: editForm.harvest_type,
          total_weight: Number(editForm.total_weight),
          average_body_weight: Number(editForm.average_body_weight),
          estimated_count:
            editForm.estimated_count === ''
              ? undefined
              : Number(editForm.estimated_count),
          fcr: editForm.fcr === '' ? undefined : Number(editForm.fcr),
          notes: editForm.notes,
          status: editForm.status,
        },
      )
      if (error) throw error
      showToast('Harvest updated', 'success')
      setShowEditModal(false)
      setEditingHarvest(null)
      fetchHarvestRecords()
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    }
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

  const handleDeleteHarvest = async () => {
    if (!deleteConfirm) return
    try {
      const { error } = await harvestRecordService.deleteHarvestRecord(
        deleteConfirm.id || deleteConfirm._id,
      )
      if (error) throw error
      showToast('Harvest deleted', 'success')
      setDeleteConfirm(null)
      fetchHarvestRecords()
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error')
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
      accessor: record => record.harvest_type
    },
    {
      header: 'Status',
      accessor: record => record.status
    },
    {
      header: 'Total Weight (kg)',
      accessor: record => record.total_weight
    },
    {
      header: 'Actions',
      accessor: record => (
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={() => handleEditHarvest(record)}
            className="text-lagoon-800 hover:text-lagoon-950"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => handleAddSampling(record)}
            className="text-lagoon-800 hover:text-lagoon-950"
          >
            Add Sampling
          </button>
          <button
            type="button"
            onClick={() => setDeleteConfirm(record)}
            className="text-signal hover:opacity-80"
          >
            Delete
          </button>
        </div>
      )
    }
  ]

  return (
    <ProtectedRoute>
      <Layout title="Harvest Management">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Harvest' },
          ]}
          description="Track harvest events and related sampling records."
          related={[
            { label: 'Harvest sampling', href: '/harvest-sampling' },
            { label: 'Sales', href: '/sales' },
            { label: 'Bi-weekly records', href: '/biweekly-records' },
            { label: 'Cages', href: '/cages' },
          ]}
          actions={
            <>
              <Button href="/sales" variant="secondary" size="sm">
                Sales
              </Button>
              <Button href="/harvest-sampling" variant="secondary" size="sm">
                <PlusCircle className="w-4 h-4" />
                Harvest Sampling
              </Button>
              <button
                onClick={handleExport}
                className="inline-flex items-center px-3 py-2 border border-foam-deep rounded-xl shadow-sm text-sm font-semibold text-chart-ink bg-white hover:bg-foam min-h-10"
              >
                Export
              </button>
              <button
                onClick={handleAddHarvest}
                className="inline-flex items-center px-3 py-2 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-white bg-lagoon-950 hover:bg-lagoon-800 min-h-10"
              >
                Add Harvest
              </button>
            </>
          }
        />

          {/* Filters */}
          <div className="page-card p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Search
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by cage name or code"
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lagoon-800 mx-auto"></div>
              <p className="mt-4 text-muted">Loading harvest records...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <p className="text-red-700">{error}</p>
            </div>
          ) : showHarvestForm ? (
            <div className="page-card p-6">
              <HarvestForm onComplete={handleHarvestComplete} />
            </div>
          ) : showSamplingForm ? (
            <div className="page-card p-6">
              <SamplingForm
                harvestId={selectedHarvest.id}
                onComplete={handleSamplingComplete}
              />
            </div>
          ) : (
            <div className="page-card overflow-hidden">
              <table className="min-w-full divide-y divide-foam-deep">
                <thead className="bg-foam-deep/40">
                  <tr>
                    {columns.map((column, index) => (
                      <th
                        key={index}
                        className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                      >
                        {column.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-foam-deep">
                  {filteredRecords.map((record, index) => (
                    <tr key={record.id}>
                      {columns.map((column, index) => (
                        <td
                          key={index}
                          className="px-6 py-4 whitespace-nowrap text-sm text-chart-ink"
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
      </Layout>
    </ProtectedRoute>
  )
}

export default HarvestPage 