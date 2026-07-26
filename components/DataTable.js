// components/DataTable.js
import React, { useState } from 'react'
import { ChevronLeft, ChevronRight, Search, Filter } from 'lucide-react'

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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lagoon-800"></div>
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
                  <input
                    type="text"
                    className="block w-full pl-10 pr-3 py-2 border border-input-border rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
            )}
            {filterable && (
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="inline-flex items-center px-3 py-2 border border-input-border shadow-sm text-sm leading-4 font-medium rounded-md text-chart-ink bg-white hover:bg-foam-deep/40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800"
              >
                <Filter className="h-4 w-4 mr-2" />
                Filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <table className="min-w-full divide-y divide-foam-deep">
        <thead className="bg-foam-deep/40">
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className={`px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider ${
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
        <tbody className="bg-white divide-y divide-foam-deep">
          {processedData.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-4 text-center text-sm text-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            processedData.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-foam-deep/40">
                {columns.map((column, colIndex) => (
                  <td key={colIndex} className="px-6 py-4 whitespace-nowrap text-sm text-chart-ink">
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
        <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-foam-deep sm:px-6">
          <div className="flex-1 flex justify-between sm:hidden">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="relative inline-flex items-center px-4 py-2 border border-input-border text-sm font-medium rounded-md text-chart-ink bg-white hover:bg-foam-deep/40"
            >
              Previous
            </button>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="ml-3 relative inline-flex items-center px-4 py-2 border border-input-border text-sm font-medium rounded-md text-chart-ink bg-white hover:bg-foam-deep/40"
            >
              Next
            </button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-chart-ink">
                Showing page <span className="font-medium">{currentPage}</span> of{' '}
                <span className="font-medium">{totalPages}</span>
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                <button
                  onClick={() => onPageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-input-border bg-white text-sm font-medium text-muted hover:bg-foam-deep/40"
                >
                  <span className="sr-only">Previous</span>
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                {[...Array(totalPages)].map((_, index) => (
                  <button
                    key={index}
                    onClick={() => onPageChange(index + 1)}
                    className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                      currentPage === index + 1
                        ? 'z-10 bg-foam-deep border-lagoon-800 text-lagoon-800'
                        : 'bg-white border-input-border text-muted hover:bg-foam-deep/40'
                    }`}
                  >
                    {index + 1}
                  </button>
                ))}
                <button
                  onClick={() => onPageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-input-border bg-white text-sm font-medium text-muted hover:bg-foam-deep/40"
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
