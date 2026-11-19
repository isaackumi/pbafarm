import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import BagSizeField, {
  DEFAULT_BAG_SIZE_KG,
  resolveBagSizeKg,
} from './BagSizeField'
import LocationMetaField from './LocationMetaField'
import { useMutation } from 'convex/react'
import { api } from '../convex/_generated/api'
import { purchaseCreateArgs } from '../lib/feedData'
import { errorMessage } from '../lib/errorMessage'
import { formatCurrency } from '../lib/currencyUtils'
import { useLocation } from '../contexts/LocationContext'
import { useToast } from './Toast'
import { Button, Field, Input, Modal, Select, Textarea } from './ui'
import { localToday } from '../lib/format'

const emptyEntry = (overrides = {}) => ({
  feed_type_id: '',
  number_of_bags: '',
  price_per_bag: '',
  bag_size: String(DEFAULT_BAG_SIZE_KG),
  ...overrides,
})

const emptyPurchase = () => ({
  supplier_id: '',
  purchase_date: localToday(),
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
  const createPurchase = useMutation(api.feed.createPurchase)
  const [mounted, setMounted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [purchaseData, setPurchaseData] = useState(emptyPurchase)
  const [currentFeedEntry, setCurrentFeedEntry] = useState(emptyEntry)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const ft = feedTypes.find(
      (t) => (t.id || t._id) === defaultFeedTypeId,
    )
    const defaultSupplier = ft?.supplier_id || ft?.supplierId || ''
    setPurchaseData({
      ...emptyPurchase(),
      supplier_id: defaultSupplier ? String(defaultSupplier) : '',
    })
    setCurrentFeedEntry(
      emptyEntry(
        defaultFeedTypeId
          ? {
              feed_type_id: defaultFeedTypeId,
            }
          : {},
      ),
    )
  }, [open, defaultFeedTypeId, feedTypes])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

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
      const locationId = activeLocationId || undefined
      const errors = []
      for (const entry of purchaseData.feed_entries) {
        const bags = Number(entry.number_of_bags)
        const bagSize = resolveBagSizeKg(entry.bag_size)
        const pricePerBag = Number(entry.price_per_bag)
        const quantityKg =
          entry.quantity_kg != null
            ? Number(entry.quantity_kg)
            : Math.round(bags * bagSize * 1000) / 1000
        const pricePerKg =
          bagSize > 0 ? Math.round((pricePerBag / bagSize) * 10000) / 10000 : 0

        try {
          await createPurchase(
            purchaseCreateArgs(
              {
                feed_type_id: entry.feed_type_id,
                quantity: quantityKg,
                bags,
                price_per_kg: pricePerKg,
                purchase_date: purchaseData.purchase_date,
                supplier_id: purchaseData.supplier_id,
                notes: purchaseData.notes || undefined,
              },
              locationId,
            ),
          )
        } catch (error) {
          const name =
            feedTypes.find((t) => (t.id || t._id) === entry.feed_type_id)
              ?.name || 'entry'
          errors.push(errorMessage(error, `Failed to save ${name}`))
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
      showToast(errorMessage(err, 'Failed to save feed purchase'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!open || !mounted) return null

  const activeFeedTypes = (feedTypes || []).filter((t) => t.active !== false)

  return createPortal(
    <Modal
      onClose={onClose}
      dismissible={!saving}
      as="form"
      closeOnBackdrop={false}
      onSubmit={handleSubmit}
      title={title}
      size="4xl"
      footer={
        <>
          <Button
            variant="secondary"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save purchase'}
          </Button>
        </>
      }
    >
      <div className="mb-6">
        <LocationMetaField />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Supplier" htmlFor="fpm-supplier" required>
          <Select
            id="fpm-supplier"
            value={purchaseData.supplier_id}
            onChange={(e) =>
              setPurchaseData((prev) => ({
                ...prev,
                supplier_id: e.target.value,
              }))
            }
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
          </Select>
        </Field>
        <Field label="Purchase date" htmlFor="fpm-date" required>
          <Input
            id="fpm-date"
            type="date"
            value={purchaseData.purchase_date}
            onChange={(e) =>
              setPurchaseData((prev) => ({
                ...prev,
                purchase_date: e.target.value,
              }))
            }
            required
          />
        </Field>
      </div>

      <div className="mb-6">
        <h4 className="mb-3 text-sm font-medium text-chart-ink">
          Feed entries
        </h4>
        <div className="space-y-3">
          {purchaseData.feed_entries.map((entry, index) => (
            <div
              key={index}
              className="flex items-center gap-4 rounded-lg border border-foam-deep bg-foam p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-chart-ink">
                  {activeFeedTypes.find(
                    (ft) => (ft.id || ft._id) === entry.feed_type_id,
                  )?.name || 'Feed'}
                </p>
                <p className="text-xs text-muted tabular-nums">
                  {entry.number_of_bags} × {entry.bag_size || DEFAULT_BAG_SIZE_KG} kg bags (
                  {entry.quantity_kg ??
                    Number(entry.number_of_bags) *
                      Number(entry.bag_size || DEFAULT_BAG_SIZE_KG)}{' '}
                  kg) × {formatCurrency(entry.price_per_bag)}/bag ={' '}
                  {formatCurrency(entry.total_amount)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveFeedEntry(index)}
                className="shrink-0 text-signal"
              >
                Remove
              </Button>
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
          Add feed entry
        </h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Feed type" htmlFor="fpm-feed-type">
            <Select
              id="fpm-feed-type"
              value={currentFeedEntry.feed_type_id}
              onChange={(e) => {
                const id = e.target.value
                const ft = activeFeedTypes.find(
                  (t) => (t.id || t._id) === id,
                )
                setCurrentFeedEntry((prev) => ({
                  ...prev,
                  feed_type_id: id,
                }))
                // Prefill supplier from feed type when purchase supplier empty
                const feedSupplier = ft?.supplier_id || ft?.supplierId
                if (feedSupplier) {
                  setPurchaseData((prev) =>
                    prev.supplier_id
                      ? prev
                      : { ...prev, supplier_id: String(feedSupplier) },
                  )
                }
              }}
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
            </Select>
          </Field>
          <Field label="Number of bags" htmlFor="fpm-bags">
            <Input
              id="fpm-bags"
              type="number"
              value={currentFeedEntry.number_of_bags}
              onChange={(e) =>
                setCurrentFeedEntry((prev) => ({
                  ...prev,
                  number_of_bags: e.target.value,
                }))
              }
              className="font-data tabular-nums"
              min="1"
              step="0.01"
            />
          </Field>
          <Field label="Price per bag (₵)" htmlFor="fpm-price">
            <Input
              id="fpm-price"
              type="number"
              value={currentFeedEntry.price_per_bag}
              onChange={(e) =>
                setCurrentFeedEntry((prev) => ({
                  ...prev,
                  price_per_bag: e.target.value,
                }))
              }
              className="font-data tabular-nums"
              min="0"
              step="0.01"
            />
          </Field>
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={handleAddFeedEntry}
              className="w-full"
            >
              Add entry
            </Button>
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

      <Field label="Notes" htmlFor="fpm-notes" className="mb-6">
        <Textarea
          id="fpm-notes"
          value={purchaseData.notes}
          onChange={(e) =>
            setPurchaseData((prev) => ({
              ...prev,
              notes: e.target.value,
            }))
          }
          rows={3}
        />
      </Field>

      <div className="mb-6">
        <div className="flex items-center justify-between rounded-lg border border-foam-deep bg-foam p-4">
          <span className="text-sm font-medium text-chart-ink">
            Total amount
          </span>
          <span className="text-lg font-semibold text-chart-ink tabular-nums">
            {formatCurrency(purchaseData.total_amount)}
          </span>
        </div>
      </div>
    </Modal>,
    document.body,
  )
}
