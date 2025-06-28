import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import BiweeklyEntryForm from '../components/BiweeklyEntryForm'
import { Search, Filter, X, Calendar, MapPin, Fish, TrendingUp, Activity } from 'lucide-react'
import { cageService } from '../lib/databaseService'

export default function BiweeklyEntryPage() {
  return (
    <ProtectedRoute>
      <BiweeklyEntry />
    </ProtectedRoute>
  )
}

function BiweeklyEntry() {
  const router = useRouter()
  const [cages, setCages] = useState([])
  const [selectedCage, setSelectedCage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [locationFilter, setLocationFilter] = useState('all')
  const [sizeFilter, setSizeFilter] = useState('all')
  const [growthFilter, setGrowthFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [sortOrder, setSortOrder] = useState('asc')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    fetchCages()
  }, [])

  const fetchCages = async () => {
    setLoading(true)
    try {
      const { data, error } = await cageService.getAllCages()
      if (error) throw error
      setCages(data || [])
    } catch (error) {
      console.error('Error fetching cages:', error)
    } finally {
      setLoading(false)
    }
  }

  // Calculate Days of Culture (DOC)
  const calculateDOC = (stockingDate) => {
    if (!stockingDate) return null
    const today = new Date()
    const stocking = new Date(stockingDate)
    const diffTime = Math.abs(today - stocking)
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  // Get unique locations for filter
  const uniqueLocations = [...new Set(cages.map(cage => cage.location).filter(Boolean))]

  // Get size categories
  const getSizeCategory = (size) => {
    if (!size) return 'Unknown'
    if (size < 50) return 'Small (<50m³)'
    if (size < 100) return 'Medium (50-100m³)'
    return 'Large (>100m³)'
  }

  // Get growth rate category
  const getGrowthCategory = (growthRate) => {
    if (!growthRate) return 'Unknown'
    if (growthRate < 50) return 'Low (<50%)'
    if (growthRate < 100) return 'Medium (50-100%)'
    return 'High (>100%)'
  }

  const filteredCages = cages
    .filter(cage => {
      const matchesSearch = 
        cage.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cage.code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cage.location?.toLowerCase().includes(searchQuery.toLowerCase())
      
      const matchesStatus = statusFilter === 'all' || cage.status === statusFilter
      const matchesLocation = locationFilter === 'all' || cage.location === locationFilter
      const matchesSize = sizeFilter === 'all' || getSizeCategory(cage.size) === sizeFilter
      const matchesGrowth = growthFilter === 'all' || getGrowthCategory(cage.growth_rate) === growthFilter
      
      return matchesSearch && matchesStatus && matchesLocation && matchesSize && matchesGrowth
    })
    .sort((a, b) => {
      let valueA = a[sortBy]
      let valueB = b[sortBy]

      // Handle null/undefined values
      if (valueA == null) return sortOrder === 'asc' ? -1 : 1
      if (valueB == null) return sortOrder === 'asc' ? 1 : -1

      // Handle numeric values
      if (typeof valueA === 'number' && typeof valueB === 'number') {
        return sortOrder === 'asc' ? valueA - valueB : valueB - valueA
      }

      // Convert to strings for comparison
      valueA = String(valueA).toLowerCase()
      valueB = String(valueB).toLowerCase()

      return sortOrder === 'asc' 
        ? valueA.localeCompare(valueB)
        : valueB.localeCompare(valueA)
    })

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
  }

  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('active')
    setLocationFilter('all')
    setSizeFilter('all')
    setGrowthFilter('all')
    setSortBy('name')
    setSortOrder('asc')
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      </Layout>
    )
  }

  if (selectedCage) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <button
              onClick={() => setSelectedCage(null)}
              className="text-indigo-600 hover:text-indigo-800 flex items-center"
            >
              <X className="w-4 h-4 mr-2" />
              Back to Cage Selection
            </button>
          </div>
          <BiweeklyEntryForm 
            cage={selectedCage} 
            onComplete={() => {
              setSelectedCage(null)
              fetchCages()
            }}
          />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Bi-weekly Records Entry</h1>
          <p className="mt-2 text-sm text-gray-600">
            Select a cage to enter bi-weekly sampling records
          </p>
        </div>

        {/* Enhanced Search and Filters */}
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search cages by name, code, or location..."
                className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>

            {/* Filter Toggle */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <Filter className="w-4 h-4 mr-2" />
                {showFilters ? 'Hide Filters' : 'Show Filters'}
              </button>

              {(searchQuery || statusFilter !== 'active' || locationFilter !== 'all' || sizeFilter !== 'all' || growthFilter !== 'all') && (
                <button
                  onClick={clearFilters}
                  className="text-sm text-indigo-600 hover:text-indigo-800"
                >
                  Clear all filters
                </button>
              )}
            </div>

            {/* Advanced Filters */}
            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="block w-full px-3 py-2 text-sm border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="harvested">Harvested</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                  <select
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    className="block w-full px-3 py-2 text-sm border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="all">All Locations</option>
                    {uniqueLocations.map(location => (
                      <option key={location} value={location}>{location}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Size</label>
                  <select
                    value={sizeFilter}
                    onChange={(e) => setSizeFilter(e.target.value)}
                    className="block w-full px-3 py-2 text-sm border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="all">All Sizes</option>
                    <option value="Small (<50m³)">Small (&lt;50m³)</option>
                    <option value="Medium (50-100m³)">Medium (50-100m³)</option>
                    <option value="Large (>100m³)">Large (&gt;100m³)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Growth Rate</label>
                  <select
                    value={growthFilter}
                    onChange={(e) => setGrowthFilter(e.target.value)}
                    className="block w-full px-3 py-2 text-sm border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="all">All Growth Rates</option>
                    <option value="Low (<50%)">Low (&lt;50%)</option>
                    <option value="Medium (50-100%)">Medium (50-100%)</option>
                    <option value="High (>100%)">High (&gt;100%)</option>
                  </select>
                </div>
              </div>
            )}

            {/* Sort Options */}
            <div className="flex items-center space-x-4 pt-4 border-t border-gray-200">
              <label className="text-sm font-medium text-gray-700">Sort by:</label>
              <select
                value={sortBy}
                onChange={(e) => handleSort(e.target.value)}
                className="block px-3 py-2 text-sm border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="name">Name</option>
                <option value="code">Code</option>
                <option value="location">Location</option>
                <option value="status">Status</option>
                <option value="size">Size</option>
                <option value="growth_rate">Growth Rate</option>
                <option value="stocking_date">Stocking Date</option>
              </select>
              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>
        </div>

        {/* Results Summary */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Showing {filteredCages.length} of {cages.length} cages
          </p>
        </div>

        {/* Enhanced Cages Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCages.map((cage) => {
            const doc = calculateDOC(cage.stocking_date)
            const sizeCategory = getSizeCategory(cage.size)
            const growthCategory = getGrowthCategory(cage.growth_rate)
            
            return (
              <button
                key={cage.id}
                onClick={() => setSelectedCage(cage)}
                className="relative block w-full bg-white border border-gray-200 rounded-xl hover:border-indigo-500 hover:ring-2 hover:ring-indigo-500 hover:shadow-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {/* Header */}
                <div className="p-6 border-b border-gray-100">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold text-gray-900 truncate">{cage.name}</h3>
                      {cage.code && (
                        <p className="text-sm text-gray-500 font-mono">{cage.code}</p>
                      )}
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      cage.status === 'active' ? 'bg-green-100 text-green-800' :
                      cage.status === 'inactive' ? 'bg-gray-100 text-gray-800' :
                      cage.status === 'maintenance' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {cage.status}
                    </span>
                  </div>
                  
                  {cage.location && (
                    <div className="flex items-center text-sm text-gray-600 mb-2">
                      <MapPin className="w-4 h-4 mr-1 flex-shrink-0" />
                      <span className="truncate">{cage.location}</span>
                    </div>
                  )}
                </div>

                {/* Body */}
                <div className="p-6 space-y-4">
                  {/* DOC and Stocking Info */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center text-sm text-gray-600">
                      <Calendar className="w-4 h-4 mr-1 flex-shrink-0" />
                      <span>DOC: {doc ? `${doc} days` : 'Not stocked'}</span>
                    </div>
                    {cage.stocking_date && (
                      <span className="text-xs text-gray-500">
                        {new Date(cage.stocking_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  {/* Size and Capacity */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-sm font-medium text-gray-900">
                        {cage.size ? `${cage.size}m³` : 'N/A'}
                      </div>
                      <div className="text-xs text-gray-500">{sizeCategory}</div>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-sm font-medium text-gray-900">
                        {cage.current_count || cage.initial_count || 'N/A'}
                      </div>
                      <div className="text-xs text-gray-500">Fish Count</div>
                    </div>
                  </div>

                  {/* Growth Metrics */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Growth Rate:</span>
                      <span className={`font-medium ${
                        cage.growth_rate > 100 ? 'text-green-600' :
                        cage.growth_rate > 50 ? 'text-yellow-600' :
                        'text-gray-600'
                      }`}>
                        {cage.growth_rate ? `${cage.growth_rate}%` : 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Current Weight:</span>
                      <span className="font-medium text-gray-900">
                        {cage.current_weight ? `${cage.current_weight}g` : 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Mortality Rate:</span>
                      <span className={`font-medium ${
                        cage.mortality_rate > 10 ? 'text-red-600' :
                        cage.mortality_rate > 5 ? 'text-yellow-600' :
                        'text-green-600'
                      }`}>
                        {cage.mortality_rate ? `${cage.mortality_rate}%` : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 bg-gray-50 rounded-b-xl">
                  <div className="text-center">
                    <span className="text-sm font-medium text-indigo-600">
                      Click to enter bi-weekly data
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {filteredCages.length === 0 && (
          <div className="text-center py-12">
            <div className="mx-auto h-12 w-12 text-gray-400">
              <Search className="h-12 w-12" />
            </div>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No cages found</h3>
            <p className="mt-1 text-sm text-gray-500">
              Try adjusting your search or filter criteria.
            </p>
            <div className="mt-6">
              <button
                onClick={clearFilters}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Clear all filters
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
} 