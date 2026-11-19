import React, { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { format } from 'date-fns'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button, StatCard, Field, Input, Select, EmptyState, LoadingState, Modal } from '../components/ui'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { errorMessage } from '../lib/errorMessage'
import { biweeklyPatchArgs } from '../lib/biweeklyArgs'
import {
  Search,
  Eye,
  Download,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from '../hooks/usePermission'

const ICON_BTN =
  'inline-flex items-center justify-center h-9 w-9 rounded-lg hover:bg-foam focus:outline-none focus-visible:ring-2 focus-visible:ring-lake'

const PAGE_SIZE = 20

export default function BiweeklyRecords() {
  return (
    <ProtectedRoute>
      <Layout title="Bi-weekly records">
        <BiweeklyRecordsBody />
      </Layout>
    </ProtectedRoute>
  )
}

function BiweeklyRecordsBody() {
  const { showToast } = useToast()
  const { hasRole } = useAuth()
  const isAdmin = usePermission('production.records.delete')
  const { locationArgs } = useLocation()
  const allRecords = useQuery(api.biweeklyRecords.list, locationArgs)
  const cagesResult = useQuery(api.cages.list, locationArgs)
  const updateRecord = useMutation(api.biweeklyRecords.update)
  const removeRecord = useMutation(api.biweeklyRecords.remove)
  const loading = allRecords === undefined
  const cages = cagesResult || []
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCage, setSelectedCage] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
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
  const totalCount = (allRecords || []).length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const records = useMemo(
    () => (allRecords || []).slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [allRecords, currentPage],
  )
  const stats = useMemo(() => {
    const totalFish = records.reduce((sum, record) => sum + (record.total_fish_count || 0), 0)
    const totalWeight = records.reduce((sum, record) => sum + (record.total_weight || 0), 0)
    const averageABW =
      records.length > 0
        ? records.reduce((sum, record) => sum + (record.average_body_weight || 0), 0) /
          records.length
        : 0
    return {
      totalRecords: records.length,
      totalFish,
      totalWeight,
      averageABW,
      activeCages: new Set(records.map((record) => record.cage_id)).size,
    }
  }, [records])

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
      await updateRecord(
        biweeklyPatchArgs(editRecord.id || editRecord._id, {
          date: editForm.date,
          batch_code: editForm.batch_code,
          average_body_weight: Number(editForm.average_body_weight),
          total_fish_count: Number(editForm.total_fish_count),
          total_weight: Number(editForm.total_weight),
        }),
      )
      showToast('Biweekly record updated', 'success')
      setEditRecord(null)
    } catch (err) {
      showToast(errorMessage(err, 'Update failed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteRecord) return
    setDeleting(true)
    try {
      await removeRecord({ id: deleteRecord.id || deleteRecord._id })
      showToast('Biweekly record deleted', 'success')
      setDeleteRecord(null)
    } catch (err) {
      showToast(errorMessage(err, 'Delete failed'), 'error')
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
      <div className="page-card p-8">
        <LoadingState label="Loading bi-weekly records…" />
      </div>
    )
  }

  return (
      <>
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
                <Plus className="w-4 h-4" aria-hidden />
                New record
              </Button>
              <Button variant="secondary" size="sm" onClick={exportData}>
                <Download className="w-4 h-4" aria-hidden />
                Export
              </Button>
            </>
          }
        />

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
              <StatCard label="Total records" value={stats.totalRecords} />
              <StatCard label="Total fish" value={stats.totalFish.toLocaleString()} />
              <StatCard label="Total weight" value={(stats.totalWeight / 1000).toFixed(1)} unit="kg" />
              <StatCard label="Average ABW" value={stats.averageABW.toFixed(1)} unit="g" />
              <StatCard label="Active cages" value={stats.activeCages} />
            </div>

            <div className="page-card p-4 sm:p-5 mb-8">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Field label="Search" htmlFor="biweekly-search">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" aria-hidden />
                    <Input
                      id="biweekly-search"
                      type="text"
                      placeholder="Cage or batch code"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </Field>

                <Field label="Cage" htmlFor="biweekly-cage">
                  <Select
                    id="biweekly-cage"
                    value={selectedCage}
                    onChange={(e) => setSelectedCage(e.target.value)}
                  >
                    <option value="all">All cages</option>
                    {cages.map(cage => (
                      <option key={cage.id} value={cage.id}>{cage.name}</option>
                    ))}
                  </Select>
                </Field>

                <Field label="Date" htmlFor="biweekly-date">
                  <Select
                    id="biweekly-date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                  >
                    <option value="all">All time</option>
                    <option value="recent">Last 30 days</option>
                    <option value="month">This month</option>
                  </Select>
                </Field>
              </div>
            </div>

            {/* Records Table */}
            <div className="page-card overflow-hidden">
              <div className="px-5 py-4 border-b border-foam-deep">
                <h3 className="font-display text-lg font-medium text-chart-ink">
                  Records <span className="text-muted font-normal tabular-nums">({filteredRecords.length})</span>
                </h3>
              </div>

              {filteredRecords.length === 0 ? (
                <EmptyState
                  title="No bi-weekly records yet"
                  description="Records appear here once you enter a bi-weekly sampling."
                  action={
                    <Button href="/biweekly-entry">
                      <Plus className="w-4 h-4" aria-hidden />
                      Create record
                    </Button>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-foam-deep">
                    <thead className="bg-foam">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                          Cage
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                          Batch code
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                          Total fish
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                          Total weight
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                          Average ABW
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                          Samples
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-surface divide-y divide-foam-deep">
                      {filteredRecords.map((record) => (
                        <tr key={record.id} className="hover:bg-foam">
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center">
                              
                              <span className="text-sm font-medium text-chart-ink">
                                {format(new Date(record.date), 'MMM d, yyyy')}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-sm font-medium text-chart-ink">
                              {record.cages?.name || 'Unknown cage'}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-sm font-data text-chart-ink">
                              {record.batch_code}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center">
                              
                              <span className="text-sm text-chart-ink tabular-nums">
                                {record.total_fish_count.toLocaleString()}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center">
                              
                              <span className="text-sm text-chart-ink tabular-nums">
                                {record.total_weight.toFixed(2)}g
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center">
                              
                              <span className="text-sm font-medium text-chart-ink tabular-nums">
                                {record.average_body_weight.toFixed(2)}g
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-foam-deep text-chart-ink tabular-nums">
                              {record.biweekly_sampling?.length || 0} samples
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleViewDetails(record)}
                                className={ICON_BTN + ' text-lake'}
                                title="View"
                                aria-label="View record"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEditRecord(record)}
                                className={ICON_BTN + ' text-lake'}
                                title="Edit"
                                aria-label="Edit record"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => setDeleteRecord(record)}
                                  className={ICON_BTN + ' text-signal hover:bg-signal/10'}
                                  title="Delete"
                                  aria-label="Delete record"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
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
                <div className="px-4 py-3 border-t border-foam-deep">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-muted tabular-nums">
                      Showing page {currentPage} of {totalPages} ({totalCount} total records)
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

        {/* Details Modal */}
        {showDetails && selectedRecord && (
          <Modal onClose={() => setShowDetails(false)} title="Record details" size="4xl" showClose>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <h4 className="text-sm font-semibold text-chart-ink mb-2">Record</h4>
                <dl className="space-y-2">
                  <div>
                    <dt className="text-sm text-muted">Date</dt>
                    <dd className="text-sm text-chart-ink">{format(new Date(selectedRecord.date), 'MMMM d, yyyy')}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">Cage</dt>
                    <dd className="text-sm text-chart-ink">{selectedRecord.cages?.name || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">Batch code</dt>
                    <dd className="text-sm font-data text-chart-ink">{selectedRecord.batch_code}</dd>
                  </div>
                </dl>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-chart-ink mb-2">Summary</h4>
                <dl className="space-y-2">
                  <div>
                    <dt className="text-sm text-muted">Total fish count</dt>
                    <dd className="text-sm text-chart-ink tabular-nums">{selectedRecord.total_fish_count.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">Total weight</dt>
                    <dd className="text-sm text-chart-ink tabular-nums">{selectedRecord.total_weight.toFixed(2)}g</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">Average ABW</dt>
                    <dd className="text-sm text-chart-ink tabular-nums">{selectedRecord.average_body_weight.toFixed(2)}g</dd>
                  </div>
                </dl>
              </div>
            </div>

            {selectedRecord.biweekly_sampling && selectedRecord.biweekly_sampling.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-chart-ink mb-3">Samples</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-foam-deep">
                    <thead className="bg-foam">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted">Sample</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted">Fish count</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted">Total weight</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted">Average ABW</th>
                      </tr>
                    </thead>
                    <tbody className="bg-surface divide-y divide-foam-deep">
                      {selectedRecord.biweekly_sampling.map((sampling, index) => (
                        <tr key={sampling.id}>
                          <td className="px-4 py-3 text-sm text-chart-ink tabular-nums">{sampling.sampling_number}</td>
                          <td className="px-4 py-3 text-sm text-chart-ink tabular-nums">{sampling.fish_count}</td>
                          <td className="px-4 py-3 text-sm text-chart-ink tabular-nums">{sampling.total_weight.toFixed(2)}g</td>
                          <td className="px-4 py-3 text-sm text-chart-ink tabular-nums">{sampling.average_body_weight.toFixed(2)}g</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Modal>
        )}

        {editRecord && (
          <Modal
            onClose={() => setEditRecord(null)}
            dismissible={!saving}
            as="form"
            onSubmit={handleSaveEdit}
            title="Edit bi-weekly record"
            bodyClassName="space-y-3"
            footer={
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => setEditRecord(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save record'}
                </Button>
              </>
            }
          >
            <Field label="Date" htmlFor="biweekly-date-2">
              <Input
                id="biweekly-date-2"
                type="date"
                required
                value={editForm.date}
                onChange={(e) =>
                  setEditForm((p) => ({ ...p, date: e.target.value }))
                }
              />
            </Field>
            <Field label="Batch code" htmlFor="biweekly-batch-code">
              <Input
                id="biweekly-batch-code"
                required
                value={editForm.batch_code}
                onChange={(e) =>
                  setEditForm((p) => ({ ...p, batch_code: e.target.value }))
                }
                className="font-data"
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="ABW (g)" htmlFor="biweekly-abw-g">
                <Input
                  id="biweekly-abw-g"
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
                  className="tabular-nums"
                />
              </Field>
              <Field label="Fish" htmlFor="biweekly-fish">
                <Input
                  id="biweekly-fish"
                  type="number"
                  required
                  value={editForm.total_fish_count}
                  onChange={(e) =>
                    setEditForm((p) => ({
                      ...p,
                      total_fish_count: e.target.value,
                    }))
                  }
                  className="tabular-nums"
                />
              </Field>
              <Field label="Weight" htmlFor="biweekly-weight">
                <Input
                  id="biweekly-weight"
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
                  className="tabular-nums"
                />
              </Field>
            </div>
          </Modal>
        )}

        {deleteRecord && (
          <Modal
            onClose={() => setDeleteRecord(null)}
            dismissible={!deleting}
            role="alertdialog"
            title="Delete record"
            icon={<AlertTriangle className="w-6 h-6 text-signal" />}
            footer={
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={deleting}
                  onClick={() => setDeleteRecord(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={deleting}
                  onClick={handleConfirmDelete}
                >
                  {deleting ? 'Deleting…' : 'Delete record'}
                </Button>
              </>
            }
          >
            <p className="text-sm text-muted mb-5">
              Delete batch{' '}
              <span className="font-semibold text-chart-ink">{deleteRecord.batch_code}</span> from{' '}
              {deleteRecord.date}? This cannot be undone.
            </p>
          </Modal>
        )}
      </>
  )
} 