// pages/admin/companies.js
import { useState, useEffect } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader } from '../../components/ui'
import DataTable from '../../components/DataTable'
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal'
import DeletionRequestsPanel from '../../components/DeletionRequestsPanel'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../convex/_generated/api'
import { errorMessage } from '../../lib/errorMessage'
import { useToast } from '../../components/Toast'
import { ActAsStartModal } from '../../components/ActAs'

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

  const companiesResult = useQuery(api.companies.list, {})
  const removeCompany = useMutation(api.companies.remove)
  const companies = companiesResult ?? []
  const loading = companiesResult === undefined
  const [actAsCompany, setActAsCompany] = useState(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [companyToDelete, setCompanyToDelete] = useState(null)

  // Check if user has super_admin role
  useEffect(() => {
    if (user && !hasRole('super_admin')) {
      router.push('/dashboard')
    }
  }, [user, hasRole, router])

  const handleDeleteCompany = (company) => {
    setCompanyToDelete(company)
    setShowDeleteModal(true)
  }

  const confirmDelete = async () => {
    if (!companyToDelete) return

    try {
      await removeCompany({ companyId: companyToDelete.id, reason: 'Removed by admin' })

      showToast('success', 'Company deleted successfully')
      setShowDeleteModal(false)
      setCompanyToDelete(null)
    } catch (error) {
      console.error('Error deleting company:', error)
      showToast('error', 'Failed to delete company: ' + errorMessage(error))
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
    {
      header: 'Support',
      accessor: 'id',
      cell: (row) =>
        row.status === 'approved' ? (
          <button
            type="button"
            className="text-sm font-medium text-lake hover:underline"
            onClick={() => setActAsCompany(row)}
          >
            Act as…
          </button>
        ) : (
          '—'
        ),
    },
  ]

  const tableActions = {
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
        description="Approved organizations on the platform. New organizations register themselves and are approved under Company registrations."
        related={[
          { label: 'Company registrations', href: '/admin/company-registrations' },
          { label: 'Users', href: '/users' },
        ]}
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

      <DeletionRequestsPanel />

      <ActAsStartModal company={actAsCompany} onClose={() => setActAsCompany(null)} />

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
