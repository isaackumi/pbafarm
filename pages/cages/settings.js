import { useState } from 'react'
import { useQuery } from 'convex/react'
import { Pencil, Trash2 } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, Button } from '../../components/ui'
import CageManageModals from '../../components/CageManageModals'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'

export default function CageSettingsPage() {
  return (
    <ProtectedRoute>
      <Layout title="Cage Settings">
        <CageSettings />
      </Layout>
    </ProtectedRoute>
  )
}

function CageSettings() {
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const cages = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const [editCage, setEditCage] = useState(null)
  const [deleteCage, setDeleteCage] = useState(null)

  return (
    <div className="max-w-4xl">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Cages', href: '/cages' },
          { label: 'Settings' },
        ]}
        description="Edit cage details or remove cages. Changes sync live."
        related={[
          { label: 'All cages', href: '/cages' },
          { label: 'Create cage', href: '/create-cage' },
        ]}
        actions={
          <Button href="/cages" variant="secondary" size="sm">
            Back to cages
          </Button>
        }
      />

      <div className="page-card overflow-hidden">
        {cages === undefined ? (
          <div className="p-8 text-center text-muted">Loading cages…</div>
        ) : cages.length === 0 ? (
          <div className="p-8 text-center text-muted">
            No cages yet.{' '}
            <a href="/create-cage" className="text-lagoon-800 hover:underline">
              Create one
            </a>
          </div>
        ) : (
          <ul className="divide-y divide-foam-deep">
            {cages.map((cage) => (
              <li
                key={cage.id || cage._id}
                className="px-5 py-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-chart-ink truncate">{cage.name}</p>
                  <p className="text-sm text-muted truncate">
                    {cage.location || 'No location'} · {cage.status || '—'}
                    {cage.size != null ? ` · ${cage.size} m³` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    title="Edit"
                    onClick={() => setEditCage(cage)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-lagoon-800 bg-foam-deep hover:bg-foam"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => setDeleteCage(cage)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-signal bg-signal/10 hover:bg-signal/20"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CageManageModals
        editCage={editCage}
        deleteCage={deleteCage}
        onCloseEdit={() => setEditCage(null)}
        onCloseDelete={() => setDeleteCage(null)}
      />
    </div>
  )
}
