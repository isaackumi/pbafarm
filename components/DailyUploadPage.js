// components/DailyUploadPage.js
import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  ArrowLeft, 
  Search, 
  Filter, 
  Grid, 
  List, 
  ChevronDown,
  ChevronUp,
  X,
  RefreshCw
} from 'lucide-react'
import DailyEntryForm from './DailyEntryForm'
import { cageService } from '../lib/databaseService'

const statusColors = {
  active: 'bg-green-100 text-green-800',
  harvested: 'bg-blue-100 text-blue-800',
  harvesting: 'bg-orange-100 text-orange-800',
  maintenance: 'bg-yellow-100 text-yellow-800',
  fallow: 'bg-gray-100 text-gray-800',
  empty: 'bg-purple-100 text-purple-800',
}

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'harvested', label: 'Harvested' },
  { value: 'harvesting', label: 'Harvesting' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'fallow', label: 'Fallow' },
  { value: 'empty', label: 'Empty' },
]

const sortOptions = [
  { value: 'name', label: 'Name' },
  { value: 'code', label: 'Code' },
  { value: 'location', label: 'Location' },
  { value: 'capacity', label: 'Capacity' },
]

const DailyUploadPage = () => {
  const [cages, setCages] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCage, setSelectedCage] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedStatus, setSelectedStatus] = useState(['active'])
  const [viewMode, setViewMode] = useState('grid') // 'grid' or 'list'
  const [sortBy, setSortBy] = useState('name')
  const [sortDirection, setSortDirection] = useState('asc')
  const [showFilters, setShowFilters] = useState(false)
  const [compactView, setCompactView] = useState(false)
  const [page, setPage] = useState(1)
  const cagesPerPage = 12

  useEffect(() => {
    fetchCages()
  }, [])

  const fetchCages = async () => {
    setLoading(true)
    const { data, error } = await cageService.getAllCages()
    setCages(data || [])
    setLoading(false)
  }

  const filteredCages = cages
    .filter(cage => {
      const matchesSearch = 
        cage.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cage.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (cage.location && cage.location.toLowerCase().includes(searchQuery.toLowerCase()))
      
      const matchesStatus = selectedStatus.includes(cage.status)
      
      return matchesSearch && matchesStatus
    })
    .sort((a, b) => {
      const aValue = a[sortBy] || ''
      const bValue = b[sortBy] || ''
      const comparison = aValue.localeCompare(bValue)
      return sortDirection === 'asc' ? comparison : -comparison
    })

  const paginatedCages = filteredCages.slice(
    (page - 1) * cagesPerPage,
    page * cagesPerPage
  )

  const totalPages = Math.ceil(filteredCages.length / cagesPerPage)

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDirection('asc')
    }
  }

  const handleStatusToggle = (status) => {
    setSelectedStatus(prev => 
      prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
    )
    setPage(1)
  }

  const clearFilters = () => {
    setSearchQuery('')
    setSelectedStatus(['active'])
    setSortBy('name')
    setSortDirection('asc')
    setPage(1)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-lg text-gray-700">Loading cages...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 font-montserrat">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Link
              href="/dashboard"
              className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
            >
              <ArrowLeft className="w-5 h-5 mr-1" />
              Back to Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              Daily Records Upload
            </h1>
          </div>
          <button
            onClick={fetchCages}
            className="text-gray-600 hover:text-gray-800"
            title="Refresh cages"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {!selectedCage ? (
          <div>
            <div className="mb-6">
              <p className="text-gray-600">
                Select a cage to enter daily records. Use filters to find specific cages.
              </p>
            </div>

            {/* Search and Filter Bar */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
              <div className="flex flex-wrap gap-4 items-center">
                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="text"
                      placeholder="Search cages..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>

                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  <Filter className="w-4 h-4 mr-2" />
                  Filters
                  {showFilters ? <ChevronUp className="w-4 h-4 ml-2" /> : <ChevronDown className="w-4 h-4 ml-2" />}
                </button>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-2 rounded-md ${viewMode === 'grid' ? 'bg-indigo-100 text-indigo-600' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    <Grid className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-2 rounded-md ${viewMode === 'list' ? 'bg-indigo-100 text-indigo-600' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    <List className="w-5 h-5" />
                  </button>
                </div>

                <button
                  onClick={() => setCompactView(!compactView)}
                  className={`px-3 py-2 text-sm font-medium rounded-md ${
                    compactView ? 'bg-indigo-100 text-indigo-600' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Compact View
                </button>
              </div>

              {/* Expanded Filters */}
              {showFilters && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                      <div className="flex flex-wrap gap-2">
                        {statusOptions.map(status => (
                          <button
                            key={status.value}
                            onClick={() => handleStatusToggle(status.value)}
                            className={`px-3 py-1 rounded-full text-sm font-medium ${
                              selectedStatus.includes(status.value)
                                ? statusColors[status.value]
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {status.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
                      <div className="flex gap-2">
                        {sortOptions.map(option => (
                          <button
                            key={option.value}
                            onClick={() => handleSort(option.value)}
                            className={`px-3 py-1 rounded-md text-sm font-medium ${
                              sortBy === option.value
                                ? 'bg-indigo-100 text-indigo-600'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {option.label}
                            {sortBy === option.value && (
                              <span className="ml-1">
                                {sortDirection === 'asc' ? '↑' : '↓'}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={clearFilters}
                      className="ml-auto px-3 py-1 text-sm font-medium text-gray-600 hover:text-gray-800"
                    >
                      Clear Filters
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Results Count */}
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Showing {filteredCages.length} cages
              </p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-sm text-gray-600 hover:text-gray-800 flex items-center"
                >
                  Clear search
                  <X className="w-4 h-4 ml-1" />
                </button>
              )}
            </div>

            {/* Cage Grid/List */}
            {viewMode === 'grid' ? (
              <div className={`grid gap-6 ${
                compactView 
                  ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'
                  : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
              }`}>
                {paginatedCages.map(cage => (
                  <button
                    key={cage.id}
                    onClick={() => setSelectedCage(cage)}
                    className={`bg-white rounded-lg shadow hover:shadow-lg transition p-4 flex flex-col items-start border border-gray-200 hover:border-indigo-400 focus:outline-none ${
                      compactView ? 'text-sm' : ''
                    }`}
                  >
                    <div className="flex items-center mb-2 w-full justify-between">
                      <span className={`font-semibold text-gray-900 ${compactView ? 'text-base' : 'text-lg'}`}>
                        {cage.name}
                      </span>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[cage.status] || 'bg-gray-100 text-gray-800'}`}>
                        {cage.status.charAt(0).toUpperCase() + cage.status.slice(1)}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 mb-1">
                      Code: <span className="font-mono">{cage.code}</span>
                    </div>
                    {!compactView && (
                      <>
                        {cage.location && (
                          <div className="text-xs text-gray-400 mb-1">
                            Location: {cage.location}
                          </div>
                        )}
                        {cage.capacity && (
                          <div className="text-xs text-gray-400">
                            Capacity: {cage.capacity}
                          </div>
                        )}
                      </>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Code
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Location
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Capacity
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {paginatedCages.map(cage => (
                      <tr
                        key={cage.id}
                        onClick={() => setSelectedCage(cage)}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {cage.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {cage.code}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[cage.status] || 'bg-gray-100 text-gray-800'}`}>
                            {cage.status.charAt(0).toUpperCase() + cage.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {cage.location || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {cage.capacity || 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex justify-center">
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className={`relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium ${
                      page === 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    Previous
                  </button>
                  {[...Array(totalPages)].map((_, i) => (
                    <button
                      key={i + 1}
                      onClick={() => setPage(i + 1)}
                      className={`relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium ${
                        page === i + 1
                          ? 'z-10 bg-indigo-50 border-indigo-500 text-indigo-600'
                          : 'text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className={`relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium ${
                      page === totalPages ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    Next
                  </button>
                </nav>
              </div>
            )}

            {filteredCages.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500">No cages found matching your criteria.</p>
                <button
                  onClick={clearFilters}
                  className="mt-4 text-indigo-600 hover:text-indigo-800"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-6">
            <button
              onClick={() => setSelectedCage(null)}
              className="mb-4 text-indigo-600 hover:text-indigo-800 flex items-center"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Cage Selection
            </button>
            <div className="mb-4">
              <div className="text-lg font-semibold text-gray-900">
                {selectedCage.name} <span className="text-xs text-gray-500">({selectedCage.code})</span>
              </div>
              <div className="text-xs text-gray-500">
                Location: {selectedCage.location || 'N/A'} | Capacity: {selectedCage.capacity || 'N/A'}
              </div>
            </div>
            <DailyEntryForm cage={selectedCage} />
          </div>
        )}
      </div>
    </div>
  )
}

export default DailyUploadPage
