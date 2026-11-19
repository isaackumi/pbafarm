import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { ClipboardCheck, ExternalLink } from 'lucide-react'
import { Avatar, GhostButton, GradientButton, Pill, Skeleton, Table } from '../../components/ui'
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal'
import DeletionRequestsPanel from '../../components/DeletionRequestsPanel'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../convex/_generated/api'
import { errorMessage } from '../../lib/errorMessage'
import { useToast } from '../../components/Toast'
import { ActAsStartModal } from '../../components/ActAs'
import { useT } from '../../lib/i18n/context'

export default function CompaniesPage() {
  return (
    <ProtectedRoute requiredRole="super_admin">
      <CompaniesList />
    </ProtectedRoute>
  )
}

const STATUS_TONE = { pending: 'amber', approved: 'green', rejected: 'red' }

function CompaniesList() {
  const router = useRouter()
  const t = useT()
  const { user, hasRole } = useAuth()
  const { showToast } = useToast()

  const companiesResult = useQuery(api.companies.list, {})
  const removeCompany = useMutation(api.companies.remove)
  const [actAsCompany, setActAsCompany] = useState(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [companyToDelete, setCompanyToDelete] = useState(null)
  const [tab, setTab] = useState('approved')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (user && !hasRole('super_admin')) {
      router.push('/dashboard')
    }
  }, [user, hasRole, router])

  const companies = useMemo(() => companiesResult ?? [], [companiesResult])
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return companies
      .filter((c) => tab === 'all' || c.status === tab)
      .filter((c) => !q || [c.name, c.abbreviation, c.contact_email, c.contact_phone].some((v) => v && v.toLowerCase().includes(q)))
      .sort((a, b) => b.created_at - a.created_at)
  }, [companies, tab, search])

  const handleDeleteCompany = (company) => {
    setCompanyToDelete(company)
    setShowDeleteModal(true)
  }

  const confirmDelete = async () => {
    if (!companyToDelete) return
    try {
      await removeCompany({ companyId: companyToDelete.id, reason: 'Removed by admin' })
      showToast('success', t('settingsUi.admin.tenants.removed'))
      setShowDeleteModal(false)
      setCompanyToDelete(null)
    } catch (error) {
      showToast('error', errorMessage(error, t('settingsUi.admin.tenants.removeFailed')))
    }
  }

  const columns = [
    {
      key: 'name',
      header: t('settingsUi.admin.col.company'),
      render: (c) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={c.name} size={32} />
          <div className="min-w-0">
            <p className="truncate text-[15px] leading-5 text-text">{c.name}</p>
            <p className="truncate text-[13px] leading-4 text-muted">{c.abbreviation || c.code}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'contact',
      header: t('settingsUi.admin.col.contact'),
      render: (c) => (
        <div className="min-w-0">
          <p className="truncate">{c.contact_email || '—'}</p>
          {c.contact_phone && <p className="truncate text-[13px] leading-4 text-muted">{c.contact_phone}</p>}
        </div>
      ),
    },
    { key: 'users', header: t('settingsUi.admin.col.users'), align: 'right', render: (c) => c.user_count || 0 },
    {
      key: 'created',
      header: t('settingsUi.admin.col.created'),
      render: (c) => (c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'),
    },
    {
      key: 'status',
      header: t('settingsUi.admin.col.status'),
      render: (c) => (
        <Pill tone={STATUS_TONE[c.status] || 'neutral'}>{t(`settingsUi.admin.status.${STATUS_TONE[c.status] ? c.status : 'pending'}`)}</Pill>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('settingsUi.admin.col.actions')}</span>,
      align: 'right',
      render: (c) => (
        <div className="flex justify-end gap-2">
          {c.status === 'approved' && (
            <GhostButton size="sm" icon={ExternalLink} onClick={() => setActAsCompany(c)}>
              {t('settingsUi.admin.tenants.actAs')}
            </GhostButton>
          )}
          {c.status !== 'rejected' && (
            <GhostButton
              size="sm"
              tone="danger"
              onClick={() => handleDeleteCompany(c)}
              aria-label={t('settingsUi.admin.tenants.removeNamed', { name: c.name })}
            >
              {t('settingsUi.admin.tenants.remove')}
            </GhostButton>
          )}
        </div>
      ),
    },
  ]

  const count = (status) => companies.filter((c) => c.status === status).length

  return (
    <Layout
      title={t('settingsUi.admin.tenants.title')}
      eyebrow={t('settingsUi.admin.tenants.crumb')}
      actions={
        <GradientButton icon={ClipboardCheck} href="/admin/company-registrations">
          {t('settingsUi.admin.regTitle')}
        </GradientButton>
      }
    >
      <div className="flex flex-col gap-6">
        <p className="max-w-3xl text-[14px] leading-[18px] text-muted">{t('settingsUi.admin.tenants.description')}</p>
        {companiesResult === undefined ? (
          <Skeleton className="h-72" />
        ) : (
          <Table
            title={t('settingsUi.admin.tenants.title')}
            tabsLabel={t('settingsUi.admin.tenants.title')}
            tabs={[
              { value: 'approved', label: `${t('settingsUi.admin.status.approved')} ${count('approved')}` },
              { value: 'pending', label: `${t('settingsUi.admin.status.pending')} ${count('pending')}` },
              { value: 'rejected', label: `${t('settingsUi.admin.status.rejected')} ${count('rejected')}` },
              { value: 'all', label: t('settingsUi.admin.tenants.all') },
            ]}
            tab={tab}
            onTabChange={setTab}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={t('settingsUi.admin.search')}
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            empty={t('settingsUi.admin.empty')}
          />
        )}

        <DeletionRequestsPanel />
      </div>

      <ActAsStartModal company={actAsCompany} onClose={() => setActAsCompany(null)} />

      <ConfirmDeleteModal
        open={showDeleteModal}
        title={t('settingsUi.admin.tenants.removeTitle')}
        message={t('settingsUi.admin.tenants.removeMessage', { name: companyToDelete?.name || '' })}
        confirmLabel={t('settingsUi.admin.tenants.remove')}
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={confirmDelete}
      />
    </Layout>
  )
}
