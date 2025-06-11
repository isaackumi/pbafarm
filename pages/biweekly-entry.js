import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import BiweeklyEntryForm from '../components/BiweeklyEntryForm'
import { Search, Filter, X } from 'lucide-react'
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
  const [sortBy, setSortBy] = useState('name')
  const [sortOrder, setSortOrder] = useState('asc')

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

  const filteredCages = cages
    .filter(cage => {
      const matchesSearch = 
        cage.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cage.code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cage.location?.toLowerCase().includes(searchQuery.toLowerCase())
      
      const matchesStatus = statusFilter === 'all' || cage.status === statusFilter
      
      return matchesSearch && matchesStatus
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

        {/* Filters and Search */}
        <div className="mb-6 space-y-4 sm:space-y-0 sm:flex sm:items-center sm:space-x-4">
          <div className="flex-1">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search cages by name, code, or location..."
                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="maintenance">Maintenance</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => handleSort(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
            >
              <option value="name">Sort by Name</option>
              <option value="code">Sort by Code</option>
              <option value="location">Sort by Location</option>
              <option value="status">Sort by Status</option>
            </select>
          </div>
        </div>

        {/* Cages Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCages.map((cage) => (
            <button
              key={cage.id}
              onClick={() => setSelectedCage(cage)}
              className="relative block w-full p-6 bg-white border border-gray-200 rounded-lg hover:border-indigo-500 hover:ring-1 hover:ring-indigo-500 focus:outline-none"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{cage.name}</h3>
                  {cage.code && (
                    <p className="mt-1 text-sm text-gray-500">Code: {cage.code}</p>
                  )}
                </div>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  cage.status === 'active' ? 'bg-green-100 text-green-800' :
                  cage.status === 'inactive' ? 'bg-gray-100 text-gray-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {cage.status}
                </span>
              </div>
              {cage.location && (
                <p className="mt-2 text-sm text-gray-500">
                  Location: {cage.location}
                </p>
              )}
              {cage.latest_abw && (
                <p className="mt-2 text-sm text-gray-500">
                  Latest ABW: {cage.latest_abw.toFixed(1)}g
                </p>
              )}
            </button>
          ))}
        </div>

        {filteredCages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No cages found matching your criteria</p>
          </div>
        )}
      </div>
    </Layout>
  )
} 