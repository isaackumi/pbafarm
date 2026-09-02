import { useMemo, useState } from 'react'
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
  Select,
  Textarea,
} from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { api } from '../../convex/_generated/api'

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
  const feedTypes = useQuery(api.feed.listFeedTypes, user ? {} : 'skip')
  const lots = useQuery(api.inventory.listLots, user ? {} : 'skip')
  const createAdjustment = useMutation(api.inventory.createAdjustment)
  const createTransfer = useMutation(api.inventory.createTransfer)

  const [mode, setMode] = useState('adjust')
  const [feedTypeId, setFeedTypeId] = useState('')
  const [quantityKg, setQuantityKg] = useState('')
  const [notes, setNotes] = useState('')
  const [location, setLocation] = useState('Main store')
  const [fromLocation, setFromLocation] = useState('Main store')
  const [toLocation, setToLocation] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [busy, setBusy] = useState(false)

  const locations = useMemo(() => {
    const set = new Set(['Main store'])
    for (const lot of lots || []) {
      if (lot.location) set.add(lot.location)
    }
    return [...set]
  }, [lots])

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
        await createAdjustment({
          feedTypeId,
          quantityKg: qty,
          notes: notes.trim(),
          location: location || undefined,
          batchNumber: batchNumber || undefined,
        })
        showToast('success', 'Stock adjusted')
      } else {
        if (qty < 0) throw new Error('Transfer quantity must be positive')
        await createTransfer({
          feedTypeId,
          quantityKg: Math.abs(qty),
          fromLocation,
          toLocation,
          notes: notes.trim() || undefined,
          batchNumber: batchNumber || undefined,
        })
        showToast('success', 'Stock transferred')
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
        description="Correct on-hand stock or move lots between store locations."
        related={[
          { label: 'Ledger', href: '/inventory-transactions' },
          { label: 'Lots', href: '/inventory/lots' },
          { label: 'Stock levels', href: '/stock-levels' },
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

            <Field label="Feed type">
              <Select
                value={feedTypeId}
                onChange={(e) => setFeedTypeId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {(feedTypes || []).map((ft) => (
                  <option key={ft.id || ft._id} value={ft.id || ft._id}>
                    {ft.name} ({ft.current_stock ?? 0} kg)
                  </option>
                ))}
              </Select>
            </Field>

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
              <Field label="Location">
                <Input
                  list="inv-locations"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </Field>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="From">
                  <Input
                    list="inv-locations"
                    value={fromLocation}
                    onChange={(e) => setFromLocation(e.target.value)}
                    required
                  />
                </Field>
                <Field label="To">
                  <Input
                    list="inv-locations"
                    value={toLocation}
                    onChange={(e) => setToLocation(e.target.value)}
                    required
                  />
                </Field>
              </div>
            )}

            <datalist id="inv-locations">
              {locations.map((loc) => (
                <option key={loc} value={loc} />
              ))}
            </datalist>

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
              {busy ? 'Saving…' : mode === 'adjust' ? 'Apply adjustment' : 'Transfer'}
            </Button>
          </form>
        </FormCard>

        <FormCard title="Lots for selected type" subtitle="Live lot balances">
          {lots === undefined ? (
            <p className="text-sm text-muted">Loading lots…</p>
          ) : relevantLots.length === 0 ? (
            <p className="text-sm text-muted">
              No lot rows yet. Purchases and inbound adjustments create them when lot
              tracking is enabled.
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
                      <td className="py-2 pr-3 font-data">{lot.batch_number || '—'}</td>
                      <td className="py-2 pr-3 font-data">{lot.expiry_date || '—'}</td>
                      <td className="py-2 text-right font-data">{lot.quantity_kg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-sm">
            <Link href="/inventory/lots" className="text-lagoon-800 hover:underline">
              View all lots →
            </Link>
          </p>
        </FormCard>
      </div>
    </Layout>
  )
}
