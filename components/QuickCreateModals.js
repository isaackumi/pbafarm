import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { Button, Field, Input, Select, Textarea } from './ui'
import { useCurrency } from '../hooks/useCurrency'
import { useLocation } from '../contexts/LocationContext'
import { getActiveLocationId } from '../lib/locationScope'

function ModalShell({ title, subtitle, onClose, children }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  if (!mounted) return null

  // Portal outside any parent <form> so submit/create actually works.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-chart-ink/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-create-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-foam-deep bg-surface text-chart-ink shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-foam-deep px-5 py-4 sticky top-0 bg-surface z-10">
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
    </div>,
    document.body,
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

function cleanCageArgs(raw) {
  const args = { ...raw }
  Object.keys(args).forEach((k) => {
    if (args[k] === null || args[k] === undefined || args[k] === '') delete args[k]
  })
  return args
}

export function QuickCreateCageModal({ onClose, onCreated }) {
  const createCage = useMutation(api.cages.create)
  const { locationArgs, activeLocation } = useLocation()
  const existingCages = useQuery(api.cages.list, locationArgs)
  const [form, setForm] = useState({
    name: '',
    code: '',
    location: '',
    size: '',
    capacity: '',
    dimensions: '',
    material: '',
    installation_date: '',
    notes: '',
    status: 'empty',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')

  useEffect(() => {
    if (!existingCages) return
    setForm((prev) =>
      prev.code ? prev : { ...prev, code: nextCageCode(existingCages) },
    )
  }, [existingCages])

  useEffect(() => {
    if (activeLocation?.name) {
      setForm((prev) =>
        prev.location ? prev : { ...prev, location: activeLocation.name },
      )
    }
  }, [activeLocation])

  useEffect(() => {
    setNameError('')
    if (!form.name || !existingCages) return
    const exists = existingCages.some(
      (c) => c.name?.toLowerCase() === form.name.trim().toLowerCase(),
    )
    if (exists) {
      setNameError('This cage name already exists. Choose a unique name.')
    }
  }, [form.name, existingCages])

  const setField = (key) => (e) =>
    setForm((p) => ({ ...p, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setSaving(true)
    setError('')
    try {
      if (!form.name.trim()) throw new Error('Cage name is required')
      if (nameError) throw new Error(nameError)

      const id = await createCage(
        cleanCageArgs({
          name: form.name.trim(),
          code: form.code || undefined,
          location: form.location.trim() || undefined,
          locationId: getActiveLocationId() || undefined,
          size: form.size !== '' ? Number(form.size) : undefined,
          capacity: form.capacity !== '' ? Number(form.capacity) : undefined,
          dimensions: form.dimensions.trim() || undefined,
          material: form.material.trim() || undefined,
          installationDate: form.installation_date || undefined,
          notes: form.notes.trim() || undefined,
          status: form.status || 'empty',
        }),
      )

      onCreated?.({
        kind: 'cage',
        id,
        record: {
          _id: id,
          id,
          name: form.name.trim(),
          code: form.code,
          status: form.status || 'empty',
        },
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
      subtitle="Same fields as New Cage. Status should be Empty / Fallow so stocking can use it."
      onClose={onClose}
    >
      {error && (
        <div className="mb-3 rounded-xl border border-signal/20 bg-signal/10 px-3 py-2 text-sm text-signal">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Cage code" htmlFor="qc-cage-code" hint="Auto-generated">
            <Input
              id="qc-cage-code"
              value={form.code}
              readOnly
              className="font-data bg-foam"
            />
          </Field>
          <Field
            label="Cage name"
            htmlFor="qc-cage-name"
            required
            error={nameError || undefined}
          >
            <Input
              id="qc-cage-name"
              value={form.name}
              onChange={setField('name')}
              placeholder="e.g. North A"
              required
              autoFocus
              className={nameError ? 'border-signal' : ''}
            />
          </Field>
          <Field label="Location" htmlFor="qc-cage-location">
            <Input
              id="qc-cage-location"
              value={form.location}
              onChange={setField('location')}
              placeholder="e.g. North Pond"
            />
          </Field>
          <Field
            label="Status"
            htmlFor="qc-cage-status"
            required
            hint="Use Empty or Fallow for stocking"
          >
            <Select
              id="qc-cage-status"
              value={form.status}
              onChange={setField('status')}
              required
            >
              <option value="empty">Empty</option>
              <option value="fallow">Fallow</option>
              <option value="maintenance">Maintenance</option>
            </Select>
          </Field>
          <Field label="Size (m³)" htmlFor="qc-cage-size">
            <Input
              id="qc-cage-size"
              type="number"
              step="0.1"
              min="0"
              value={form.size}
              onChange={setField('size')}
              className="font-data"
              placeholder="Volume"
            />
          </Field>
          <Field label="Capacity (fish)" htmlFor="qc-cage-capacity">
            <Input
              id="qc-cage-capacity"
              type="number"
              min="0"
              value={form.capacity}
              onChange={setField('capacity')}
              className="font-data"
              placeholder="Max fish"
            />
          </Field>
          <Field label="Dimensions" htmlFor="qc-cage-dimensions">
            <Input
              id="qc-cage-dimensions"
              value={form.dimensions}
              onChange={setField('dimensions')}
              placeholder="e.g. 5m × 5m × 3m"
            />
          </Field>
          <Field label="Material" htmlFor="qc-cage-material">
            <Input
              id="qc-cage-material"
              value={form.material}
              onChange={setField('material')}
              placeholder="e.g. HDPE"
            />
          </Field>
          <Field label="Installation date" htmlFor="qc-cage-install">
            <Input
              id="qc-cage-install"
              type="date"
              value={form.installation_date}
              onChange={setField('installation_date')}
            />
          </Field>
        </div>
        <Field label="Notes" htmlFor="qc-cage-notes">
          <Textarea
            id="qc-cage-notes"
            value={form.notes}
            onChange={setField('notes')}
            placeholder="Optional notes"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !!nameError}>
            {saving ? 'Creating…' : 'Create cage'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

export function QuickCreateFeedTypeModal({ onClose, onCreated }) {
  const createFeedType = useMutation(api.feed.createFeedType)
  const suppliers = useQuery(api.feed.listSuppliers) || []
  const { pricePerKgLabel } = useCurrency()
  const [form, setForm] = useState({
    name: '',
    price_per_kg: '0.00',
    protein_percentage: '',
    pellet_size: '',
    supplier_id: '',
    bag_size_kg: '25',
    current_stock: '0',
    minimum_stock: '0',
    active: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setField = (key) => (e) => {
    const value =
      e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((p) => ({ ...p, [key]: value }))
  }

  const submit = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setSaving(true)
    setError('')
    try {
      if (!form.name.trim()) throw new Error('Feed type name is required')
      const parts = []
      if (form.protein_percentage !== '') {
        parts.push(`Protein ${form.protein_percentage}%`)
      }
      if (form.pellet_size.trim()) {
        parts.push(`Pellet ${form.pellet_size.trim()}`)
      }
      const description = parts.length ? parts.join(' · ') : undefined

      const args = {
        name: form.name.trim(),
        description,
        currentStock: Number(form.current_stock || 0),
        minimumStock: Number(form.minimum_stock || 0),
        pricePerKg: Number(form.price_per_kg || 0),
        bagSizeKg: Number(form.bag_size_kg || 25),
        active: form.active !== false,
      }
      if (form.supplier_id) args.supplierId = form.supplier_id

      const id = await createFeedType(args)
      onCreated?.({ kind: 'feedType', id, record: { _id: id, id, name: form.name } })
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to create feed type')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Add feed type"
      subtitle="Same fields as Feed Types → Add New Feed Type."
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
            onChange={setField('name')}
            required
            autoFocus
          />
        </Field>
        <Field label={pricePerKgLabel} htmlFor="qc-ft-price">
          <Input
            id="qc-ft-price"
            type="number"
            step="0.01"
            min="0"
            value={form.price_per_kg}
            onChange={setField('price_per_kg')}
            className="font-data"
          />
        </Field>
        <Field label="Protein percentage (%)" htmlFor="qc-ft-protein">
          <Input
            id="qc-ft-protein"
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={form.protein_percentage}
            onChange={setField('protein_percentage')}
            className="font-data"
          />
        </Field>
        <Field label="Pellet size" htmlFor="qc-ft-pellet">
          <Input
            id="qc-ft-pellet"
            value={form.pellet_size}
            onChange={setField('pellet_size')}
            placeholder="e.g. 2mm"
          />
        </Field>
        <Field label="Supplier" htmlFor="qc-ft-supplier">
          <Select
            id="qc-ft-supplier"
            value={form.supplier_id}
            onChange={setField('supplier_id')}
          >
            <option value="">Select supplier (optional)</option>
            {suppliers.map((s) => (
              <option key={s.id || s._id} value={s.id || s._id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bag size (kg)" htmlFor="qc-ft-bag" hint="Used for bags ↔ kg">
            <Input
              id="qc-ft-bag"
              type="number"
              step="0.1"
              min="0.1"
              value={form.bag_size_kg}
              onChange={setField('bag_size_kg')}
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
              onChange={setField('current_stock')}
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
              onChange={setField('minimum_stock')}
              className="font-data"
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-chart-ink">
          <input
            type="checkbox"
            checked={form.active}
            onChange={setField('active')}
            className="h-4 w-4 rounded border-input-border text-lagoon-800"
          />
          Active
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

export function QuickCreateStockingModal({ onClose, onCreated }) {
  const createStocking = useMutation(api.stocking.createStocking)
  const settingsData = useQuery(api.companies.getEffectiveSettings)
  const { locationArgs } = useLocation()
  const allCages = useQuery(api.cages.list, locationArgs)
  const stockableStatuses =
    settingsData?.settings?.stockingRules?.allowStockOnlyEmptyStatuses || [
      'empty',
      'fallow',
      'harvested',
    ]
  const cages = (allCages || []).filter((c) =>
    stockableStatuses.includes(c.status),
  )
  const ready = allCages !== undefined

  const [form, setForm] = useState({
    cageId: '',
    batchNumber: '',
    stockingDate: new Date().toISOString().split('T')[0],
    fishCount: '',
    averageBodyWeight: '',
    sourceLocation: '',
    transferSupervisor: '',
    samplingSupervisor: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showCageCreate, setShowCageCreate] = useState(false)

  const setField = (key) => (e) =>
    setForm((p) => ({ ...p, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setSaving(true)
    setError('')
    try {
      if (!form.cageId) throw new Error('Select a cage')
      if (!form.batchNumber.trim()) throw new Error('Batch number is required')
      const fishCount = parseInt(form.fishCount, 10)
      const initialAbw = parseFloat(form.averageBodyWeight)
      if (!fishCount || fishCount < 1) throw new Error('Enter a valid fish count')
      if (!initialAbw || initialAbw <= 0) throw new Error('Enter a valid ABW')

      const args = {
        cageId: form.cageId,
        batchNumber: form.batchNumber.trim(),
        stockingDate: form.stockingDate,
        fishCount,
        initialAbw,
        initialBiomass: (fishCount * initialAbw) / 1000,
      }
      if (form.sourceLocation.trim()) args.sourceLocation = form.sourceLocation.trim()
      if (form.transferSupervisor.trim()) {
        args.transferSupervisor = form.transferSupervisor.trim()
      }
      if (form.samplingSupervisor.trim()) {
        args.samplingSupervisor = form.samplingSupervisor.trim()
      }
      if (form.notes.trim()) args.notes = form.notes.trim()

      const id = await createStocking(args)
      onCreated?.({ kind: 'stocking', id, record: { _id: id, id } })
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
        onCreated={(result) => {
          if (result?.id) setForm((p) => ({ ...p, cageId: result.id }))
          setShowCageCreate(false)
        }}
      />
    )
  }

  return (
    <ModalShell
      title="Create stocking"
      subtitle="Same fields as New Stocking. May require approval before the cage goes active."
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
            onChange={setField('cageId')}
            required
            disabled={ready && cages.length === 0}
          >
            <option value="">
              {!ready
                ? 'Loading cages…'
                : cages.length === 0
                  ? 'No stockable cages'
                  : 'Choose available cage…'}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Batch number" htmlFor="qc-st-batch" required>
            <Input
              id="qc-st-batch"
              value={form.batchNumber}
              onChange={setField('batchNumber')}
              required
            />
          </Field>
          <Field label="Stocking date" htmlFor="qc-st-date" required>
            <Input
              id="qc-st-date"
              type="date"
              value={form.stockingDate}
              onChange={setField('stockingDate')}
              required
            />
          </Field>
          <Field label="Fish count" htmlFor="qc-st-count" required>
            <Input
              id="qc-st-count"
              type="number"
              min="1"
              value={form.fishCount}
              onChange={setField('fishCount')}
              className="font-data"
              required
            />
          </Field>
          <Field label="Average body weight (g)" htmlFor="qc-st-abw" required>
            <Input
              id="qc-st-abw"
              type="number"
              step="0.1"
              min="0"
              value={form.averageBodyWeight}
              onChange={setField('averageBodyWeight')}
              className="font-data"
              required
            />
          </Field>
          <Field label="Source location" htmlFor="qc-st-source" className="sm:col-span-2">
            <Input
              id="qc-st-source"
              value={form.sourceLocation}
              onChange={setField('sourceLocation')}
            />
          </Field>
          <Field label="Transfer supervisor" htmlFor="qc-st-transfer">
            <Input
              id="qc-st-transfer"
              value={form.transferSupervisor}
              onChange={setField('transferSupervisor')}
            />
          </Field>
          <Field label="Sampling supervisor" htmlFor="qc-st-sampling">
            <Input
              id="qc-st-sampling"
              value={form.samplingSupervisor}
              onChange={setField('samplingSupervisor')}
            />
          </Field>
        </div>
        <Field label="Optional notes" htmlFor="qc-st-notes">
          <Textarea
            id="qc-st-notes"
            value={form.notes}
            onChange={setField('notes')}
          />
        </Field>
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
  const createPurchase = useMutation(api.feed.createPurchase)
  const feedTypes = useQuery(api.feed.listFeedTypes)
  const suppliers = useQuery(api.feed.listSuppliers) || []
  const activeFeedTypes = (feedTypes || []).filter((t) => t.active !== false)
  const ready = feedTypes !== undefined
  const { pricePerKgLabel } = useCurrency()

  const [form, setForm] = useState({
    feed_type_id: defaultFeedTypeId || '',
    quantity: '',
    bags: '',
    price_per_kg: '',
    purchase_date: new Date().toISOString().split('T')[0],
    supplier_id: '',
    batch_number: '',
    expiry_date: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showFeedTypeCreate, setShowFeedTypeCreate] = useState(false)

  const selectedFeed = activeFeedTypes.find(
    (t) => (t.id || t._id) === form.feed_type_id,
  )
  const bagSizeKg = Number(
    selectedFeed?.bag_size_kg || selectedFeed?.bagSizeKg || 25,
  )

  const setField = (key) => (e) => {
    const value = e.target.value
    setForm((p) => {
      const next = { ...p, [key]: value }
      const size =
        key === 'feed_type_id'
          ? Number(
              activeFeedTypes.find((t) => (t.id || t._id) === value)
                ?.bag_size_kg ||
                activeFeedTypes.find((t) => (t.id || t._id) === value)
                  ?.bagSizeKg ||
                25,
            )
          : bagSizeKg

      if (key === 'bags' && value !== '') {
        const bags = parseFloat(value)
        if (!Number.isNaN(bags)) {
          next.quantity = String(Math.round(bags * size * 1000) / 1000)
        }
      }
      if (key === 'quantity' && value !== '') {
        const kg = parseFloat(value)
        if (!Number.isNaN(kg) && size > 0) {
          next.bags = String(Math.round((kg / size) * 1000) / 1000)
        }
      }
      if (key === 'feed_type_id') {
        next.price_per_kg = ''
        if (next.quantity !== '') {
          const kg = parseFloat(next.quantity)
          if (!Number.isNaN(kg) && size > 0) {
            next.bags = String(Math.round((kg / size) * 1000) / 1000)
          }
        }
      }
      return next
    })
  }

  useEffect(() => {
    if (!form.feed_type_id || form.price_per_kg !== '') return
    const ft = activeFeedTypes.find(
      (t) => (t.id || t._id) === form.feed_type_id,
    )
    const price = ft?.price_per_kg ?? ft?.pricePerKg
    if (price != null) {
      setForm((p) => ({ ...p, price_per_kg: String(price) }))
    }
  }, [form.feed_type_id, form.price_per_kg, activeFeedTypes])

  const submit = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setSaving(true)
    setError('')
    try {
      if (!form.feed_type_id) throw new Error('Select a feed type')
      if (
        (!form.quantity || Number(form.quantity) <= 0) &&
        (!form.bags || Number(form.bags) <= 0)
      ) {
        throw new Error('Enter bags or quantity (kg)')
      }
      if (form.price_per_kg === '' || Number(form.price_per_kg) < 0) {
        throw new Error('Enter a valid price per kg')
      }

      const args = {
        feedTypeId: form.feed_type_id,
        pricePerKg: Number(form.price_per_kg),
        purchaseDate: form.purchase_date,
      }
      if (form.quantity !== '' && Number(form.quantity) > 0) {
        args.quantity = Number(form.quantity)
      }
      if (form.bags !== '' && Number(form.bags) > 0) {
        args.bags = Number(form.bags)
      }
      if (form.supplier_id) args.supplierId = form.supplier_id
      if (form.batch_number.trim()) args.batchNumber = form.batch_number.trim()
      if (form.expiry_date) args.expiryDate = form.expiry_date
      if (form.notes.trim()) args.notes = form.notes.trim()
      const locId = getActiveLocationId()
      if (locId) args.locationId = locId

      const id = await createPurchase(args)
      onCreated?.({
        kind: 'purchase',
        id,
        feedTypeId: form.feed_type_id,
        record: { _id: id, id },
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
        onCreated={(result) => {
          if (result?.id) {
            setForm((p) => ({ ...p, feed_type_id: result.id, price_per_kg: '' }))
          }
          setShowFeedTypeCreate(false)
        }}
      />
    )
  }

  return (
    <ModalShell
      title="Record feed purchase"
      subtitle="Same fields as Feed Purchases → Add purchase."
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
              setForm((p) => ({
                ...p,
                feed_type_id: e.target.value,
                price_per_kg: '',
              }))
            }
            required
            disabled={ready && activeFeedTypes.length === 0}
          >
            <option value="">
              {ready && activeFeedTypes.length === 0
                ? 'No feed types'
                : 'Select feed type…'}
            </option>
            {activeFeedTypes.map((t) => (
              <option key={t.id || t._id} value={t.id || t._id}>
                {t.name} ({Number(t.current_stock ?? t.currentStock ?? 0).toFixed(1)} kg on hand)
              </option>
            ))}
          </Select>
          {ready && activeFeedTypes.length === 0 && (
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
          <Field label="Bags" htmlFor="qc-pu-bags">
            <Input
              id="qc-pu-bags"
              type="number"
              step="0.01"
              min="0"
              value={form.bags}
              onChange={setField('bags')}
              className="font-data"
              placeholder="e.g. 40"
              autoFocus
            />
          </Field>
          <Field label="Quantity (kg)" htmlFor="qc-pu-qty" required>
            <Input
              id="qc-pu-qty"
              type="number"
              step="0.01"
              min="0"
              value={form.quantity}
              onChange={setField('quantity')}
              className="font-data"
              required
            />
          </Field>
        </div>
        <p className="text-xs text-muted -mt-1">
          Bag size: {bagSizeKg} kg — enter bags or kg; the other updates.
        </p>
        <Field label={pricePerKgLabel} htmlFor="qc-pu-price" required>
          <Input
            id="qc-pu-price"
            type="number"
            step="0.01"
            min="0"
            value={form.price_per_kg}
            onChange={setField('price_per_kg')}
            className="font-data"
            required
          />
        </Field>
        <Field label="Purchase date" htmlFor="qc-pu-date" required>
          <Input
            id="qc-pu-date"
            type="date"
            value={form.purchase_date}
            onChange={setField('purchase_date')}
            required
          />
        </Field>
        <Field label="Supplier" htmlFor="qc-pu-supplier">
          <Select
            id="qc-pu-supplier"
            value={form.supplier_id}
            onChange={setField('supplier_id')}
          >
            <option value="">Select supplier (optional)</option>
            {suppliers.map((s) => (
              <option key={s.id || s._id} value={s.id || s._id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Batch number" htmlFor="qc-pu-batch">
          <Input
            id="qc-pu-batch"
            value={form.batch_number}
            onChange={setField('batch_number')}
          />
        </Field>
        <Field label="Expiry date" htmlFor="qc-pu-expiry">
          <Input
            id="qc-pu-expiry"
            type="date"
            value={form.expiry_date}
            onChange={setField('expiry_date')}
          />
        </Field>
        <Field label="Notes" htmlFor="qc-pu-notes">
          <Textarea
            id="qc-pu-notes"
            value={form.notes}
            onChange={setField('notes')}
            rows={3}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || activeFeedTypes.length === 0}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

