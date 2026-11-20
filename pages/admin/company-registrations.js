import Head from 'next/head'
import { PenLine } from 'lucide-react'
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
          // Paper 59: pen icon, 1.5px sky ring (#1562D6 → #B9DDF9) around the surface fill.
          <GradientButton icon={PenLine} ring="sky" href="/global-settings">
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
