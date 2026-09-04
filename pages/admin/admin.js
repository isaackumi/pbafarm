// pages/admin/companies.js
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { Plus, Edit, Trash, Eye } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, Button } from '../../components/ui'
import DataTable from '../../components/DataTable'
import { useAuth } from '../../contexts/AuthContext'
import companyService from '../../lib/companyService'
import { useToast } from '../../components/Toast'

export default function CompaniesPage() {
  return (
    <ProtectedRoute requiredRole="super_admin">
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
      header: 'Status',
      accessor: 'status',
      sortable: true,
      cell: (row) => row.status || '—',
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
      cell: (row) =>
        row.created_at
          ? new Date(row.created_at).toLocaleDateString()
          : '—',
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
    <Layout title="Company Management">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Admin' },
          { label: 'Companies' },
        ]}
        description="Create and manage companies on the platform."
        related={[
          { label: 'Company registrations', href: '/admin/company-registrations' },
          { label: 'Users', href: '/users' },
        ]}
        actions={
          <Button href="/admin/companies/create" size="sm">
            <Plus className="w-4 h-4" />
            Add Company
          </Button>
        }
      />

        {/* Main Content */}
        <div className="page-card overflow-hidden">
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

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowDeleteModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">
              Confirm Deletion
            </h3>
            <p className="text-sm text-muted mb-4">
              Remove {companyToDelete?.name} from the active company list? The
              company will be marked rejected. Tenant data is not permanently
              deleted.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 border border-input-border rounded-md shadow-sm text-sm font-medium text-chart-ink bg-white hover:bg-foam-deep/40"
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
    </Layout>
  )
}
