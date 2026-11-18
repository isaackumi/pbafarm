import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button, FormPage, Field, Input, Select } from '../components/ui'
import BiweeklyEntryForm from '../components/BiweeklyEntryForm'
import { Search, Filter, X, Calendar, MapPin } from 'lucide-react'
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
      <Layout title="Bi-weekly entry">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lake"></div>
        </div>
      </Layout>
    )
  }

  if (selectedCage) {
    return (
      <Layout title="Bi-weekly entry">
        <FormPage width="full">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Bi-weekly records', href: '/biweekly-records' },
              { label: 'Entry' },
              { label: selectedCage.name || 'Cage' },
            ]}
            description="Enter bi-weekly sampling for the selected cage."
            related={[
              { label: 'All records', href: '/biweekly-records' },
              { label: 'Daily entry', href: '/daily-entry' },
            ]}
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedCage(null)}
              >
                <X className="w-4 h-4" aria-hidden />
                Back to cages
              </Button>
            }
          />
          <BiweeklyEntryForm
            cage={selectedCage}
            onComplete={() => {
              setSelectedCage(null)
              fetchCages()
            }}
          />
        </FormPage>
      </Layout>
    )
  }

  return (
    <Layout title="Bi-weekly entry">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Bi-weekly records', href: '/biweekly-records' },
          { label: 'Entry' },
        ]}
        description="Select a cage to enter bi-weekly sampling records."
        related={[
          { label: 'All records', href: '/biweekly-records' },
          { label: 'Daily entry', href: '/daily-entry' },
          { label: 'Harvest sampling', href: '/harvest-sampling' },
        ]}
        actions={
          <Button href="/biweekly-records" variant="secondary" size="sm">
            View records
          </Button>
        }
      />

        {/* Enhanced Search and Filters */}
        <div className="mb-6 page-card p-4">
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-muted" aria-hidden />
              </div>
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, code or location"
                aria-label="Search cages"
                className="pl-10"
              />
            </div>

            {/* Filter Toggle */}
            <div className="flex items-center justify-between">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                aria-expanded={showFilters}
              >
                <Filter className="w-4 h-4" aria-hidden />
                {showFilters ? 'Hide filters' : 'Show filters'}
              </Button>

              {(searchQuery || statusFilter !== 'active' || locationFilter !== 'all' || sizeFilter !== 'all' || growthFilter !== 'all') && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-lake">
                  Clear all filters
                </Button>
              )}
            </div>

            {/* Advanced Filters */}
            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-foam-deep">
                <Field label="Status" htmlFor="biweekly-entry-status">
                  <Select
                    id="biweekly-entry-status"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="harvested">Harvested</option>
                  </Select>
                </Field>

                <Field label="Location" htmlFor="biweekly-entry-location">
                  <Select
                    id="biweekly-entry-location"
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                  >
                    <option value="all">All locations</option>
                    {uniqueLocations.map(location => (
                      <option key={location} value={location}>{location}</option>
                    ))}
                  </Select>
                </Field>

                <Field label="Size" htmlFor="biweekly-entry-size">
                  <Select
                    id="biweekly-entry-size"
                    value={sizeFilter}
                    onChange={(e) => setSizeFilter(e.target.value)}
                  >
                    <option value="all">All sizes</option>
                    <option value="Small (<50m³)">Small (&lt;50m³)</option>
                    <option value="Medium (50-100m³)">Medium (50-100m³)</option>
                    <option value="Large (>100m³)">Large (&gt;100m³)</option>
                  </Select>
                </Field>

                <Field label="Growth rate" htmlFor="biweekly-entry-growth-rate">
                  <Select
                    id="biweekly-entry-growth-rate"
                    value={growthFilter}
                    onChange={(e) => setGrowthFilter(e.target.value)}
                  >
                    <option value="all">All growth rates</option>
                    <option value="Low (<50%)">Low (&lt;50%)</option>
                    <option value="Medium (50-100%)">Medium (50-100%)</option>
                    <option value="High (>100%)">High (&gt;100%)</option>
                  </Select>
                </Field>
              </div>
            )}

            {/* Sort Options */}
            <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-foam-deep">
              <label htmlFor="biweekly-sort" className="text-sm font-semibold text-chart-ink">Sort by</label>
              <Select
                id="biweekly-sort"
                value={sortBy}
                onChange={(e) => handleSort(e.target.value)}
                className="w-auto"
              >
                <option value="name">Name</option>
                <option value="code">Code</option>
                <option value="location">Location</option>
                <option value="status">Status</option>
                <option value="size">Size</option>
                <option value="growth_rate">Growth rate</option>
                <option value="stocking_date">Stocking date</option>
              </Select>
              <Button
                variant="secondary"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                aria-label={sortOrder === 'asc' ? 'Sort ascending' : 'Sort descending'}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </Button>
            </div>
          </div>
        </div>

        {/* Results Summary */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted">
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
                type="button"
                onClick={() => setSelectedCage(cage)}
                className="relative block w-full text-left bg-surface border border-foam-deep rounded-xl shadow-sm hover:border-lake transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
              >
                {/* Header */}
                <div className="p-5 border-b border-foam-deep">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display text-lg font-medium text-chart-ink truncate">{cage.name}</h3>
                      {cage.code && (
                        <p className="text-sm text-muted font-data">{cage.code}</p>
                      )}
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      cage.status === 'active' ? 'bg-kelp/15 text-kelp' :
                      cage.status === 'inactive' ? 'bg-foam-deep/60 text-muted' :
                      cage.status === 'maintenance' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' :
                      'bg-signal/15 text-signal'
                    }`}>
                      {cage.status}
                    </span>
                  </div>
                  
                  {cage.location && (
                    <div className="flex items-center text-sm text-muted mb-2">
                      <MapPin className="w-4 h-4 mr-1 flex-shrink-0" />
                      <span className="truncate">{cage.location}</span>
                    </div>
                  )}
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                  {/* DOC and Stocking Info */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center text-sm text-muted">
                      <Calendar className="w-4 h-4 mr-1 flex-shrink-0" />
                      <span className="tabular-nums">DOC: {doc ? `${doc} days` : 'Not stocked'}</span>
                    </div>
                    {cage.stocking_date && (
                      <span className="text-xs text-muted">
                        {new Date(cage.stocking_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  {/* Size and Capacity */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-3 bg-foam rounded-lg">
                      <div className="text-sm font-medium text-chart-ink tabular-nums">
                        {cage.size ? `${cage.size}m³` : 'N/A'}
                      </div>
                      <div className="text-xs text-muted">{sizeCategory}</div>
                    </div>
                    <div className="text-center p-3 bg-foam rounded-lg">
                      <div className="text-sm font-medium text-chart-ink tabular-nums">
                        {cage.current_count || cage.initial_count || 'N/A'}
                      </div>
                      <div className="text-xs text-muted">Fish count</div>
                    </div>
                  </div>

                  {/* Growth Metrics */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Growth rate</span>
                      <span className={`font-medium tabular-nums ${
                        cage.growth_rate > 100 ? 'text-kelp' :
                        cage.growth_rate > 50 ? 'text-amber-700 dark:text-amber-300' :
                        'text-muted'
                      }`}>
                        {cage.growth_rate ? `${cage.growth_rate}%` : 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Current weight</span>
                      <span className="font-medium text-chart-ink tabular-nums">
                        {cage.current_weight ? `${cage.current_weight}g` : 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Mortality rate</span>
                      <span className={`font-medium tabular-nums ${
                        cage.mortality_rate > 10 ? 'text-signal' :
                        cage.mortality_rate > 5 ? 'text-amber-700 dark:text-amber-300' :
                        'text-kelp'
                      }`}>
                        {cage.mortality_rate ? `${cage.mortality_rate}%` : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-3 bg-foam rounded-b-xl">
                  <div className="text-center">
                    <span className="text-sm font-medium text-lake">
                      Enter bi-weekly data
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {filteredCages.length === 0 && (
          <div className="text-center py-12">
            <h3 className="text-base font-semibold text-chart-ink">No cages found</h3>
            <p className="mt-1 text-sm text-muted">
              Try adjusting your search or filter criteria.
            </p>
            <div className="mt-6">
              <Button onClick={clearFilters}>Clear all filters</Button>
            </div>
          </div>
        )}
    </Layout>
  )
} 