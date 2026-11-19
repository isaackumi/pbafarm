import { useRouter } from 'next/router'
import Layout from '../components/Layout'
import QueryBoundary from '../components/QueryBoundary'
import BareShell from '../components/billing/BareShell'
import TenantBilling from '../components/billing/TenantBilling'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../lib/i18n/context'

/**
 * Organization billing (PLAT-113). The server requires org.settings.manage
 * (convex/billing/tenant.ts); while the organization is suspended the page
 * drops the app shell, whose queries are refused.
 */
export default function BillingPage() {
  const t = useT()
  const { accessState } = useAuth()
  const router = useRouter()
  const body = (
    <QueryBoundary title={t('billing.forbidden')} resetKey={router.asPath}>
      <TenantBilling />
    </QueryBoundary>
  )
  if (accessState === 'TENANT_SUSPENDED') return <BareShell title={t('billing.title')}>{body}</BareShell>
  return (
    <Layout title={t('billing.title')} eyebrow={t('billing.eyebrow')}>
      <div className="max-w-6xl">{body}</div>
    </Layout>
  )
}
