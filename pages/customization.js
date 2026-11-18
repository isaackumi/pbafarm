import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { EmptyState, PageHeader, TabBar } from '../components/ui'
import FieldsBuilder from '../components/customization/FieldsBuilder'
import TerminologyEditor from '../components/customization/TerminologyEditor'
import FormLayoutEditor from '../components/customization/FormLayoutEditor'
import DashboardLayoutEditor from '../components/customization/DashboardLayoutEditor'
import { usePermission } from '../hooks/usePermission'
import { useT } from '../lib/i18n/context'

/** Settings → Customization (D-007): one place for the organization's configuration. */
const TAB_IDS = ['fields', 'words', 'forms', 'dashboard']

export default function CustomizationPage() {
  return (
    <ProtectedRoute>
      <Layout title="Customization">
        <Customization />
      </Layout>
    </ProtectedRoute>
  )
}

function Customization() {
  const router = useRouter()
  const t = useT()
  const tabs = TAB_IDS.map((id) => ({ id, label: t(`customizePage.tab.${id}`) }))
  const canManage = usePermission('customization.manage')
  const [tab, setTab] = useState('fields')
  useEffect(() => {
    const q = router.query.tab
    if (typeof q === 'string' && TAB_IDS.includes(q)) setTab(q)
  }, [router.query.tab])
  const choose = (id) => {
    setTab(id)
    router.replace({ pathname: router.pathname, query: { tab: id } }, undefined, { shallow: true })
  }

  return (
    <div className="space-y-6" data-tour="page-customization">
      <PageHeader
        showTitle={false}
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Settings' }, { label: 'Customization' }]}
        description="Fit the app to how your farm works without code: extra fields on records, your own words, form layouts, dashboards and navigation."
        related={[
          { label: 'Company settings', href: '/company-settings' },
          { label: 'Export data', href: '/export' },
        ]}
      />
      {!canManage ? (
        <EmptyState title="Only organization admins can change customization" description="Ask an admin for the customization permission." />
      ) : (
        <>
          <TabBar tabs={tabs} active={tab} onChange={choose} />
          {tab === 'fields' && <FieldsBuilder />}
          {tab === 'words' && <TerminologyEditor />}
          {tab === 'forms' && <FormLayoutEditor />}
          {tab === 'dashboard' && <DashboardLayoutEditor />}
        </>
      )}
    </div>
  )
}
