import Head from 'next/head'
import { Settings2 } from 'lucide-react'
import AdminCompanyRegistrationsPage from '../../components/AdminCompanyRegistrationsPage'
import Layout from '../../components/Layout'
import ProtectedRoute from '../../components/ProtectedRoute'
import { GradientButton } from '../../components/ui'
import { useT } from '../../lib/i18n/context'

function RegistrationsScreen() {
  const t = useT()
  return (
    <>
      <Head>
        <title>{t('settingsUi.admin.regTitle')}</title>
      </Head>
      <Layout
        title={t('settingsUi.admin.regTitle')}
        eyebrow={t('settingsUi.admin.regCrumb')}
        actions={
          <GradientButton icon={Settings2} href="/global-settings">
            {t('settingsUi.admin.globalSettings')}
          </GradientButton>
        }
      >
        <AdminCompanyRegistrationsPage />
      </Layout>
    </>
  )
}

export default function AdminRegistrationsPage() {
  return (
    <ProtectedRoute requiredRole="super_admin">
      <RegistrationsScreen />
    </ProtectedRoute>
  )
}
