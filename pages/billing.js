import { useRouter } from 'next/router'
import Layout from '../components/Layout'
import QueryBoundary from '../components/QueryBoundary'
import BareShell from '../components/billing/BareShell'
import TenantBilling from '../components/billing/TenantBilling'
import { useAuth } from '../contexts/AuthContext'

/**
 * Organization billing (PLAT-113). The server requires org.settings.manage
 * (convex/billing/tenant.ts); while the organization is suspended the page
 * drops the app shell, whose queries are refused.
 */
export default function BillingPage() {
  const { accessState } = useAuth()
  const router = useRouter()
  const body = (
    <QueryBoundary title="Only organization owners and admins can see billing" resetKey={router.asPath}>
      <TenantBilling />
    </QueryBoundary>
  )
  if (accessState === 'TENANT_SUSPENDED') return <BareShell title="Billing">{body}</BareShell>
  return (
    <Layout title="Billing">
      <div className="max-w-5xl">{body}</div>
    </Layout>
  )
}
