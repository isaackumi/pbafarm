// pages/admin/companies.js
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { Plus, Edit, Trash, Eye } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, Button } from '../../components/ui'
import DataTable from '../../components/DataTable'
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal'
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
      header: 'Company name',
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
      header: 'Contact email',
      accessor: 'contact_email',
      sortable: true,
    },
    {
      header: 'Contact phone',
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
    <Layout title="Company management">
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
            Add company
          </Button>
        }
      />

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

      <ConfirmDeleteModal
        open={showDeleteModal}
        title="Remove company?"
        message={`Remove ${companyToDelete?.name || 'this company'} from the active company list? The company will be marked rejected. Tenant data is not permanently deleted.`}
        confirmLabel="Remove company"
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={confirmDelete}
      />
    </Layout>
  )
}
