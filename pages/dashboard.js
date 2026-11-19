import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import Dashboard from '../components/Dashboard'

/** Home (Paper 01): Dashboard renders its own greeting header. */
export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <Layout hideTitle>
        <Dashboard />
      </Layout>
    </ProtectedRoute>
  )
}
