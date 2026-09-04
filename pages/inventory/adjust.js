import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import {
  PageHeader,
  Button,
  FormCard,
  Field,
  Input,
  Textarea,
} from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import FarmLocationSelect from '../../components/FarmLocationSelect'
import FeedTypeField from '../../components/FeedTypeField'

export default function InventoryAdjustPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <InventoryAdjust />
    </ProtectedRoute>
  )
}

function InventoryAdjust() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const { locations: farmLocations, activeLocationId, activeLocation } =
    useLocation()
  const feedTypes = useQuery(api.feed.listFeedTypes, user ? {} : 'skip')
  const lots = useQuery(api.inventory.listLots, user ? {} : 'skip')
  const createAdjustment = useMutation(api.inventory.createAdjustment)
  const createTransfer = useMutation(api.inventory.createTransfer)

  const [mode, setMode] = useState('adjust')
  const [feedTypeId, setFeedTypeId] = useState('')
  const [quantityKg, setQuantityKg] = useState('')
  const [notes, setNotes] = useState('')
  const [locationId, setLocationId] = useState('')
  const [fromLocationId, setFromLocationId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeLocationId) return
    setLocationId((prev) => prev || activeLocationId)
    setFromLocationId((prev) => prev || activeLocationId)
  }, [activeLocationId])

  const locationName = (id) =>
    (farmLocations || []).find((l) => (l.id || l._id) === id)?.name ||
    activeLocation?.name ||
    undefined

  const relevantLots = (lots || []).filter(
    (lot) => !feedTypeId || lot.feed_type_id === feedTypeId,
  )

  const submit = async (e) => {
    e.preventDefault()
    if (!feedTypeId) {
      showToast('error', 'Select a feed type')
      return
    }
    const qty = Number(quantityKg)
    if (!Number.isFinite(qty) || qty === 0) {
      showToast('error', 'Enter a non-zero quantity (kg)')
      return
    }

    setBusy(true)
    try {
      if (mode === 'adjust') {
        if (!notes.trim()) throw new Error('Reason is required')
        const locId = locationId || activeLocationId
        await createAdjustment({
          feedTypeId,
          quantityKg: qty,
          notes: notes.trim(),
          location: locationName(locId),
          batchNumber: batchNumber || undefined,
        })
        showToast('success', 'Stock adjusted')
      } else {
        if (qty < 0) throw new Error('Transfer quantity must be positive')
        if (!fromLocationId || !toLocationId) {
          throw new Error('Select from and to farm locations')
        }
        await createTransfer({
          feedTypeId,
          quantityKg: Math.abs(qty),
          fromLocationId,
          toLocationId,
          notes: notes.trim() || undefined,
          batchNumber: batchNumber || undefined,
        })
        showToast('success', 'Stock transferred between locations')
      }
      setQuantityKg('')
      setNotes('')
      setBatchNumber('')
    } catch (err) {
      showToast('error', err.message || 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout title="Adjust / Transfer Stock">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Inventory', href: '/inventory/overview' },
          { label: 'Adjust' },
        ]}
        description="Correct on-hand stock or move lots between farm locations."
        related={[
          { label: 'Ledger', href: '/inventory-transactions' },
          { label: 'Lots', href: '/inventory/lots' },
          { label: 'Stock levels', href: '/stock-levels' },
          { label: 'Farm locations', href: '/farm-locations' },
        ]}
        actions={
          <Button href="/inventory-transactions" variant="secondary" size="sm">
            Ledger
          </Button>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <FormCard title="Stock action">
          <form onSubmit={submit} className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('adjust')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  mode === 'adjust'
                    ? 'bg-lagoon-950 text-white'
                    : 'bg-foam-deep text-chart-ink'
                }`}
              >
                Adjustment
              </button>
              <button
                type="button"
                onClick={() => setMode('transfer')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  mode === 'transfer'
                    ? 'bg-lagoon-950 text-white'
                    : 'bg-foam-deep text-chart-ink'
                }`}
              >
                Transfer
              </button>
            </div>

            <FeedTypeField
              id="adjust-feed-type"
              value={feedTypeId}
              onChange={(e) => setFeedTypeId(e.target.value)}
              feedTypes={(feedTypes || []).filter((t) => t.active !== false)}
              ready={feedTypes !== undefined}
              required
              hint="Stock lot to adjust or transfer. Create a type first if the catalog is empty."
              emptyMessage="Add a feed type before adjusting inventory."
              onCreated={(result) => {
                if (result?.id) setFeedTypeId(result.id)
              }}
            />

            <Field
              label={
                mode === 'adjust'
                  ? 'Quantity kg (+ in / − out)'
                  : 'Quantity kg to move'
              }
            >
              <Input
                type="number"
                step="any"
                className="font-data"
                value={quantityKg}
                onChange={(e) => setQuantityKg(e.target.value)}
                required
              />
            </Field>

            {mode === 'adjust' ? (
              <Field
                label="Farm location"
                hint="Defaults to header location"
              >
                <FarmLocationSelect
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  required
                  allowEmpty={false}
                />
              </Field>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="From farm location"
                  required
                  hint="Defaults to header"
                >
                  <FarmLocationSelect
                    value={fromLocationId}
                    onChange={(e) => setFromLocationId(e.target.value)}
                    required
                    allowEmpty={false}
                  />
                </Field>
                <Field label="To farm location" required>
                  <FarmLocationSelect
                    value={toLocationId}
                    onChange={(e) => setToLocationId(e.target.value)}
                    required
                    allowEmpty={false}
                    syncWithHeader={false}
                  />
                </Field>
              </div>
            )}

            <Field label="Batch (optional)">
              <Input
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
              />
            </Field>

            <Field label={mode === 'adjust' ? 'Reason *' : 'Notes'}>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                required={mode === 'adjust'}
              />
            </Field>

            <Button type="submit" disabled={busy}>
              {busy
                ? 'Saving…'
                : mode === 'adjust'
                  ? 'Apply adjustment'
                  : 'Transfer'}
            </Button>
          </form>
        </FormCard>

        <FormCard title="Lots for selected type" subtitle="Live lot balances">
          {lots === undefined ? (
            <p className="text-sm text-muted">Loading lots…</p>
          ) : relevantLots.length === 0 ? (
            <p className="text-sm text-muted">
              No lot rows yet. Purchases and inbound adjustments create them when
              lot tracking is enabled.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Location</th>
                    <th className="py-2 pr-3">Batch</th>
                    <th className="py-2 pr-3">Expiry</th>
                    <th className="py-2 text-right">kg</th>
                  </tr>
                </thead>
                <tbody>
                  {relevantLots.map((lot) => (
                    <tr key={lot.id} className="border-t border-foam-deep">
                      <td className="py-2 pr-3">{lot.feed_type_name}</td>
                      <td className="py-2 pr-3">{lot.location}</td>
                      <td className="py-2 pr-3 font-data">
                        {lot.batch_number || '—'}
                      </td>
                      <td className="py-2 pr-3 font-data">
                        {lot.expiry_date || '—'}
                      </td>
                      <td className="py-2 text-right font-data">
                        {lot.quantity_kg}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-sm">
            <Link
              href="/inventory/lots"
              className="text-lagoon-800 hover:underline"
            >
              View all lots →
            </Link>
          </p>
        </FormCard>
      </div>
    </Layout>
  )
}
