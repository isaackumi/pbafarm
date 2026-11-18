import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import OutboxPanel from '../components/OutboxPanel'
import { FormCard, FormPage, PageHeader } from '../components/ui'
import { useOnline } from '../hooks/useOutbox'

export default function OutboxPage() {
  return (
    <ProtectedRoute>
      <Layout title="Outbox">
        <Outbox />
      </Layout>
    </ProtectedRoute>
  )
}

/** Everything saved on this phone that has not reached the server yet (MOBILE-002). */
function Outbox() {
  const online = useOnline()
  return (
    <FormPage>
      <PageHeader
        showTitle={false}
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Outbox' }]}
        description="Entries saved without signal. They send by themselves when the phone is back online; each is written once even if it is sent again."
      />
      <FormCard>
        <OutboxPanel online={online} />
      </FormCard>
    </FormPage>
  )
}
