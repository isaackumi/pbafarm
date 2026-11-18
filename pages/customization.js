import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { EmptyState, PageHeader, TabBar } from '../components/ui'
import FieldsBuilder from '../components/customization/FieldsBuilder'
import { usePermission } from '../hooks/usePermission'

/** Settings → Customization (D-007): one place for the organization's configuration. */
const TABS = [{ id: 'fields', label: 'Fields' }]

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
  const canManage = usePermission('customization.manage')
  const [tab, setTab] = useState('fields')
  useEffect(() => {
    const q = router.query.tab
    if (typeof q === 'string' && TABS.some((t) => t.id === q)) setTab(q)
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
          {TABS.length > 1 && <TabBar tabs={TABS} active={tab} onChange={choose} />}
          {tab === 'fields' && <FieldsBuilder />}
        </>
      )}
    </div>
  )
}
