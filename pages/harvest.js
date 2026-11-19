import React, { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button, Field, Input, EmptyState, LoadingState } from '../components/ui'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import HarvestForm from '../components/HarvestForm'
import SamplingForm from '../components/SamplingForm'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { harvestPatchArgs } from '../lib/recordArgs'
import { useT } from '../lib/i18n/context'
import { PlusCircle } from 'lucide-react'
import { localToday } from '../lib/format'
import { usePermission } from '../hooks/usePermission'

const NO_RECORDS = []

const HarvestPage = () => (
  <ProtectedRoute>
    <Layout title="Harvest">
      <Harvest />
    </Layout>
  </ProtectedRoute>
)

const Harvest = () => {
  const t = useT()
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const isAdmin = usePermission('production.records.delete')
  const harvestResult = useQuery(api.harvest.list, user ? locationArgs : 'skip')
  const harvestRecords = harvestResult ?? NO_RECORDS
  const loading = harvestResult === undefined
  const updateHarvest = useMutation(api.harvest.update)
  const removeHarvest = useMutation(api.harvest.remove)
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
    notes: '',
    status: 'completed',
  })
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const { showToast } = useToast()

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
      notes: record.notes || '',
      status: record.status || 'completed',
    })
    setShowEditModal(true)
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault()
    if (!editingHarvest) return
    try {
      const id = editingHarvest.id || editingHarvest._id
      const result = await updateHarvest({
        id,
        patch: harvestPatchArgs({
          harvest_date: editForm.harvest_date,
          harvest_type: editForm.harvest_type,
          total_weight: Number(editForm.total_weight),
          average_body_weight: Number(editForm.average_body_weight),
          estimated_count:
            editForm.estimated_count === ''
              ? undefined
              : Number(editForm.estimated_count),
          notes: editForm.notes,
          status: editForm.status,
        }),
      })
      const warnings = result?.warnings
      showToast('Harvest updated', 'success')
      if (warnings?.length) showToast(warnings.join('. '), 'warning')
      setShowEditModal(false)
      setEditingHarvest(null)
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
  }

  const handleSamplingComplete = () => {
    setShowSamplingForm(false)
    setSelectedHarvest(null)
  }

  const handleExport = () => {
    try {
      const data = harvestRecords.map((record) => ({
        'Cage Name': record.cage?.name || 'Unknown',
        'Cage Code': record.cage?.code || 'Unknown',
        'Harvest Date': new Date(record.harvest_date).toLocaleDateString(),
        'Harvest Type': record.harvest_type,
        'Status': record.status,
        'Total Weight (kg)': record.total_weight,
        'Average Body Weight (g)': record.average_body_weight,
        'Estimated Count': record.estimated_count,
        'FCR': record.fcr,
        'Size Breakdown': JSON.stringify(record.size_breakdown),
        'Notes': record.notes,
      }))
      if (!data.length) {
        showToast('No harvest records to export', 'info')
        return
      }

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
      link.setAttribute('download', `harvest_records_${localToday()}.csv`)
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
      const result = await removeHarvest({ id: deleteConfirm.id || deleteConfirm._id })
      const warnings = result?.warnings
      showToast('Harvest deleted', 'success')
      if (warnings?.length) showToast(warnings.join('. '), 'warning')
      setDeleteConfirm(null)
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  const filteredRecords = harvestRecords.filter(record => {
    const matchesSearch = 
      (record.cages?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (record.cages?.code || '').toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesDateRange = 
      (!dateRange.start || new Date(record.harvest_date) >= new Date(dateRange.start)) &&
      (!dateRange.end || new Date(record.harvest_date) <= new Date(dateRange.end))

    return matchesSearch && matchesDateRange
  })

  const columns = [
    {
      header: 'Cage',
      accessor: record =>
        record.cages?.code
          ? `${record.cages.name} (${record.cages.code})`
          : record.cages?.name || '—'
    },
    {
      header: 'Harvest date',
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
      header: 'Total weight (kg)',
      accessor: record => record.total_weight
    },
    {
      header: 'Actions',
      accessor: record => (
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={() => handleEditHarvest(record)}
            className="text-lake hover:underline underline-offset-2 min-h-9"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => handleAddSampling(record)}
            className="text-lake hover:underline underline-offset-2 min-h-9"
          >
            Add sampling
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setDeleteConfirm(record)}
              className="text-signal hover:underline underline-offset-2 min-h-9"
            >
              Delete
            </button>
          )}
        </div>
      )
    }
  ]

  return (
    <>
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
                <PlusCircle className="w-4 h-4" aria-hidden />
                Harvest sampling
              </Button>
              <Button variant="secondary" size="sm" onClick={handleExport}>
                Export
              </Button>
              <Button size="sm" onClick={handleAddHarvest}>
                Add harvest
              </Button>
            </>
          }
        />

          {/* Filters */}
          <div className="page-card p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Search" htmlFor="harvest-search">
                <Input
                  id="harvest-search"
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Cage name or code"
                />
              </Field>
              <Field label="Start date" htmlFor="harvest-start">
                <Input
                  id="harvest-start"
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                />
              </Field>
              <Field label="End date" htmlFor="harvest-end">
                <Input
                  id="harvest-end"
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                />
              </Field>
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <LoadingState label="Loading harvest records…" />
          ) : showHarvestForm ? (
            <HarvestForm onComplete={handleHarvestComplete} />
          ) : showSamplingForm ? (
            <div className="page-card p-6">
              <SamplingForm
                harvestId={selectedHarvest.id}
                onComplete={handleSamplingComplete}
              />
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="page-card">
              <EmptyState
                title={harvestRecords.length ? t('harvest.listNoMatch') : t('harvest.listEmpty')}
                description={harvestRecords.length ? t('harvest.listNoMatchHint') : t('harvest.listEmptyHint')}
                action={
                  harvestRecords.length ? null : (
                    <Button onClick={handleAddHarvest}>{t('harvest.listAdd')}</Button>
                  )
                }
              />
            </div>
          ) : (
            <div className="page-card overflow-x-auto">
              <table className="min-w-full divide-y divide-foam-deep">
                <thead className="bg-foam">
                  <tr>
                    {columns.map((column, index) => (
                      <th
                        key={index}
                        className="px-4 py-3 text-left text-xs font-medium text-muted"
                      >
                        {column.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-foam-deep">
                  {filteredRecords.map((record, index) => (
                    <tr key={record.id}>
                      {columns.map((column, index) => (
                        <td
                          key={index}
                          className="px-4 py-3 whitespace-nowrap text-sm text-chart-ink tabular-nums"
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

        <ConfirmDeleteModal
          open={Boolean(deleteConfirm)}
          title="Delete harvest"
          message={
            <>
              Delete harvest for{' '}
              <span className="font-semibold text-chart-ink">
                {deleteConfirm?.cages?.name || 'this cage'}
              </span>
              {deleteConfirm?.harvest_date
                ? ` on ${new Date(deleteConfirm.harvest_date).toLocaleDateString()}`
                : ''}
              ?
            </>
          }
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={handleDeleteHarvest}
        />
    </>
  )
}

export default HarvestPage 