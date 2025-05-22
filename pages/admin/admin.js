// pages/admin/companies.js
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { Plus, ArrowLeft, Edit, Trash, Eye } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import DataTable from '../../components/DataTable'
import { useAuth } from '../../contexts/AuthContext'
import companyService from '../../lib/companyService'
import { useToast } from '../../components/Toast'

export default function CompaniesPage() {
  return (
    <ProtectedRoute>
      <CompaniesList />
    </ProtectedRoute>
  )
}

function CompaniesList() {
  const router = useRouter()
  const { user, hasRole } = useAuth()
  const { showToast } = useToast()

  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [companyToDelete, setCompanyToDelete] = useState(null)

  // Check if user has super_admin role
  useEffect(() => {
    if (user && !hasRole('super_admin')) {
      router.push('/dashboard')
    }
  }, [user, hasRole, router])

  // Fetch companies
  useEffect(() => {
    async function fetchCompanies() {
      setLoading(true)
      try {
        const { data, error } = await companyService.getAllCompanies()

        if (error) throw error

        setCompanies(data || [])
      } catch (error) {
        console.error('Error fetching companies:', error)
        setError('Failed to load companies')
        showToast('error', 'Failed to load companies')
      } finally {
        setLoading(false)
      }
    }

    fetchCompanies()
  }, [])

  const handleDeleteCompany = (company) => {
    setCompanyToDelete(company)
    setShowDeleteModal(true)
  }

  const confirmDelete = async () => {
    if (!companyToDelete) return

    try {
      const { error } = await companyService.deleteCompany(companyToDelete.id)

      if (error) throw error

      showToast('success', 'Company deleted successfully')
      setCompanies(companies.filter((c) => c.id !== companyToDelete.id))
      setShowDeleteModal(false)
      setCompanyToDelete(null)
    } catch (error) {
      console.error('Error deleting company:', error)
      showToast('error', 'Failed to delete company: ' + error.message)
    }
  }

  const columns = [
    {
      header: 'Company Name',
      accessor: 'name',
      sortable: true,
      searchable: true,
    },
    {
      header: 'Abbreviation',
      accessor: 'abbreviation',
      sortable: true,
    },
    {
      header: 'Contact Email',
      accessor: 'contact_email',
      sortable: true,
    },
    {
      header: 'Contact Phone',
      accessor: 'contact_phone',
    },
    {
      header: 'Created',
      accessor: 'created_at',
      sortable: true,
      cell: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      header: 'Users',
      accessor: 'user_count',
      sortable: true,
      cell: (row) => row.user_count || 0,
    },
  ]

  const tableActions = {
    view: (row) => router.push(`/admin/companies/${row.id}`),
    edit: (row) => router.push(`/admin/companies/${row.id}/edit`),
    delete: (row) => handleDeleteCompany(row),
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
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              Company Management
            </h1>
          </div>

          <Link href="/admin/companies/create">
            <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Company
            </button>
          </Link>
        </div>

        {/* Main Content */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <DataTable
            data={companies}
            columns={columns}
            loading={loading}
            pagination={true}
            actions={tableActions}
            searchable={true}
            sortable={true}
            emptyMessage="No companies found."
          />
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowDeleteModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Confirm Deletion
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Are you sure you want to delete {companyToDelete?.name}? This
              action cannot be undone and will remove ALL data associated with
              this company.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
