// components/DataTable.js
import React, { useState } from 'react'
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import { GhostButton, LoadingState, Table } from './ui'
import { useT } from '../lib/i18n/context'

/** Strips the Table card chrome: DataTable sits inside its host page's card. */
const BARE = 'rounded-none! border-0! bg-transparent! shadow-none!'

const PAGE_BTN =
  'inline-flex min-h-10 min-w-10 items-center justify-center rounded-pill px-3 text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Legacy table API ({ header, accessor, cell, sortable, searchable } columns)
 * rendered with the Paper Table primitive.
 */
export default function DataTable({
  data = [],
  columns = [],
  pagination = false,
  currentPage = 1,
  totalPages = 1,
  loading = false,
  searchable = false,
  filterable = false,
  sortable = false,
  onPageChange,
  emptyMessage = 'No data available',
}) {
  const t = useT()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })
  const [showFilters, setShowFilters] = useState(false)

  const handleSort = (key) => {
    let direction = 'asc'
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc'
    }
    setSortConfig({ key, direction })
  }

  const processedData = React.useMemo(() => {
    let result = [...data]

    if (searchQuery) {
      result = result.filter((row) =>
        columns.some(
          (column) =>
            column.searchable &&
            row[column.accessor] &&
            row[column.accessor].toString().toLowerCase().includes(searchQuery.toLowerCase()),
        ),
      )
    }

    if (sortConfig.key) {
      result.sort((a, b) => {
        const aValue = a[sortConfig.key]
        const bValue = b[sortConfig.key]

        if (aValue === bValue) return 0
        if (aValue === null) return 1
        if (bValue === null) return -1

        const comparison = aValue.toString().localeCompare(bValue.toString())
        return sortConfig.direction === 'asc' ? comparison : -comparison
      })
    }

    return result
  }, [data, searchQuery, sortConfig, columns])

  if (loading) {
    return <LoadingState />
  }

  const tableColumns = columns.map((column, index) => {
    const canSort = sortable && column.sortable
    const active = sortConfig.key === column.accessor
    return {
      key: column.accessor ? `${column.accessor}-${index}` : `col-${index}`,
      header: canSort ? (
        <button
          type="button"
          onClick={() => handleSort(column.accessor)}
          className="inline-flex items-center gap-1 rounded-sm uppercase tracking-[inherit] hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
          aria-label={t('dataTable.sortBy', { column: typeof column.header === 'string' ? column.header : column.accessor })}
        >
          {column.header}
          {active && <span aria-hidden>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
        </button>
      ) : (
        column.header
      ),
      render: (row) => (
        <span className="whitespace-nowrap tabular-nums">
          {column.cell ? column.cell(row) : row[column.accessor]}
        </span>
      ),
    }
  })

  return (
    <div>
      <Table
        className={BARE}
        search={searchable ? searchQuery : undefined}
        onSearchChange={searchable ? setSearchQuery : undefined}
        searchPlaceholder={t('dataTable.search')}
        actions={
          filterable ? (
            <GhostButton size="sm" icon={Filter} aria-pressed={showFilters} onClick={() => setShowFilters(!showFilters)}>
              {t('dataTable.filters')}
            </GhostButton>
          ) : null
        }
        columns={tableColumns}
        rows={processedData}
        rowKey={(row, i) => i}
        empty={emptyMessage}
      />

      {pagination && totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
          <p className="text-sm text-muted tabular-nums">
            {t('dataTable.pageOf', { page: currentPage, pages: totalPages })}
          </p>
          <nav className="flex items-center gap-1" aria-label={t('dataTable.pagination')}>
            <button
              type="button"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className={`${PAGE_BTN} border border-line-strong text-muted hover:bg-surface-2`}
            >
              <span className="sr-only">{t('dataTable.previous')}</span>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            {[...Array(totalPages)].map((_, index) => (
              <button
                type="button"
                key={index}
                onClick={() => onPageChange(index + 1)}
                aria-current={currentPage === index + 1 ? 'page' : undefined}
                className={`${PAGE_BTN} hidden sm:inline-flex ${
                  currentPage === index + 1 ? 'bg-button font-medium text-button-text' : 'text-muted hover:bg-surface-2'
                }`}
              >
                {index + 1}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className={`${PAGE_BTN} border border-line-strong text-muted hover:bg-surface-2`}
            >
              <span className="sr-only">{t('dataTable.next')}</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </nav>
        </div>
      )}
    </div>
  )
}
