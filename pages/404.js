import NotFound from '../components/marketing/NotFound'
import Layout from '../components/Layout'
import NotFoundState from '../components/states/NotFoundState'
import { SystemPage } from '../components/states/StateCard'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../lib/i18n/context'

/**
 * 404. Signed in (with access to the app): the Paper 62 "This cage drifted
 * off" card (HMM-0 / KRK-0) inside the app shell, "Go home" to the dashboard
 * and "Search ⌘K" opening the top-bar search. Signed out: the marketing
 * "This cage is empty" page (Paper QMW-2). Nothing renders while the session
 * is still resolving, so neither flashes for the other.
 */
export default function Custom404() {
  const { user, canUseApp, loading } = useAuth()
  const t = useT()
  if (loading) return null
  if (user && canUseApp) {
    return (
      <Layout title={t('system.notFound.title')} hideTitle>
        <SystemPage className="min-h-[60vh] bg-transparent">
          <NotFoundState homeHref="/dashboard" />
        </SystemPage>
      </Layout>
    )
  }
  return <NotFound />
}
