import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Layout from '../components/Layout'
import ProtectedRoute from '../components/ProtectedRoute'
import { cageService } from '../lib/cageService'
import { getConvexHttpClient, api } from '../lib/convexBridge'

const SIZE_CATEGORIES = [
  { category: 'S3', range: '800g+' },
  { category: 'S2', range: '700–800g' },
  { category: 'S1', range: '600–700g' },
  { category: 'Reg', range: '500–600g' },
  { category: 'Eco', range: '400–500g' },
  { category: 'SS', range: '300–400g' },
  { category: 'SB', range: '200–300g' },
  { category: 'Rej', range: '<200g' },
]

function HarvestSamplingPage() {
  const router = useRouter()
  const [cages, setCages] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    cageId: '',
    date: new Date().toISOString().split('T')[0],
    weight: '',
    fishCount: '',
    sizes: SIZE_CATEGORIES.reduce((acc, s) => ({ ...acc, [s.category]: '' }), {}),
  })
  const [doc, setDoc] = useState('')
  const [abw, setAbw] = useState('')

  useEffect(() => {
    cageService.getActiveCages().then(({ data }) => {
      setCages(data || [])
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    const cage = cages.find((c) => (c.id || c._id) === form.cageId)
    if (cage?.stocking_date && form.date) {
      const days = Math.floor(
        (new Date(form.date) - new Date(cage.stocking_date)) / (1000 * 60 * 60 * 24),
      )
      setDoc(String(Math.max(0, days)))
    } else {
      setDoc('')
    }
    const w = parseFloat(form.weight)
    const n = parseInt(form.fishCount, 10)
    if (w > 0 && n > 0) setAbw((w / n).toFixed(2))
    else setAbw('')
  }, [form.cageId, form.date, form.weight, form.fishCount, cages])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const client = getConvexHttpClient()
      const sizes = {}
      for (const [k, v] of Object.entries(form.sizes)) {
        if (v !== '' && v != null) sizes[k] = Number(v)
      }
      await client.mutation(api.harvest.createFromSampling, {
        cageId: form.cageId,
        date: form.date,
        weight: Number(form.weight),
        fishCount: Number(form.fishCount),
        sizes,
        doc: doc ? Number(doc) : undefined,
        abw: abw ? Number(abw) : undefined,
      })
      router.push('/harvest')
    } catch (err) {
      setError(err.message || 'Failed to save sampling')
      setSaving(false)
    }
  }

  return (
    <ProtectedRoute>
      <Layout title="Harvest Sampling">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-display text-3xl text-lagoon-950 mb-1">Harvest sampling</h1>
          <div className="waterline max-w-[10rem] mb-6" />
          <p className="text-sm text-muted mb-6">
            Record sample weight and size mix. DOC and ABW calculate from cage stocking date.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded border border-signal/30 bg-signal/10 text-signal text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-muted font-data">Loading cages…</p>
          ) : (
            <form onSubmit={handleSubmit} className="bg-surface border border-foam-deep rounded-lg p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Cage</label>
                  <select
                    required
                    value={form.cageId}
                    onChange={(e) => setForm({ ...form, cageId: e.target.value })}
                    className="w-full border border-input-border rounded px-3 py-2"
                  >
                    <option value="">Select cage</option>
                    {cages.map((c) => (
                      <option key={c.id || c._id} value={c.id || c._id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Sample date</label>
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full border border-input-border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Total weight (kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={form.weight}
                    onChange={(e) => setForm({ ...form, weight: e.target.value })}
                    className="w-full border border-input-border rounded px-3 py-2 font-data"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Fish count</label>
                  <input
                    type="number"
                    required
                    value={form.fishCount}
                    onChange={(e) => setForm({ ...form, fishCount: e.target.value })}
                    className="w-full border border-input-border rounded px-3 py-2 font-data"
                  />
                </div>
              </div>

              <div className="flex gap-6 font-data text-sm bg-foam rounded p-3">
                <div>
                  <span className="text-muted">DOC</span>{' '}
                  <span className="font-semibold text-lagoon-800">{doc || '—'}</span>
                </div>
                <div>
                  <span className="text-muted">ABW (kg)</span>{' '}
                  <span className="font-semibold text-lagoon-800">{abw || '—'}</span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Size breakdown (counts)</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {SIZE_CATEGORIES.map((s) => (
                    <label key={s.category} className="text-sm">
                      <span className="font-data text-chart-ink">
                        {s.category}{' '}
                        <span className="text-muted text-xs">({s.range})</span>
                      </span>
                      <input
                        type="number"
                        value={form.sizes[s.category]}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            sizes: { ...form.sizes, [s.category]: e.target.value },
                          })
                        }
                        className="mt-1 w-full border border-input-border rounded px-2 py-1.5 font-data"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full sm:w-auto px-6 py-2.5 rounded bg-lagoon-800 text-white font-semibold hover:bg-lagoon-950 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save sampling'}
              </button>
            </form>
          )}
        </div>
      </Layout>
    </ProtectedRoute>
  )
}

export default HarvestSamplingPage
