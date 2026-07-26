import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { getConvexHttpClient, api } from '../lib/convexBridge'

export default function FeedIssuePage() {
  return (
    <ProtectedRoute>
      <FeedIssue />
    </ProtectedRoute>
  )
}

function FeedIssue() {
  const { showToast } = useToast()
  const { hasRole } = useAuth()
  const [feedTypes, setFeedTypes] = useState([])
  const [cages, setCages] = useState([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    feedTypeId: '',
    cageId: '',
    quantityKg: '',
    bags: '',
    usageDate: new Date().toISOString().split('T')[0],
    notes: '',
    allowNegative: false,
    overrideReason: '',
  })

  useEffect(() => {
    const load = async () => {
      const client = getConvexHttpClient()
      const [types, cageList] = await Promise.all([
        client.query(api.feed.listFeedTypes, {}),
        client.query(api.cages.getActive, {}),
      ])
      setFeedTypes(types || [])
      setCages(cageList || [])
    }
    load().catch((e) => showToast('error', e.message))
  }, [showToast])

  const selected = feedTypes.find(
    (f) => (f.id || f._id) === form.feedTypeId,
  )
  const bagSize = selected?.bag_size_kg || 25

  const onChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm((p) => {
      const next = { ...p, [name]: type === 'checkbox' ? checked : value }
      if (name === 'bags' && value !== '') {
        next.quantityKg = String(
          Math.round(parseFloat(value) * bagSize * 1000) / 1000,
        )
      }
      if (name === 'quantityKg' && value !== '') {
        next.bags = String(
          Math.round((parseFloat(value) / bagSize) * 1000) / 1000,
        )
      }
      return next
    })
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (!form.feedTypeId) throw new Error('Select a feed type')
      const client = getConvexHttpClient()
      await client.mutation(api.feed.createIssue, {
        feedTypeId: form.feedTypeId,
        cageId: form.cageId || undefined,
        quantity: form.quantityKg ? Number(form.quantityKg) : undefined,
        bags: form.bags ? Number(form.bags) : undefined,
        usageDate: form.usageDate,
        notes: form.notes || undefined,
        allowNegative: form.allowNegative || undefined,
        overrideReason: form.overrideReason || undefined,
      })
      showToast('success', 'Feed issued — stock deducted on ledger')
      setForm((p) => ({
        ...p,
        quantityKg: '',
        bags: '',
        notes: '',
        allowNegative: false,
        overrideReason: '',
      }))
    } catch (err) {
      showToast('error', err.message || 'Failed to issue feed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-foam">
      <div className="max-w-xl mx-auto px-4 py-8">
        <Link
          href="/stock-levels"
          className="text-lagoon-800 inline-flex items-center mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Stock levels
        </Link>
        <h1 className="text-2xl font-bold text-chart-ink mb-2">
          Issue feed (take-out)
        </h1>
        <p className="text-sm text-muted mb-6">
          Record when feed leaves the store. Deducts stock via the inventory
          ledger (bags or kg).
        </p>

        <form
          onSubmit={submit}
          className="page-card p-6 space-y-4 border border-gray-100"
        >
          <div>
            <label className="block text-sm font-medium mb-1">Feed type</label>
            <select
              name="feedTypeId"
              value={form.feedTypeId}
              onChange={onChange}
              required
              className="w-full border rounded-md px-3 py-2"
            >
              <option value="">Select…</option>
              {feedTypes.map((f) => (
                <option key={f.id || f._id} value={f.id || f._id}>
                  {f.name} ({Number(f.current_stock).toFixed(1)} kg /{' '}
                  {Number(f.current_stock_bags || 0).toFixed(1)} bags)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Cage (optional)
            </label>
            <select
              name="cageId"
              value={form.cageId}
              onChange={onChange}
              className="w-full border rounded-md px-3 py-2"
            >
              <option value="">None</option>
              {cages.map((c) => (
                <option key={c.id || c._id} value={c.id || c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bags</label>
              <input
                name="bags"
                type="number"
                step="0.01"
                min="0"
                value={form.bags}
                onChange={onChange}
                className="w-full border rounded-md px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">kg</label>
              <input
                name="quantityKg"
                type="number"
                step="0.01"
                min="0"
                value={form.quantityKg}
                onChange={onChange}
                className="w-full border rounded-md px-3 py-2 font-mono"
              />
              <p className="text-xs text-muted mt-1">
                Bag size: {bagSize} kg
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input
              name="usageDate"
              type="date"
              value={form.usageDate}
              onChange={onChange}
              required
              className="w-full border rounded-md px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <input
              name="notes"
              value={form.notes}
              onChange={onChange}
              className="w-full border rounded-md px-3 py-2"
            />
          </div>

          {hasRole('admin') && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="allowNegative"
                  checked={form.allowNegative}
                  onChange={onChange}
                />
                Admin override (allow insufficient stock)
              </label>
              {form.allowNegative && (
                <input
                  name="overrideReason"
                  value={form.overrideReason}
                  onChange={onChange}
                  required
                  placeholder="Override reason (required)"
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2 rounded-md text-white bg-lagoon-800 hover:bg-lagoon-950 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Issue feed'}
          </button>
        </form>
      </div>
    </div>
  )
}
