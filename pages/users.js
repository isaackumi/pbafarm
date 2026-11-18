// pages/users.js (Updated)
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import UserManagement from '../components/UserManagement'
import MembersPanel from '../components/MembersPanel'
import { PageHeader, FormPage } from '../components/ui'

export default function UsersPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <Layout title="User Management">
        <FormPage width="full">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Users' },
            ]}
            description="Manage farm users, roles, and access."
            related={[
              { label: 'Company settings', href: '/company-settings' },
              { label: 'Approvals', href: '/approvals' },
            ]}
          />
          <div className="space-y-6">
            <MembersPanel />
            <UserManagement />
          </div>
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
