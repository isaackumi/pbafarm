import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, Button } from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../convex/_generated/api'

export default function InventoryLotsPage() {
  return (
    <ProtectedRoute>
      <InventoryLots />
    </ProtectedRoute>
  )
}

function InventoryLots() {
  const { user } = useAuth()
  const lots = useQuery(api.inventory.listLots, user ? {} : 'skip')

  return (
    <Layout title="Inventory Lots">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Inventory', href: '/inventory/overview' },
          { label: 'Lots' },
        ]}
        description="Batch and location balances that make up on-hand feed stock."
        related={[
          { label: 'Adjust / transfer', href: '/inventory/adjust' },
          { label: 'Ledger', href: '/inventory-transactions' },
          { label: 'Stock levels', href: '/stock-levels' },
        ]}
        actions={
          <Button href="/inventory/adjust" size="sm">
            Adjust / transfer
          </Button>
        }
      />

      <div className="page-card overflow-hidden">
        {lots === undefined ? (
          <div className="p-8 text-center text-muted">Loading lots…</div>
        ) : lots.length === 0 ? (
          <div className="p-8 text-center text-muted">
            No lots yet. Record a purchase or inbound adjustment with lot tracking
            enabled.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-foam-deep">
              <thead className="bg-foam-deep/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    Feed type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    Location
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    Batch
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    Expiry
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted uppercase">
                    Quantity (kg)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foam-deep">
                {lots.map((lot) => (
                  <tr key={lot.id} className="hover:bg-foam/60">
                    <td className="px-4 py-3 text-sm font-medium text-chart-ink">
                      {lot.feed_type_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-chart-ink">{lot.location}</td>
                    <td className="px-4 py-3 text-sm font-data text-muted">
                      {lot.batch_number || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm font-data text-muted">
                      {lot.expiry_date || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm font-data text-right text-chart-ink">
                      {lot.quantity_kg}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  )
}
