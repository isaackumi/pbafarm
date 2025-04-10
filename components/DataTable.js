// components/DataTable.js
import React, { useState, useEffect } from 'react'
import { Search, Filter, ChevronDown, Edit, Trash, Eye } from 'lucide-react'
import Pagination from './Pagination'

const DataTable = ({
  data,
  columns,
  pagination = true,
  recordsPerPage = 10,
  searchable = true,
  filterable = true,
  sortable = true,
  actions = null,
  loading = false,
  emptyMessage = 'No records found',
  onRowClick = null,
}) => {
  const [currentPage, setCurrentPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })
  const [filters, setFilters] = useState({})
  const [showFilters, setShowFilters] = useState(false)
  const [filteredData, setFilteredData] = useState([])
  const [displayData, setDisplayData] = useState([])

  // Process data when it changes or filtering/sorting config changes
  useEffect(() => {
    let processed = [...data]

    // Apply search
    if (searchTerm) {
      processed = processed.filter((item) => {
        return columns.some((column) => {
          if (!column.searchable) return false

          const value = getNestedValue(item, column.accessor)
          if (value === null || value === undefined) return false

          return String(value).toLowerCase().includes(searchTerm.toLowerCase())
        })
      })
    }

    // Apply filters
    Object.keys(filters).forEach((key) => {
      if (filters[key] && filters[key] !== 'all') {
        processed = processed.filter((item) => {
          const value = getNestedValue(item, key)
          return String(value) === String(filters[key])
        })
      }
    })

    // Apply sorting
    if (sortConfig.key) {
      processed.sort((a, b) => {
        const valueA = getNestedValue(a, sortConfig.key)
        const valueB = getNestedValue(b, sortConfig.key)

        // Handle nulls and undefined
        if (valueA === null || valueA === undefined)
          return sortConfig.direction === 'asc' ? -1 : 1
        if (valueB === null || valueB === undefined)
          return sortConfig.direction === 'asc' ? 1 : -1

        // Handle dates
        if (valueA instanceof Date && valueB instanceof Date) {
          return sortConfig.direction === 'asc'
            ? valueA.getTime() - valueB.getTime()
            : valueB.getTime() - valueA.getTime()
        }

        // Handle strings (case insensitive)
        if (typeof valueA === 'string' && typeof valueB === 'string') {
          return sortConfig.direction === 'asc'
            ? valueA.localeCompare(valueB)
            : valueB.localeCompare(valueA)
        }

        // Handle numbers and other types
        return sortConfig.direction === 'asc'
          ? valueA < valueB
            ? -1
            : valueA > valueB
            ? 1
            : 0
          : valueA < valueB
          ? 1
          : valueA > valueB
          ? -1
          : 0
      })
    }

    setFilteredData(processed)

    // Reset to first page when filters or search change
    setCurrentPage(1)
  }, [data, searchTerm, sortConfig, filters])

  // Update display data when page changes or filtered data changes
  useEffect(() => {
    if (pagination) {
      const startIndex = (currentPage - 1) * recordsPerPage
      const endIndex = startIndex + recordsPerPage
      setDisplayData(filteredData.slice(startIndex, endIndex))
    } else {
      setDisplayData(filteredData)
    }
  }, [filteredData, currentPage, pagination, recordsPerPage])

  // Get value from nested object using dot notation
  const getNestedValue = (obj, path) => {
    if (!path) return obj

    const keys = path.split('.')
    return keys.reduce((acc, key) => {
      return acc && acc[key] !== undefined ? acc[key] : null
    }, obj)
  }

  // Handle sort click
  const handleSort = (key) => {
    let direction = 'asc'

    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc'
    }

    setSortConfig({ key, direction })
  }

  // Handle filter change
  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  // Handle page change
  const handlePageChange = (page) => {
    setCurrentPage(page)
  }

  // Generate filter options for a column
  const getFilterOptions = (column) => {
    if (!column.filterable) return null

    const options = new Set()

    // Add "All" option
    options.add('all')

    // Add unique values from data
    data.forEach((item) => {
      const value = getNestedValue(item, column.accessor)
      if (value !== null && value !== undefined) {
        options.add(String(value))
      }
    })

    return Array.from(options)
  }

  // Calculate total pages
  const totalPages = pagination
    ? Math.ceil(filteredData.length / recordsPerPage)
    : 1

  // Render filter button
  const renderFilterButton = () => {
    if (!filterable || !columns.some((col) => col.filterable)) return null

    return (
      <div className="relative">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
        >
          <Filter className="h-4 w-4 mr-2" />
          Filters
        </button>

        {showFilters && (
          <div className="origin-top-right absolute right-0 mt-2 w-60 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-10 p-4">
            <div className="space-y-4">
              {columns.map((column) => {
                if (!column.filterable) return null

                const options = getFilterOptions(column)
                if (!options || options.length <= 1) return null

                return (
                  <div key={`filter-${column.accessor}`}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {column.header}
                    </label>
                    <select
                      value={filters[column.accessor] || 'all'}
                      onChange={(e) =>
                        handleFilterChange(column.accessor, e.target.value)
                      }
                      className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                    >
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {option === 'all' ? 'All' : option}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-hidden">
      {/* Table Controls */}
      {(searchable || filterable) && (
        <div className="p-4 flex flex-col sm:flex-row justify-between items-center border-b border-gray-200 bg-white">
          {searchable && (
            <div className="w-full sm:w-auto mb-4 sm:mb-0 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search..."
                className="pl-10 block w-full sm:text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          )}

          {filterable && renderFilterButton()}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="py-12 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="mt-3 text-sm text-gray-500">Loading data...</p>
          </div>
        ) : displayData.length > 0 ? (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.accessor}
                    scope="col"
                    className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${
                      sortable && column.sortable ? 'cursor-pointer' : ''
                    }`}
                    onClick={
                      sortable && column.sortable
                        ? () => handleSort(column.accessor)
                        : undefined
                    }
                  >
                    <div className="flex items-center">
                      {column.header}
                      {sortable &&
                        column.sortable &&
                        sortConfig.key === column.accessor && (
                          <ChevronDown
                            className={`ml-1 h-4 w-4 ${
                              sortConfig.direction === 'desc'
                                ? 'transform rotate-180'
                                : ''
                            }`}
                          />
                        )}
                    </div>
                  </th>
                ))}

                {actions && (
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {displayData.map((row, rowIndex) => (
                <tr
                  key={row.id || rowIndex}
                  className={`${
                    onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''
                  }`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => (
                    <td
                      key={`${row.id || rowIndex}-${column.accessor}`}
                      className="px-6 py-4 whitespace-nowrap"
                    >
                      {column.cell ? (
                        column.cell(row)
                      ) : (
                        <span className="text-sm text-gray-500">
                          {getNestedValue(row, column.accessor) || '-'}
                        </span>
                      )}
                    </td>
                  ))}

                  {actions && (
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div
                        className="flex justify-end space-x-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {actions.view && (
                          <button
                            onClick={() => actions.view(row)}
                            className="text-indigo-600 hover:text-indigo-900"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        )}

                        {actions.edit && (
                          <button
                            onClick={() => actions.edit(row)}
                            className="text-blue-600 hover:text-blue-900"
                            title="Edit"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                        )}

                        {actions.delete && (
                          <button
                            onClick={() => actions.delete(row)}
                            className="text-red-600 hover:text-red-900"
                            title="Delete"
                          >
                            <Trash className="w-4 h-4" />
                          </button>
                        )}

                        {actions.custom &&
                          actions.custom.map((action, index) => (
                            <button
                              key={index}
                              onClick={() => action.handler(row)}
                              className={
                                action.className ||
                                'text-gray-600 hover:text-gray-900'
                              }
                              title={action.title}
                            >
                              {action.icon}
                            </button>
                          ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="py-12 text-center">
            <p className="text-gray-500">{emptyMessage}</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && filteredData.length > 0 && (
        <div className="px-6 py-3 flex items-center justify-between border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-500">
            Showing{' '}
            <span className="font-medium">
              {Math.min(
                filteredData.length,
                (currentPage - 1) * recordsPerPage + 1,
              )}
            </span>{' '}
            to{' '}
            <span className="font-medium">
              {Math.min(currentPage * recordsPerPage, filteredData.length)}
            </span>{' '}
            of <span className="font-medium">{filteredData.length}</span>{' '}
            results
          </div>

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  )
}

export default DataTable
