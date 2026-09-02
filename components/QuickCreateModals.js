import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cageService } from '../lib/cageService'
import { feedTypeService } from '../lib/feedTypeService'
import stockingService from '../lib/stockingService'
import { feedService } from '../lib/feedService'
import { Button, Field, Input, Select } from './ui'

function ModalShell({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-chart-ink/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-create-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-foam-deep bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-foam-deep px-5 py-4">
          <div>
            <h3 id="quick-create-title" className="text-lg font-semibold text-chart-ink">
              {title}
            </h3>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-foam hover:text-chart-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function nextCageCode(cages) {
  let max = 0
  ;(cages || []).forEach((cage) => {
    if (cage.code && String(cage.code).startsWith('C')) {
      const n = parseInt(String(cage.code).substring(1), 10)
      if (!isNaN(n) && n > max) max = n
    }
  })
  return `C${(max + 1).toString().padStart(3, '0')}`
}

export function QuickCreateCageModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    code: '',
    location: '',
    size: '',
    capacity: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    cageService.getAllCages().then(({ data }) => {
      setForm((prev) => ({ ...prev, code: nextCageCode(data) }))
    })
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!form.name.trim()) throw new Error('Cage name is required')
      const { data, error: createError } = await cageService.createCage({
        name: form.name.trim(),
        code: form.code || undefined,
        location: form.location.trim() || undefined,
        size: form.size ? Number(form.size) : undefined,
        capacity: form.capacity ? Number(form.capacity) : undefined,
        status: 'empty',
      })
      if (createError) throw createError
      onCreated?.({
        kind: 'cage',
        id: data?.id || data?._id,
        record: data,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to create cage')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Create cage"
      subtitle="Quick add — you can edit details later from Cages."
      onClose={onClose}
    >
      {error && (
        <div className="mb-3 rounded-xl border border-signal/20 bg-signal/10 px-3 py-2 text-sm text-signal">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Code" htmlFor="qc-cage-code">
          <Input
            id="qc-cage-code"
            value={form.code}
            readOnly
            className="font-data bg-foam"
          />
        </Field>
        <Field label="Name" htmlFor="qc-cage-name" required>
          <Input
            id="qc-cage-name"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="e.g. North A"
            required
            autoFocus
          />
        </Field>
        <Field label="Location" htmlFor="qc-cage-location">
          <Input
            id="qc-cage-location"
            value={form.location}
            onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Size (m³)" htmlFor="qc-cage-size">
            <Input
              id="qc-cage-size"
              type="number"
              step="0.1"
              min="0"
              value={form.size}
              onChange={(e) => setForm((p) => ({ ...p, size: e.target.value }))}
              className="font-data"
            />
          </Field>
          <Field label="Capacity" htmlFor="qc-cage-capacity">
            <Input
              id="qc-cage-capacity"
              type="number"
              min="0"
              value={form.capacity}
              onChange={(e) => setForm((p) => ({ ...p, capacity: e.target.value }))}
              className="font-data"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create cage'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

export function QuickCreateFeedTypeModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    price_per_kg: '',
    minimum_stock: '0',
    current_stock: '0',
    bag_size_kg: '25',
    description: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!form.name.trim()) throw new Error('Feed type name is required')
      const { data, error: createError } = await feedTypeService.createFeedType({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        price_per_kg: Number(form.price_per_kg || 0),
        minimum_stock: Number(form.minimum_stock || 0),
        current_stock: Number(form.current_stock || 0),
        bag_size_kg: Number(form.bag_size_kg || 25),
        active: true,
      })
      if (createError) throw createError
      onCreated?.({
        kind: 'feedType',
        id: data?.id || data?._id,
        record: data,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to create feed type')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Create feed type"
      subtitle="Quick add — purchases can top up stock later."
      onClose={onClose}
    >
      {error && (
        <div className="mb-3 rounded-xl border border-signal/20 bg-signal/10 px-3 py-2 text-sm text-signal">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" htmlFor="qc-ft-name" required>
          <Input
            id="qc-ft-name"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="e.g. Grower 32%"
            required
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price / kg" htmlFor="qc-ft-price" required>
            <Input
              id="qc-ft-price"
              type="number"
              step="0.01"
              min="0"
              value={form.price_per_kg}
              onChange={(e) => setForm((p) => ({ ...p, price_per_kg: e.target.value }))}
              className="font-data"
              required
            />
          </Field>
          <Field label="Bag size (kg)" htmlFor="qc-ft-bag">
            <Input
              id="qc-ft-bag"
              type="number"
              step="0.1"
              min="0.1"
              value={form.bag_size_kg}
              onChange={(e) => setForm((p) => ({ ...p, bag_size_kg: e.target.value }))}
              className="font-data"
            />
          </Field>
          <Field label="Opening stock (kg)" htmlFor="qc-ft-stock">
            <Input
              id="qc-ft-stock"
              type="number"
              step="0.1"
              min="0"
              value={form.current_stock}
              onChange={(e) => setForm((p) => ({ ...p, current_stock: e.target.value }))}
              className="font-data"
            />
          </Field>
          <Field label="Minimum stock (kg)" htmlFor="qc-ft-min">
            <Input
              id="qc-ft-min"
              type="number"
              step="0.1"
              min="0"
              value={form.minimum_stock}
              onChange={(e) => setForm((p) => ({ ...p, minimum_stock: e.target.value }))}
              className="font-data"
            />
          </Field>
        </div>
        <Field label="Description" htmlFor="qc-ft-desc">
          <Input
            id="qc-ft-desc"
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create feed type'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

export function QuickCreateStockingModal({ onClose, onCreated }) {
  const [cages, setCages] = useState([])
  const [ready, setReady] = useState(false)
  const [form, setForm] = useState({
    cageId: '',
    batchNumber: '',
    stockingDate: new Date().toISOString().split('T')[0],
    fishCount: '',
    averageBodyWeight: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showCageCreate, setShowCageCreate] = useState(false)

  const loadCages = async () => {
    try {
      const { data } = await cageService.getAllCages()
      const available = (data || []).filter((c) =>
        ['empty', 'fallow', 'harvested'].includes(c.status),
      )
      setCages(available)
    } finally {
      setReady(true)
    }
  }

  useEffect(() => {
    loadCages()
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!form.cageId) throw new Error('Select a cage')
      const { data, error: createError } = await stockingService.createStocking({
        cage_id: form.cageId,
        batch_number: form.batchNumber,
        stocking_date: form.stockingDate,
        fish_count: parseInt(form.fishCount, 10),
        initial_abw: parseFloat(form.averageBodyWeight),
      })
      if (createError) throw createError
      onCreated?.({
        kind: 'stocking',
        id: data?.id || data?._id,
        record: data,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to create stocking')
    } finally {
      setSaving(false)
    }
  }

  if (showCageCreate) {
    return (
      <QuickCreateCageModal
        onClose={() => setShowCageCreate(false)}
        onCreated={async (result) => {
          await loadCages()
          if (result?.id) {
            setForm((p) => ({ ...p, cageId: result.id }))
          }
          setShowCageCreate(false)
        }}
      />
    )
  }

  return (
    <ModalShell
      title="Create stocking"
      subtitle="Stocks an empty cage. May require approval before it becomes active."
      onClose={onClose}
    >
      {error && (
        <div className="mb-3 rounded-xl border border-signal/20 bg-signal/10 px-3 py-2 text-sm text-signal">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Cage" htmlFor="qc-st-cage" required>
          <Select
            id="qc-st-cage"
            value={form.cageId}
            onChange={(e) => setForm((p) => ({ ...p, cageId: e.target.value }))}
            required
            disabled={ready && cages.length === 0}
          >
            <option value="">
              {ready && cages.length === 0
                ? 'No stockable cages'
                : 'Choose cage…'}
            </option>
            {cages.map((c) => (
              <option key={c.id || c._id} value={c.id || c._id}>
                {c.name} — {c.status}
              </option>
            ))}
          </Select>
          {ready && cages.length === 0 && (
            <button
              type="button"
              onClick={() => setShowCageCreate(true)}
              className="mt-2 text-sm font-semibold text-lagoon-800 underline-offset-2 hover:underline"
            >
              Create a cage first
            </button>
          )}
        </Field>
        <Field label="Batch number" htmlFor="qc-st-batch" required>
          <Input
            id="qc-st-batch"
            value={form.batchNumber}
            onChange={(e) => setForm((p) => ({ ...p, batchNumber: e.target.value }))}
            required
          />
        </Field>
        <Field label="Stocking date" htmlFor="qc-st-date" required>
          <Input
            id="qc-st-date"
            type="date"
            value={form.stockingDate}
            onChange={(e) => setForm((p) => ({ ...p, stockingDate: e.target.value }))}
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fish count" htmlFor="qc-st-count" required>
            <Input
              id="qc-st-count"
              type="number"
              min="1"
              value={form.fishCount}
              onChange={(e) => setForm((p) => ({ ...p, fishCount: e.target.value }))}
              className="font-data"
              required
            />
          </Field>
          <Field label="ABW (g)" htmlFor="qc-st-abw" required>
            <Input
              id="qc-st-abw"
              type="number"
              step="0.1"
              min="0"
              value={form.averageBodyWeight}
              onChange={(e) =>
                setForm((p) => ({ ...p, averageBodyWeight: e.target.value }))
              }
              className="font-data"
              required
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || cages.length === 0}>
            {saving ? 'Creating…' : 'Create stocking'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

export function QuickCreatePurchaseModal({
  onClose,
  onCreated,
  defaultFeedTypeId = '',
}) {
  const [feedTypes, setFeedTypes] = useState([])
  const [ready, setReady] = useState(false)
  const [showFeedTypeCreate, setShowFeedTypeCreate] = useState(false)
  const [form, setForm] = useState({
    feed_type_id: defaultFeedTypeId || '',
    quantity: '',
    price_per_kg: '',
    purchase_date: new Date().toISOString().split('T')[0],
    batch_number: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadFeedTypes = async () => {
    try {
      const { data } = await feedTypeService.getActiveFeedTypes()
      setFeedTypes(data || [])
      if (!form.feed_type_id && defaultFeedTypeId) {
        setForm((p) => ({ ...p, feed_type_id: defaultFeedTypeId }))
      }
    } finally {
      setReady(true)
    }
  }

  useEffect(() => {
    loadFeedTypes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const ft = feedTypes.find(
      (t) => (t.id || t._id) === form.feed_type_id,
    )
    if (ft && !form.price_per_kg) {
      const price = ft.price_per_kg ?? ft.pricePerKg
      if (price != null) {
        setForm((p) => ({ ...p, price_per_kg: String(price) }))
      }
    }
  }, [form.feed_type_id, feedTypes, form.price_per_kg])

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!form.feed_type_id) throw new Error('Select a feed type')
      if (!form.quantity || Number(form.quantity) <= 0) {
        throw new Error('Enter a quantity greater than zero')
      }
      if (form.price_per_kg === '' || Number(form.price_per_kg) < 0) {
        throw new Error('Enter a valid price per kg')
      }
      const { data, error: createError } = await feedService.createPurchase({
        feed_type_id: form.feed_type_id,
        quantity: Number(form.quantity),
        price_per_kg: Number(form.price_per_kg),
        purchase_date: form.purchase_date,
        batch_number: form.batch_number || undefined,
      })
      if (createError) throw createError
      onCreated?.({
        kind: 'purchase',
        id: data?.id || data?._id,
        feedTypeId: form.feed_type_id,
        record: data,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to record purchase')
    } finally {
      setSaving(false)
    }
  }

  if (showFeedTypeCreate) {
    return (
      <QuickCreateFeedTypeModal
        onClose={() => setShowFeedTypeCreate(false)}
        onCreated={async (result) => {
          await loadFeedTypes()
          if (result?.id) {
            setForm((p) => ({ ...p, feed_type_id: result.id }))
          }
          setShowFeedTypeCreate(false)
        }}
      />
    )
  }

  return (
    <ModalShell
      title="Record feed purchase"
      subtitle="Adds stock to the inventory ledger for this feed type."
      onClose={onClose}
    >
      {error && (
        <div className="mb-3 rounded-xl border border-signal/20 bg-signal/10 px-3 py-2 text-sm text-signal">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Feed type" htmlFor="qc-pu-ft" required>
          <Select
            id="qc-pu-ft"
            value={form.feed_type_id}
            onChange={(e) =>
              setForm((p) => ({ ...p, feed_type_id: e.target.value, price_per_kg: '' }))
            }
            required
            disabled={ready && feedTypes.length === 0}
          >
            <option value="">
              {ready && feedTypes.length === 0
                ? 'No feed types'
                : 'Select feed type…'}
            </option>
            {feedTypes.map((t) => (
              <option key={t.id || t._id} value={t.id || t._id}>
                {t.name} ({Number(t.current_stock || 0).toFixed(1)} kg on hand)
              </option>
            ))}
          </Select>
          {ready && feedTypes.length === 0 && (
            <button
              type="button"
              onClick={() => setShowFeedTypeCreate(true)}
              className="mt-2 text-sm font-semibold text-lagoon-800 underline-offset-2 hover:underline"
            >
              Create a feed type first
            </button>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity (kg)" htmlFor="qc-pu-qty" required>
            <Input
              id="qc-pu-qty"
              type="number"
              step="0.01"
              min="0.01"
              value={form.quantity}
              onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
              className="font-data"
              required
              autoFocus
            />
          </Field>
          <Field label="Price / kg" htmlFor="qc-pu-price" required>
            <Input
              id="qc-pu-price"
              type="number"
              step="0.01"
              min="0"
              value={form.price_per_kg}
              onChange={(e) =>
                setForm((p) => ({ ...p, price_per_kg: e.target.value }))
              }
              className="font-data"
              required
            />
          </Field>
        </div>
        <Field label="Purchase date" htmlFor="qc-pu-date" required>
          <Input
            id="qc-pu-date"
            type="date"
            value={form.purchase_date}
            onChange={(e) =>
              setForm((p) => ({ ...p, purchase_date: e.target.value }))
            }
            required
          />
        </Field>
        <Field label="Batch number" htmlFor="qc-pu-batch">
          <Input
            id="qc-pu-batch"
            value={form.batch_number}
            onChange={(e) =>
              setForm((p) => ({ ...p, batch_number: e.target.value }))
            }
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || feedTypes.length === 0}>
            {saving ? 'Saving…' : 'Record purchase'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}
