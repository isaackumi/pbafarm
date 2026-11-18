import { useState, useEffect } from 'react'
import Link from 'next/link'
import Layout from '../components/Layout'
import ProtectedRoute from '../components/ProtectedRoute'
import {
  PageHeader,
  FormPage,
  FormCard,
  FormActions,
  FormSection,
  Field,
  Input,
  Select,
  Button,
} from '../components/ui'
import { cageService } from '../lib/cageService'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { localToday } from '../lib/format'

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
  const [cages, setCages] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [form, setForm] = useState({
    cageId: '',
    date: localToday(),
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
    setSaved('')
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
      // A sample is not a harvest: stay here so more samples can be entered.
      const cageName =
        cages.find((c) => (c.id || c._id) === form.cageId)?.name || 'the cage'
      setSaved(
        `Sample saved for ${cageName}. Record the harvest itself on the Harvest page when the fish leave the cage.`,
      )
      setForm((f) => ({
        ...f,
        weight: '',
        fishCount: '',
        sizes: SIZE_CATEGORIES.reduce((acc, s) => ({ ...acc, [s.category]: '' }), {}),
      }))
    } catch (err) {
      setError(err.message || 'Failed to save sampling')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProtectedRoute>
      <Layout title="Harvest Sampling">
        <FormPage width="full">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Harvest', href: '/harvest' },
              { label: 'Sampling' },
            ]}
            description="Record a sample's weight and size mix before harvest. This does not record a harvest or change the cage's fish count. DOC and ABW calculate from the cage stocking date."
            related={[
              { label: 'Harvest', href: '/harvest' },
              { label: 'Bi-weekly entry', href: '/biweekly-entry' },
              { label: 'Cages', href: '/cages' },
            ]}
          />

          {saved && (
            <div
              role="status"
              className="mb-5 text-sm text-kelp border border-kelp/20 bg-kelp/10 rounded-xl p-3"
            >
              {saved}{' '}
              <Link href="/harvest" className="font-medium underline-offset-2 hover:underline">
                Go to Harvest
              </Link>
            </div>
          )}

          {error && (
            <div className="mb-5 text-sm text-signal border border-signal/20 bg-signal/10 rounded-xl p-3">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-muted font-data">Loading cages…</p>
          ) : (
            <FormCard
              title="Sampling details"
              subtitle="Enter sample totals, then optional size breakdown counts."
            >
              <form onSubmit={handleSubmit} className="space-y-8">
                <FormSection title="Cage & sample">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Field label="Cage" htmlFor="cageId" required>
                      <Select
                        id="cageId"
                        required
                        value={form.cageId}
                        onChange={(e) =>
                          setForm({ ...form, cageId: e.target.value })
                        }
                      >
                        <option value="">Select cage</option>
                        {cages.map((c) => (
                          <option key={c.id || c._id} value={c.id || c._id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Sample date" htmlFor="date" required>
                      <Input
                        id="date"
                        type="date"
                        required
                        value={form.date}
                        onChange={(e) =>
                          setForm({ ...form, date: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Total weight (kg)" htmlFor="weight" required>
                      <Input
                        id="weight"
                        type="number"
                        step="0.01"
                        required
                        value={form.weight}
                        onChange={(e) =>
                          setForm({ ...form, weight: e.target.value })
                        }
                        className="font-data"
                      />
                    </Field>
                    <Field label="Fish count" htmlFor="fishCount" required>
                      <Input
                        id="fishCount"
                        type="number"
                        required
                        value={form.fishCount}
                        onChange={(e) =>
                          setForm({ ...form, fishCount: e.target.value })
                        }
                        className="font-data"
                      />
                    </Field>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-6 rounded-xl bg-foam border border-foam-deep px-4 py-3 font-data text-sm">
                    <div>
                      <span className="text-muted">DOC</span>{' '}
                      <span className="font-semibold text-lagoon-800">
                        {doc || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted">ABW (kg)</span>{' '}
                      <span className="font-semibold text-lagoon-800">
                        {abw || '—'}
                      </span>
                    </div>
                  </div>
                </FormSection>

                <FormSection
                  title="Size breakdown"
                  description="Optional counts per grade."
                >
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {SIZE_CATEGORIES.map((s) => (
                      <Field
                        key={s.category}
                        label={`${s.category}`}
                        htmlFor={`size-${s.category}`}
                        hint={s.range}
                      >
                        <Input
                          id={`size-${s.category}`}
                          type="number"
                          value={form.sizes[s.category]}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              sizes: {
                                ...form.sizes,
                                [s.category]: e.target.value,
                              },
                            })
                          }
                          className="font-data"
                        />
                      </Field>
                    ))}
                  </div>
                </FormSection>

                <FormActions>
                  <Button type="submit" disabled={saving} size="lg">
                    {saving ? 'Saving…' : 'Save sampling'}
                  </Button>
                  <Button href="/harvest" variant="secondary">
                    Cancel
                  </Button>
                </FormActions>
              </form>
            </FormCard>
          )}
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}

export default HarvestSamplingPage
