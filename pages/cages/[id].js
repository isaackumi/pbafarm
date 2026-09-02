import React, { useState } from 'react'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import Layout from '../../components/Layout'
import ProtectedRoute from '../../components/ProtectedRoute'
import { PageHeader, Button } from '../../components/ui'
import CageManageModals from '../../components/CageManageModals'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../convex/_generated/api'

function CageDetails() {
  const router = useRouter()
  const { user } = useAuth()
  const id = typeof router.query.id === 'string' ? router.query.id : null

  const cage = useQuery(api.cages.get, user && id ? { id } : 'skip')
  const recentDaily = useQuery(
    api.dailyRecords.list,
    user && id ? { cageId: id } : 'skip',
  )
  const recentBiweekly = useQuery(
    api.biweeklyRecords.list,
    user && id ? { cageId: id } : 'skip',
  )

  const [editCage, setEditCage] = useState(null)
  const [deleteCage, setDeleteCage] = useState(null)

  if (cage === undefined || !id) {
    return (
      <Layout title="Cage">
        <div className="flex justify-center items-center h-64 text-muted">
          Loading cage details…
        </div>
      </Layout>
    )
  }

  if (cage === null) {
    return (
      <Layout title="Cage">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Cages', href: '/cages' },
            { label: 'Not found' },
          ]}
        />
        <div className="text-center py-8">
          <p className="text-signal font-semibold">Cage not found</p>
          <Button href="/cages" className="mt-4">
            Back to cages
          </Button>
        </div>
      </Layout>
    )
  }

  const cageId = cage.id || cage._id
  const status = cage.status || '—'
  const dailyRows = (recentDaily || []).slice(0, 10)
  const biweeklyRows = (recentBiweekly || []).slice(0, 10)

  return (
    <Layout title={`Cage ${cage.name}`}>
      <div className="max-w-5xl space-y-6">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Cages', href: '/cages' },
            { label: cage.name },
          ]}
          description={`Code ${cage.code || cageId} · Status ${status}`}
          related={[
            { label: 'Daily entry', href: `/daily-entry?cage=${cageId}` },
            { label: 'Bi-weekly entry', href: `/biweekly-entry?cage=${cageId}` },
            { label: 'Stocking', href: '/stocking' },
          ]}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => setEditCage(cage)}
              >
                Edit
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => setDeleteCage(cage)}
              >
                Delete
              </Button>
              <Button href="/cages" variant="secondary" size="sm">
                All cages
              </Button>
            </div>
          }
        />

        <div className="flex flex-wrap gap-2">
          <Button href={`/daily-entry?cage=${cageId}`} size="sm">
            Daily entry
          </Button>
          <Button
            href={`/biweekly-entry?cage=${cageId}`}
            variant="secondary"
            size="sm"
          >
            Bi-weekly entry
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="page-card p-6 space-y-2 text-sm">
            <h2 className="font-display font-bold text-lg mb-2">Information</h2>
            <p>
              <span className="text-muted">Location:</span> {cage.location || '—'}
            </p>
            <p>
              <span className="text-muted">Status:</span>{' '}
              <span className="font-semibold text-lagoon-800">{status}</span>
            </p>
            <p>
              <span className="text-muted">Size:</span> {cage.size ?? '—'} m³
            </p>
            <p>
              <span className="text-muted">Capacity:</span> {cage.capacity ?? '—'}{' '}
              fish
            </p>
            <p>
              <span className="text-muted">Material:</span> {cage.material || '—'}
            </p>
          </div>
          <div className="page-card p-6 space-y-2 text-sm">
            <h2 className="font-display font-bold text-lg mb-2">Stock</h2>
            <p>
              <span className="text-muted">Current count:</span>{' '}
              <span className="font-data font-semibold">
                {cage.current_count ?? cage.currentCount ?? '—'}
              </span>
            </p>
            <p>
              <span className="text-muted">Current ABW:</span>{' '}
              <span className="font-data">
                {cage.current_abw ?? cage.currentAbw ?? cage.currentWeight ?? '—'}{' '}
                g
              </span>
            </p>
            <p>
              <span className="text-muted">Stocking date:</span>{' '}
              {cage.stocking_date || cage.stockingDate || '—'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="page-card overflow-hidden">
            <div className="px-4 py-3 border-b border-foam-deep font-semibold">
              Recent daily records
            </div>
            {dailyRows.length === 0 ? (
              <p className="p-4 text-sm text-muted">No daily records yet.</p>
            ) : (
              <ul className="divide-y divide-foam-deep text-sm">
                {dailyRows.map((r) => (
                  <li
                    key={r.id || r._id}
                    className="px-4 py-2 flex justify-between gap-2"
                  >
                    <span className="font-data">{r.date}</span>
                    <span className="text-muted">
                      Feed {r.feed_amount ?? r.feedAmount} kg · Mort{' '}
                      {r.mortality ?? 0}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="page-card overflow-hidden">
            <div className="px-4 py-3 border-b border-foam-deep font-semibold">
              Recent biweekly samples
            </div>
            {biweeklyRows.length === 0 ? (
              <p className="p-4 text-sm text-muted">No biweekly records yet.</p>
            ) : (
              <ul className="divide-y divide-foam-deep text-sm">
                {biweeklyRows.map((r) => (
                  <li
                    key={r.id || r._id}
                    className="px-4 py-2 flex justify-between gap-2"
                  >
                    <span className="font-data">{r.date}</span>
                    <span className="text-muted">
                      ABW {r.average_body_weight ?? r.averageBodyWeight} g
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <CageManageModals
        editCage={editCage}
        deleteCage={deleteCage}
        onCloseEdit={() => setEditCage(null)}
        onCloseDelete={() => setDeleteCage(null)}
        onDeleted={() => router.push('/cages')}
      />
    </Layout>
  )
}

export default function CageDetailsPage() {
  return (
    <ProtectedRoute>
      <CageDetails />
    </ProtectedRoute>
  )
}
