import React, { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { format } from 'date-fns'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  Button,
  Card,
  Field,
  Input,
  EmptyState,
  LoadingState,
  Modal,
  GradientButton,
  GhostButton,
  KpiStrip,
  Table,
} from '../components/ui'
import { formatNumber } from '../lib/format'
import { useT } from '../lib/i18n/context'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { errorMessage } from '../lib/errorMessage'
import { biweeklyPatchArgs } from '../lib/biweeklyArgs'
import {
  Eye,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from '../hooks/usePermission'

const ICON_BTN =
  'inline-flex items-center justify-center size-9 rounded-pill text-muted hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
const DAY_MS = 24 * 60 * 60 * 1000

/** Paper 05 "Export" glyph: an arrow down to a bar. */
function ExportIcon({ size = 16, strokeWidth = 2, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 4v12M6 10l6 6 6-6M5 20h14" />
    </svg>
  )
}

/** Paper 05 ABW bars: sampled in the last 14 days #8EC2F7 → #1562D6 (top to bottom); older samples line-strong. */
const BAR_FRESH = 'bg-[linear-gradient(in_oklab_180deg,#8EC2F7_0%,#1562D6_100%)]'
const BAR_STALE = 'bg-line-strong'

const PAGE_SIZE = 20

export default function BiweeklyRecords() {
  return (
    <ProtectedRoute>
      <BiweeklyRecordsBody />
    </ProtectedRoute>
  )
}

function BiweeklyRecordsBody() {
  const t = useT()
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

  // Growth from consecutive samplings of each cage (Paper 05: Gain, ADG, ABW by cage).
  const growth = useMemo(() => {
    const byCage = new Map()
    for (const r of allRecords || []) {
      if (!byCage.has(r.cage_id)) byCage.set(r.cage_id, [])
      byCage.get(r.cage_id).push(r)
    }
    const byId = new Map()
    const latest = []
    const adgs = []
    const cutoff = Date.now() - 14 * DAY_MS
    let sampled14 = 0
    for (const [cageId, list] of byCage) {
      list.sort((a, b) => String(a.date).localeCompare(String(b.date)))
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1]
        const cur = list[i]
        const days = (new Date(cur.date) - new Date(prev.date)) / DAY_MS
        const gain = (Number(cur.average_body_weight) || 0) - (Number(prev.average_body_weight) || 0)
        byId.set(cur.id || cur._id, { gain, adg: days > 0 ? gain / days : null })
      }
      const last = list[list.length - 1]
      const lastGrowth = byId.get(last.id || last._id)
      if (lastGrowth?.adg != null) adgs.push(lastGrowth.adg)
      const fresh = new Date(last.date).getTime() >= cutoff
      if (fresh) sampled14 += 1
      latest.push({
        cageId,
        name: last.cages?.name || '—',
        abw: Number(last.average_body_weight) || 0,
        date: String(last.date),
        fresh,
      })
    }
    latest.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return {
      byId,
      latest,
      sampled14,
      avgAbw: latest.length ? latest.reduce((s, l) => s + l.abw, 0) / latest.length : 0,
      // Bi-weekly: the next round is 14 days after the latest sampling.
      lastRound: latest.reduce((m, l) => (l.date > m ? l.date : m), ''),
      adg: adgs.length ? adgs.reduce((s, v) => s + v, 0) / adgs.length : null,
    }
  }, [allRecords])

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
      <Layout title={t('biweekly.records.title')} eyebrow={t('biweekly.records.eyebrow')}>
        <LoadingState label={t('biweekly.records.loading')} />
      </Layout>
    )
  }

  const idOf = (r) => r.id || r._id
  const columns = [
    {
      key: 'date',
      header: t('biweekly.records.colDate'),
      width: 110,
      render: (r) => <span className="whitespace-nowrap tabular-nums">{format(new Date(r.date), 'MMM d')}</span>,
    },
    {
      key: 'cage',
      header: t('biweekly.records.colCage'),
      width: 90,
      render: (r) => <span className="whitespace-nowrap">{r.cages?.name || t('biweekly.records.unknownCage')}</span>,
    },
    { key: 'batch', header: t('biweekly.records.colBatch'), width: 140, render: (r) => r.batch_code },
    {
      key: 'sample',
      header: t('biweekly.records.colSample'),
      width: 90,
      align: 'right',
      render: (r) => t('biweekly.records.fishN', { count: r.total_fish_count ?? 0, n: formatNumber(r.total_fish_count) }),
    },
    {
      key: 'weight',
      header: t('biweekly.records.colWeight'),
      width: 110,
      align: 'right',
      render: (r) => (r.total_weight ? `${formatNumber(r.total_weight / 1000, { decimals: 1 })} kg` : '—'),
    },
    {
      key: 'abw',
      header: t('biweekly.records.colAbw'),
      width: 100,
      align: 'right',
      render: (r) => `${formatNumber(r.average_body_weight)} g`,
    },
    {
      key: 'gain',
      header: t('biweekly.records.colGain'),
      width: 100,
      align: 'right',
      render: (r) => {
        const g = growth.byId.get(idOf(r))
        if (!g) return <span className="text-faint">—</span>
        return (
          <span className={g.gain >= 0 ? 'text-good' : 'text-alert'}>
            {g.gain >= 0 ? '+' : ''}
            {formatNumber(g.gain)} g
          </span>
        )
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('biweekly.records.colActions')}</span>,
      width: 120,
      align: 'right',
      render: (record) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => handleViewDetails(record)}
            className={ICON_BTN}
            title={t('biweekly.records.view')}
            aria-label={t('biweekly.records.view')}
          >
            <Eye className="w-4 h-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => handleEditRecord(record)}
            className={ICON_BTN}
            title={t('biweekly.records.edit')}
            aria-label={t('biweekly.records.edit')}
          >
            <Pencil className="w-4 h-4" aria-hidden />
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setDeleteRecord(record)}
              className={`${ICON_BTN} hover:text-alert`}
              title={t('biweekly.records.delete')}
              aria-label={t('biweekly.records.delete')}
            >
              <Trash2 className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>
      ),
    },
  ]
  const maxAbw = Math.max(1, ...growth.latest.map((l) => l.abw))
  // Paper 05 "Next round · Nov 24 in 6 days": 14 days after the latest sampling.
  const nextRoundKpi = (() => {
    if (!growth.lastRound) return { key: 'next', label: t('biweekly.records.kpiNextRound'), value: '—' }
    const next = new Date(new Date(growth.lastRound).getTime() + 14 * DAY_MS)
    const days = Math.round((next.getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / DAY_MS)
    return {
      key: 'next',
      label: t('biweekly.records.kpiNextRound'),
      value: format(next, 'MMM d'),
      suffix:
        days > 0
          ? t('biweekly.records.inDays', { count: days })
          : days === 0
            ? t('biweekly.records.dueToday')
            : t('biweekly.records.overdue', { count: -days }),
      suffixTone: days < 0 ? 'alert' : 'muted',
    }
  })()

  return (
    <Layout
      title={t('biweekly.records.title')}
      eyebrow={t('biweekly.records.eyebrow')}
      actions={
        <>
          <GradientButton variant="lime" icon={Plus} href="/biweekly-entry">
            {t('biweekly.records.newSampling')}
          </GradientButton>
          <GradientButton ring="sky" icon={ExportIcon} onClick={exportData}>
            {t('biweekly.records.export')}
          </GradientButton>
        </>
      }
    >
      <div className="flex flex-col gap-6 sm:gap-7">
        <KpiStrip
          items={[
            {
              key: 'abw',
              label: t('biweekly.records.kpiAvgAbw'),
              value: growth.latest.length ? `${formatNumber(growth.avgAbw)} g` : '—',
              suffix: growth.latest.length ? t('biweekly.records.allActive') : undefined,
            },
            {
              key: 'adg',
              label: t('biweekly.records.kpiAdg'),
              value: growth.adg == null ? '—' : t('biweekly.records.gPerDayUnit', { value: formatNumber(growth.adg, { decimals: 1 }) }),
            },
            {
              key: 'sampled',
              label: t('biweekly.records.kpiSampled14'),
              value: formatNumber(growth.sampled14),
              suffix: t('biweekly.records.ofCages', { total: cages.length }),
            },
            nextRoundKpi,
            { key: 'fish', label: t('biweekly.records.kpiFish'), value: formatNumber(stats.totalFish) },
          ]}
        />

        {growth.latest.length > 0 && (
          <Card padding={false} className="px-5 py-6 sm:px-[26px]">
            <div className="mb-4 flex flex-wrap justify-between gap-2">
              <h2 className="text-[15px] font-semibold leading-[18px] text-text">{t('biweekly.records.abwByCage')}</h2>
              <p className="text-xs leading-4 text-muted">{t('biweekly.records.abwByCageHint')}</p>
            </div>
            <div className="overflow-x-auto">
              <ul
                className="flex h-[180px] min-w-full items-end gap-2.5"
                aria-label={t('biweekly.records.abwByCage')}
              >
                {growth.latest.map((l) => (
                  <li key={l.cageId} className="flex h-full min-w-9 flex-1 flex-col items-center justify-end gap-1.5">
                    <span className="text-[11px] leading-[14px] text-muted tabular-nums">{formatNumber(l.abw, { decimals: 0 })}</span>
                    <div
                      className={`w-full shrink-0 rounded-t-[6px] rounded-b-[2px] ${l.fresh ? BAR_FRESH : BAR_STALE}`}
                      style={{ height: `${Math.max(4, (l.abw / maxAbw) * 130)}px` }}
                      aria-hidden
                    />
                    <span className="max-w-full truncate text-[11px] leading-[14px] text-faint">{l.name}</span>
                    <span className="sr-only">{`${l.name}: ${formatNumber(l.abw, { decimals: 1 })} g`}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}

        {totalCount === 0 ? (
          <Card>
            <EmptyState
              title={t('biweekly.records.emptyTitle')}
              description={t('biweekly.records.emptyBody')}
              action={
                <Button href="/biweekly-entry">
                  <Plus className="w-4 h-4" aria-hidden />
                  {t('biweekly.records.newSampling')}
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            <Table
              title={t('biweekly.records.tableTitle')}
              tabs={[
                { value: 'all', label: t('biweekly.records.rangeAll') },
                { value: 'recent', label: t('biweekly.records.range30') },
                { value: 'month', label: t('biweekly.records.rangeMonth') },
              ]}
              tab={dateFilter}
              onTabChange={setDateFilter}
              search={searchTerm}
              onSearchChange={setSearchTerm}
              searchPlaceholder={t('biweekly.records.searchPlaceholder')}
              actions={
                <>
                  <label htmlFor="biweekly-cage" className="sr-only">
                    {t('biweekly.records.colCage')}
                  </label>
                  <select
                    id="biweekly-cage"
                    value={selectedCage}
                    onChange={(e) => setSelectedCage(e.target.value)}
                    className="h-8 rounded-pill border border-line bg-surface px-3 text-[13px] leading-4 text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                  >
                    <option value="all">{t('biweekly.records.allCages')}</option>
                    {cages.map((cage) => (
                      <option key={cage.id} value={cage.id}>
                        {cage.name}
                      </option>
                    ))}
                  </select>
                </>
              }
              columns={columns}
              rows={filteredRecords}
              rowKey={(r) => idOf(r)}
              empty={t('biweekly.records.noMatch')}
            />
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                <p className="text-sm text-muted tabular-nums">
                  {t('biweekly.records.pageOf', { page: currentPage, pages: totalPages, total: totalCount })}
                </p>
                <div className="flex gap-2">
                  <GhostButton
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                  >
                    {t('biweekly.records.previous')}
                  </GhostButton>
                  <GhostButton
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                  >
                    {t('biweekly.records.next')}
                  </GhostButton>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

        {/* Details Modal */}
        {showDetails && selectedRecord && (
          <Modal onClose={() => setShowDetails(false)} title="Record details" size="4xl" showClose>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <h4 className="text-sm font-semibold text-text mb-2">Record</h4>
                <dl className="space-y-2">
                  <div>
                    <dt className="text-sm text-muted">Date</dt>
                    <dd className="text-sm text-text">{format(new Date(selectedRecord.date), 'MMMM d, yyyy')}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">Cage</dt>
                    <dd className="text-sm text-text">{selectedRecord.cages?.name || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">Batch code</dt>
                    <dd className="text-sm font-data text-text">{selectedRecord.batch_code}</dd>
                  </div>
                </dl>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-text mb-2">Summary</h4>
                <dl className="space-y-2">
                  <div>
                    <dt className="text-sm text-muted">Total fish count</dt>
                    <dd className="text-sm text-text tabular-nums">{selectedRecord.total_fish_count.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">Total weight</dt>
                    <dd className="text-sm text-text tabular-nums">{selectedRecord.total_weight.toFixed(2)}g</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">Average ABW</dt>
                    <dd className="text-sm text-text tabular-nums">{selectedRecord.average_body_weight.toFixed(2)}g</dd>
                  </div>
                </dl>
              </div>
            </div>

            {selectedRecord.biweekly_sampling && selectedRecord.biweekly_sampling.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-text mb-3">Samples</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-line">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left text-[11px] font-normal uppercase leading-[14px] tracking-[0.08em] text-faint">Sample</th>
                        <th className="px-4 py-3 text-left text-[11px] font-normal uppercase leading-[14px] tracking-[0.08em] text-faint">Fish count</th>
                        <th className="px-4 py-3 text-left text-[11px] font-normal uppercase leading-[14px] tracking-[0.08em] text-faint">Total weight</th>
                        <th className="px-4 py-3 text-left text-[11px] font-normal uppercase leading-[14px] tracking-[0.08em] text-faint">Average ABW</th>
                      </tr>
                    </thead>
                    <tbody className="bg-surface divide-y divide-line">
                      {selectedRecord.biweekly_sampling.map((sampling, index) => (
                        <tr key={sampling.id}>
                          <td className="px-4 py-3 text-sm text-text tabular-nums">{sampling.sampling_number}</td>
                          <td className="px-4 py-3 text-sm text-text tabular-nums">{sampling.fish_count}</td>
                          <td className="px-4 py-3 text-sm text-text tabular-nums">{sampling.total_weight.toFixed(2)}g</td>
                          <td className="px-4 py-3 text-sm text-text tabular-nums">{sampling.average_body_weight.toFixed(2)}g</td>
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
            icon={<AlertTriangle className="w-6 h-6 text-alert" />}
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
              <span className="font-semibold text-text">{deleteRecord.batch_code}</span> from{' '}
              {deleteRecord.date}? This cannot be undone.
            </p>
          </Modal>
        )}
    </Layout>
  )
} 