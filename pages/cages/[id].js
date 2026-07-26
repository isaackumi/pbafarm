import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Layout from '../../components/Layout'
import ProtectedRoute from '../../components/ProtectedRoute'
import { cageService } from '../../lib/cageService'
import { getConvexHttpClient, api } from '../../lib/convexBridge'

function CageDetails() {
  const router = useRouter()
  const { id } = router.query
  const [cage, setCage] = useState(null)
  const [recentDaily, setRecentDaily] = useState([])
  const [recentBiweekly, setRecentBiweekly] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) loadCage()
  }, [id])

  const loadCage = async () => {
    try {
      setLoading(true)
      const response = await cageService.getCageById(id)
      if (response.data) setCage(response.data)

      const client = getConvexHttpClient()
      const [daily, biweekly] = await Promise.all([
        client.query(api.dailyRecords.list, { cageId: id }),
        client.query(api.biweeklyRecords.list, { cageId: id }),
      ])
      setRecentDaily((daily || []).slice(0, 10))
      setRecentBiweekly((biweekly || []).slice(0, 10))
    } catch (error) {
      console.error('Error loading cage:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <Layout title="Cage">
        <div className="flex justify-center items-center h-64 text-muted">
          Loading cage details…
        </div>
      </Layout>
    )
  }

  if (!cage) {
    return (
      <Layout title="Cage">
        <div className="text-center py-8">
          <h1 className="page-title text-signal">Cage not found</h1>
          <button type="button" onClick={() => router.push('/cages')} className="btn-primary mt-4">
            Back to Cages
          </button>
        </div>
      </Layout>
    )
  }

  const cageId = cage.id || cage._id
  const status = cage.status || '—'

  return (
    <Layout title={`Cage ${cage.name}`}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="page-title">Cage {cage.name}</h1>
            <p className="page-subtitle font-data">{cage.code || cageId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/daily-entry?cage=${cageId}`} className="btn-primary">
              Daily entry
            </Link>
            <Link href={`/biweekly-entry?cage=${cageId}`} className="btn-secondary">
              Biweekly entry
            </Link>
            <button type="button" onClick={() => router.push('/cages')} className="btn-secondary">
              All cages
            </button>
          </div>
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
              <span className="text-muted">Capacity:</span> {cage.capacity ?? '—'} fish
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
                {cage.current_abw ?? cage.currentAbw ?? cage.currentWeight ?? '—'} g
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
            {recentDaily.length === 0 ? (
              <p className="p-4 text-sm text-muted">No daily records yet.</p>
            ) : (
              <ul className="divide-y divide-foam-deep text-sm">
                {recentDaily.map((r) => (
                  <li key={r.id || r._id} className="px-4 py-2 flex justify-between gap-2">
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
            {recentBiweekly.length === 0 ? (
              <p className="p-4 text-sm text-muted">No biweekly records yet.</p>
            ) : (
              <ul className="divide-y divide-foam-deep text-sm">
                {recentBiweekly.map((r) => (
                  <li key={r.id || r._id} className="px-4 py-2 flex justify-between gap-2">
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
