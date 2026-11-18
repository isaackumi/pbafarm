// components/DataTable.js
import React, { useState } from 'react'
import { ChevronLeft, ChevronRight, Search, Filter } from 'lucide-react'
import { Button, Input } from './ui'

export default function DataTable({
  data = [],
  columns = [],
  pagination = false,
  currentPage = 1,
  totalPages = 1,
  recordsPerPage = 10,
  loading = false,
  searchable = false,
  filterable = false,
  sortable = false,
  onPageChange,
  emptyMessage = 'No data available'
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })
  const [showFilters, setShowFilters] = useState(false)

  // Handle sorting
  const handleSort = (key) => {
    let direction = 'asc'
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc'
    }
    setSortConfig({ key, direction })
  }

  // Filter and sort data
  const processedData = React.useMemo(() => {
    let result = [...data]

    // Apply search
    if (searchQuery) {
      result = result.filter(row => {
        return columns.some(column => {
          if (column.searchable && row[column.accessor]) {
            return row[column.accessor].toString().toLowerCase().includes(searchQuery.toLowerCase())
          }
          return false
        })
      })
    }

    // Apply sorting
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
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lake"></div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      {/* Search and Filter Bar */}
      {(searchable || filterable) && (
        <div className="p-4 border-b border-foam-deep">
          <div className="flex items-center space-x-4">
            {searchable && (
              <div className="flex-1">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-muted" />
                  </div>
                  <Input
                    type="text"
                    aria-label="Search"
                    className="pl-10"
                    placeholder="Search…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
            )}
            {filterable && (
              <Button
                variant="secondary"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="h-4 w-4" />
                Filters
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <table className="min-w-full divide-y divide-foam-deep">
        <thead className="bg-foam">
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className={`px-6 py-3 text-left text-xs font-medium text-muted ${
                  sortable && column.sortable ? 'cursor-pointer hover:text-chart-ink' : ''
                }`}
                onClick={() => sortable && column.sortable && handleSort(column.accessor)}
              >
                <div className="flex items-center space-x-1">
                  <span>{column.header}</span>
                  {sortable && column.sortable && sortConfig.key === column.accessor && (
                    <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-surface divide-y divide-foam-deep">
          {processedData.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-4 text-center text-sm text-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            processedData.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-foam">
                {columns.map((column, colIndex) => (
                  <td key={colIndex} className="px-6 py-4 whitespace-nowrap text-sm text-chart-ink tabular-nums">
                    {column.cell ? column.cell(row) : row[column.accessor]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Pagination */}
      {pagination && totalPages > 1 && (
        <div className="bg-surface px-4 py-3 flex items-center justify-between border-t border-foam-deep sm:px-6">
          <div className="flex-1 flex justify-between sm:hidden">
            <Button
              variant="secondary"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              className="ml-3"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-muted tabular-nums">
                Showing page <span className="font-medium text-chart-ink">{currentPage}</span> of{' '}
                <span className="font-medium text-chart-ink">{totalPages}</span>
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-lg -space-x-px" aria-label="Pagination">
                <button
                  type="button"
                  onClick={() => onPageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center justify-center min-h-10 min-w-10 px-2 rounded-l-lg border border-foam-deep bg-surface text-sm font-medium text-muted hover:bg-foam disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-lake"
                >
                  <span className="sr-only">Previous</span>
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                {[...Array(totalPages)].map((_, index) => (
                  <button
                    type="button"
                    key={index}
                    onClick={() => onPageChange(index + 1)}
                    aria-current={currentPage === index + 1 ? 'page' : undefined}
                    className={`relative inline-flex items-center justify-center min-h-10 min-w-10 px-3 border text-sm font-medium tabular-nums focus:outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-lake ${
                      currentPage === index + 1
                        ? 'z-10 bg-lake-soft border-lake text-lake'
                        : 'bg-surface border-foam-deep text-muted hover:bg-foam'
                    }`}
                  >
                    {index + 1}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onPageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center justify-center min-h-10 min-w-10 px-2 rounded-r-lg border border-foam-deep bg-surface text-sm font-medium text-muted hover:bg-foam disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-lake"
                >
                  <span className="sr-only">Next</span>
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
