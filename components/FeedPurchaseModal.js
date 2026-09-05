import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import BagSizeField from './BagSizeField'
import LocationMetaField from './LocationMetaField'
import { feedService } from '../lib/feedService'
import { formatCurrency } from '../lib/currencyUtils'
import { useLocation } from '../contexts/LocationContext'
import { getActiveLocationId } from '../lib/locationScope'
import { useToast } from './Toast'

const emptyEntry = (overrides = {}) => ({
  feed_type_id: '',
  number_of_bags: '',
  price_per_bag: '',
  bag_size: '25',
  ...overrides,
})

const emptyPurchase = () => ({
  supplier_id: '',
  purchase_date: new Date().toISOString().split('T')[0],
  total_amount: 0,
  notes: '',
  feed_entries: [],
})

/**
 * Multi-line feed purchase modal (supplier + bag entries + bag size).
 * Used by Feed Purchases "Record Purchase" and Feed Management.
 */
export default function FeedPurchaseModal({
  open,
  onClose,
  onSaved,
  feedTypes = [],
  suppliers = [],
  /** Optional prefill for first draft entry (e.g. Order from low-stock) */
  defaultFeedTypeId = '',
  title = 'New Feed Purchase',
}) {
  const { showToast } = useToast()
  const { activeLocationId } = useLocation()
  const [mounted, setMounted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [purchaseData, setPurchaseData] = useState(emptyPurchase)
  const [currentFeedEntry, setCurrentFeedEntry] = useState(emptyEntry)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    setPurchaseData(emptyPurchase())
    const ft = feedTypes.find(
      (t) => (t.id || t._id) === defaultFeedTypeId,
    )
    const size = Number(ft?.bag_size_kg || ft?.bagSizeKg || 25)
    setCurrentFeedEntry(
      emptyEntry(
        defaultFeedTypeId
          ? {
              feed_type_id: defaultFeedTypeId,
              bag_size: String(size > 0 ? size : 25),
            }
          : {},
      ),
    )
  }, [open, defaultFeedTypeId, feedTypes])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onClose?.()
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, saving, onClose])

  const handleAddFeedEntry = () => {
    if (
      !currentFeedEntry.feed_type_id ||
      !currentFeedEntry.number_of_bags ||
      !currentFeedEntry.price_per_bag
    ) {
      showToast('Please fill in all feed entry details', 'error')
      return
    }
    const bagSize = Number(currentFeedEntry.bag_size)
    if (!bagSize || bagSize <= 0) {
      showToast('Enter a valid bag size (kg)', 'error')
      return
    }

    const bags = parseFloat(currentFeedEntry.number_of_bags)
    const pricePerBag = parseFloat(currentFeedEntry.price_per_bag)
    const entry = {
      ...currentFeedEntry,
      bag_size: String(bagSize),
      quantity_kg: Math.round(bags * bagSize * 1000) / 1000,
      total_amount: bags * pricePerBag,
    }

    setPurchaseData((prev) => ({
      ...prev,
      feed_entries: [...prev.feed_entries, entry],
      total_amount: prev.total_amount + entry.total_amount,
    }))
    setCurrentFeedEntry(emptyEntry())
  }

  const handleRemoveFeedEntry = (index) => {
    const entry = purchaseData.feed_entries[index]
    setPurchaseData((prev) => ({
      ...prev,
      feed_entries: prev.feed_entries.filter((_, i) => i !== index),
      total_amount: prev.total_amount - entry.total_amount,
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!purchaseData.supplier_id) {
      showToast('Please select a supplier', 'error')
      return
    }
    if (purchaseData.feed_entries.length === 0) {
      showToast('Please add at least one feed entry', 'error')
      return
    }

    setSaving(true)
    try {
      const locationId =
        activeLocationId || getActiveLocationId() || undefined
      const errors = []
      for (const entry of purchaseData.feed_entries) {
        const bags = Number(entry.number_of_bags)
        const bagSize = Number(entry.bag_size) > 0 ? Number(entry.bag_size) : 25
        const pricePerBag = Number(entry.price_per_bag)
        const quantityKg =
          entry.quantity_kg != null
            ? Number(entry.quantity_kg)
            : Math.round(bags * bagSize * 1000) / 1000
        const pricePerKg =
          bagSize > 0 ? Math.round((pricePerBag / bagSize) * 10000) / 10000 : 0

        const { error } = await feedService.createPurchase({
          feed_type_id: entry.feed_type_id,
          quantity: quantityKg,
          bags,
          price_per_kg: pricePerKg,
          purchase_date: purchaseData.purchase_date,
          supplier_id: purchaseData.supplier_id,
          notes: purchaseData.notes || undefined,
          locationId,
        })
        if (error) {
          const name =
            feedTypes.find((t) => (t.id || t._id) === entry.feed_type_id)
              ?.name || 'entry'
          errors.push(error.message || `Failed to save ${name}`)
        }
      }

      if (errors.length) {
        showToast(errors[0], 'error')
        return
      }

      showToast('Feed purchase saved successfully', 'success')
      onSaved?.()
      onClose?.()
    } catch (err) {
      showToast(err.message || 'Failed to save feed purchase', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!open || !mounted) return null

  const activeFeedTypes = (feedTypes || []).filter((t) => t.active !== false)

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-backdrop">
      <div
        className="page-card-xl max-h-[90vh] w-full max-w-4xl overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feed-purchase-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-foam-deep px-6 py-4">
          <h3
            id="feed-purchase-title"
            className="text-lg font-medium text-chart-ink"
          >
            {title}
          </h3>
        </div>
        <form onSubmit={handleSubmit} className="p-6">
          <div className="mb-6">
            <LocationMetaField />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-chart-ink">
                Supplier <span className="text-signal">*</span>
              </label>
              <select
                value={purchaseData.supplier_id}
                onChange={(e) =>
                  setPurchaseData((prev) => ({
                    ...prev,
                    supplier_id: e.target.value,
                  }))
                }
                className="mt-1 block w-full rounded-md border border-input-border px-3 py-2 text-sm shadow-sm focus:border-lagoon-800 focus:outline-none focus:ring-lagoon-800"
                required
              >
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => (
                  <option
                    key={supplier.id || supplier._id}
                    value={supplier.id || supplier._id}
                  >
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-chart-ink">
                Purchase Date <span className="text-signal">*</span>
              </label>
              <input
                type="date"
                value={purchaseData.purchase_date}
                onChange={(e) =>
                  setPurchaseData((prev) => ({
                    ...prev,
                    purchase_date: e.target.value,
                  }))
                }
                className="mt-1 block w-full rounded-md border border-input-border px-3 py-2 text-sm shadow-sm focus:border-lagoon-800 focus:outline-none focus:ring-lagoon-800"
                required
              />
            </div>
          </div>

          <div className="mb-6">
            <h4 className="mb-3 text-sm font-medium text-chart-ink">
              Feed Entries
            </h4>
            <div className="space-y-3">
              {purchaseData.feed_entries.map((entry, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 rounded-lg bg-foam-deep/40 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-chart-ink">
                      {activeFeedTypes.find(
                        (ft) => (ft.id || ft._id) === entry.feed_type_id,
                      )?.name || 'Feed'}
                    </p>
                    <p className="text-xs text-muted">
                      {entry.number_of_bags} × {entry.bag_size || 25} kg bags (
                      {entry.quantity_kg ??
                        Number(entry.number_of_bags) *
                          Number(entry.bag_size || 25)}{' '}
                      kg) × {formatCurrency(entry.price_per_bag)}/bag ={' '}
                      {formatCurrency(entry.total_amount)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveFeedEntry(index)}
                    className="shrink-0 text-sm font-medium text-signal hover:opacity-80"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {purchaseData.feed_entries.length === 0 && (
                <p className="text-xs text-muted">
                  Add one or more feed types below, then save.
                </p>
              )}
            </div>
          </div>

          <div className="mb-6 rounded-lg border border-foam-deep p-4">
            <h4 className="mb-3 text-sm font-medium text-chart-ink">
              Add Feed Entry
            </h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-chart-ink">
                  Feed Type
                </label>
                <select
                  value={currentFeedEntry.feed_type_id}
                  onChange={(e) => {
                    const id = e.target.value
                    const ft = activeFeedTypes.find(
                      (t) => (t.id || t._id) === id,
                    )
                    const size = Number(
                      ft?.bag_size_kg || ft?.bagSizeKg || 25,
                    )
                    setCurrentFeedEntry((prev) => ({
                      ...prev,
                      feed_type_id: id,
                      bag_size: String(size > 0 ? size : 25),
                    }))
                  }}
                  className="mt-1 block w-full rounded-md border border-input-border px-3 py-2 text-sm shadow-sm focus:border-lagoon-800 focus:outline-none focus:ring-lagoon-800"
                >
                  <option value="">Select feed type</option>
                  {activeFeedTypes.map((type) => (
                    <option
                      key={type.id || type._id}
                      value={type.id || type._id}
                    >
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-chart-ink">
                  Number of Bags
                </label>
                <input
                  type="number"
                  value={currentFeedEntry.number_of_bags}
                  onChange={(e) =>
                    setCurrentFeedEntry((prev) => ({
                      ...prev,
                      number_of_bags: e.target.value,
                    }))
                  }
                  className="mt-1 block w-full rounded-md border border-input-border px-3 py-2 font-data text-sm shadow-sm focus:border-lagoon-800 focus:outline-none focus:ring-lagoon-800"
                  min="1"
                  step="0.01"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-chart-ink">
                  Price per bag (₵)
                </label>
                <input
                  type="number"
                  value={currentFeedEntry.price_per_bag}
                  onChange={(e) =>
                    setCurrentFeedEntry((prev) => ({
                      ...prev,
                      price_per_bag: e.target.value,
                    }))
                  }
                  className="mt-1 block w-full rounded-md border border-input-border px-3 py-2 font-data text-sm shadow-sm focus:border-lagoon-800 focus:outline-none focus:ring-lagoon-800"
                  min="0"
                  step="0.01"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleAddFeedEntry}
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-transparent bg-lagoon-800 px-4 py-2 text-sm font-medium text-white hover:bg-lagoon-950"
                >
                  Add Entry
                </button>
              </div>
            </div>
            <div className="mt-4">
              <BagSizeField
                id="shared-purchase-bag-size"
                value={currentFeedEntry.bag_size}
                onChange={(e) =>
                  setCurrentFeedEntry((prev) => ({
                    ...prev,
                    bag_size: e.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-chart-ink">
              Notes
            </label>
            <textarea
              value={purchaseData.notes}
              onChange={(e) =>
                setPurchaseData((prev) => ({
                  ...prev,
                  notes: e.target.value,
                }))
              }
              rows={3}
              className="mt-1 block w-full rounded-md border border-input-border px-3 py-2 text-sm shadow-sm focus:border-lagoon-800 focus:outline-none focus:ring-lagoon-800"
            />
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between rounded-lg bg-foam-deep/40 p-4">
              <span className="text-sm font-medium text-chart-ink">
                Total Amount:
              </span>
              <span className="text-lg font-bold text-chart-ink">
                {formatCurrency(purchaseData.total_amount)}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-medium text-chart-ink hover:bg-foam-deep/40 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md border border-transparent bg-lagoon-800 px-4 py-2 text-sm font-medium text-white hover:bg-lagoon-950 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Purchase'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
