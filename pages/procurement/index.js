import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import {
  PageHeader,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  TabBar,
} from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { useToast } from '../../components/Toast'
import { useCurrency } from '../../hooks/useCurrency'
import { localToday } from '../../lib/format'
import { usePermission } from '../../hooks/usePermission'

export default function ProcurementPage() {
  return (
    <ProtectedRoute>
      <Layout title="Purchase orders">
        <PurchaseOrders />
      </Layout>
    </ProtectedRoute>
  )
}

const STATUS_LABEL = {
  draft: 'Draft',
  ordered: 'Ordered',
  received: 'Received',
  cancelled: 'Cancelled',
}
const STATUS_TONE = {
  draft: 'bg-foam text-chart-ink',
  ordered: 'bg-lake/10 text-lake',
  received: 'bg-kelp/10 text-kelp',
  cancelled: 'bg-foam-deep text-muted',
}

const today = () => localToday()
const blankLine = () => ({ feedTypeId: '', quantityKg: '', pricePerKg: '' })

function PurchaseOrders() {
  const { user, hasRole } = useAuth()
  const isAdmin = usePermission('inventory.purchase.correct')
  const { activeLocationId } = useLocation()
  const { showToast } = useToast()
  const { formatCurrency } = useCurrency()

  const [status, setStatus] = useState('open')
  const orders = useQuery(api.procurement.list, user ? {} : 'skip')
  const suppliers = useQuery(api.feed.listSuppliers, user ? {} : 'skip')
  const feedTypes = useQuery(api.feed.listFeedTypes, user ? {} : 'skip')

  const createPo = useMutation(api.procurement.create)
  const markOrdered = useMutation(api.procurement.markOrdered)
  const cancelPo = useMutation(api.procurement.cancel)
  const receivePo = useMutation(api.procurement.receive)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ supplierId: '', expectedDate: '', notes: '', lines: [blankLine()] })
  const [receiving, setReceiving] = useState(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn, ok) => {
    setBusy(true)
    try {
      await fn()
      showToast('success', ok)
      return true
    } catch (err) {
      showToast('error', err.message || 'Something went wrong')
      return false
    } finally {
      setBusy(false)
    }
  }

  const setLine = (i, k) => (e) => {
    const value = e.target.value
    setForm((f) => {
      const lines = f.lines.map((l, j) => (j === i ? { ...l, [k]: value } : l))
      if (k === 'feedTypeId' && !lines[i].pricePerKg) {
        const ft = (feedTypes || []).find((t) => t.id === value)
        if (ft?.price_per_kg) lines[i] = { ...lines[i], pricePerKg: String(ft.price_per_kg) }
      }
      return { ...f, lines }
    })
  }

  const submit = async (e) => {
    e.preventDefault()
    const lines = form.lines
      .filter((l) => l.feedTypeId)
      .map((l) => ({ feedTypeId: l.feedTypeId, quantityKg: Number(l.quantityKg), pricePerKg: Number(l.pricePerKg) }))
    const ok = await run(
      () =>
        createPo({
          supplierId: form.supplierId,
          lines,
          ...(activeLocationId ? { locationId: activeLocationId } : {}),
          ...(form.expectedDate ? { expectedDate: form.expectedDate } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        }),
      'Draft saved',
    )
    if (ok) {
      setForm({ supplierId: '', expectedDate: '', notes: '', lines: [blankLine()] })
      setShowForm(false)
    }
  }

  const startReceive = (po) =>
    setReceiving({
      id: po.id,
      receivedDate: today(),
      lines: po.lines.map((l) => ({
        receivedKg: String(l.quantity_kg),
        pricePerKg: String(l.price_per_kg),
        batchNumber: '',
        expiryDate: '',
      })),
    })

  const setRecv = (i, k) => (e) => {
    const value = e.target.value
    setReceiving((r) => ({ ...r, lines: r.lines.map((l, j) => (j === i ? { ...l, [k]: value } : l)) }))
  }

  const submitReceive = async () => {
    const ok = await run(
      () =>
        receivePo({
          id: receiving.id,
          receivedDate: receiving.receivedDate,
          lines: receiving.lines.map((l, index) => ({
            index,
            receivedKg: Number(l.receivedKg) || 0,
            pricePerKg: Number(l.pricePerKg) || 0,
            ...(l.batchNumber.trim() ? { batchNumber: l.batchNumber.trim() } : {}),
            ...(l.expiryDate ? { expiryDate: l.expiryDate } : {}),
          })),
        }),
      'Delivery received into stock',
    )
    if (ok) setReceiving(null)
  }

  const visible = (orders || []).filter((po) =>
    status === 'open' ? po.status === 'draft' || po.status === 'ordered' : po.status === status,
  )

  return (
    <div>
      <PageHeader
        showTitle={false}
        breadcrumbs={[{ label: 'Feed', href: '/feed-management' }, { label: 'Purchase orders' }]}
        description="Order feed from a supplier, then receive the delivery: each line becomes a feed purchase in stock at the delivery site, at the price actually paid."
        related={[
          { label: 'Feed purchases', href: '/feed-purchases' },
          { label: 'Suppliers', href: '/feed-suppliers' },
          { label: 'Stock items', href: '/inventory/items' },
        ]}
        actions={
          <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Close' : 'New purchase order'}</Button>
        }
      />

      {showForm && (
        <Card className="mb-6">
          <CardHeader title="New purchase order" subtitle="Delivered to the site selected in the header." />
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Supplier" htmlFor="po-sup" required>
                <Select
                  id="po-sup"
                  value={form.supplierId}
                  onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
                  required
                >
                  <option value="">Select…</option>
                  {(suppliers || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Expected delivery" htmlFor="po-exp">
                <Input
                  id="po-exp"
                  type="date"
                  value={form.expectedDate}
                  onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))}
                />
              </Field>
              <Field label="Notes" htmlFor="po-notes">
                <Input
                  id="po-notes"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </Field>
            </div>
            <div className="space-y-3">
              {form.lines.map((l, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end">
                  <Field label={i === 0 ? 'Feed' : undefined} className="col-span-2 sm:col-span-1">
                    <Select value={l.feedTypeId} onChange={setLine(i, 'feedTypeId')} required={i === 0}>
                      <option value="">Select feed…</option>
                      {(feedTypes || []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={i === 0 ? 'Kg' : undefined}>
                    <Input type="number" inputMode="decimal" min="0" step="any" value={l.quantityKg} onChange={setLine(i, 'quantityKg')} />
                  </Field>
                  <Field label={i === 0 ? 'Price per kg' : undefined}>
                    <Input type="number" inputMode="decimal" min="0" step="any" value={l.pricePerKg} onChange={setLine(i, 'pricePerKg')} />
                  </Field>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="col-span-2 sm:col-span-1"
                    disabled={form.lines.length === 1}
                    onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}>
                Add line
              </Button>
            </div>
            <Button type="submit" disabled={busy}>
              Save draft
            </Button>
          </form>
        </Card>
      )}

      <div className="mb-4 overflow-x-auto">
        <TabBar
          tabs={[
            { id: 'open', label: 'Open' },
            { id: 'received', label: 'Received' },
            { id: 'cancelled', label: 'Cancelled' },
          ]}
          active={status}
          onChange={setStatus}
        />
      </div>

      <Card padding={false}>
        {orders === undefined ? (
          <p className="px-5 py-8 text-sm text-muted">Loading…</p>
        ) : visible.length === 0 ? (
          <EmptyState title="No purchase orders here" description="Start one with New purchase order." />
        ) : (
          <ul className="divide-y divide-foam-deep">
            {visible.map((po) => (
              <li key={po.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-chart-ink">
                      {po.po_number} · {po.supplier_name}
                      <span className={`ml-2 inline-flex items-center rounded-md px-1.5 text-xs font-medium ${STATUS_TONE[po.status]}`}>
                        {STATUS_LABEL[po.status]}
                      </span>
                    </p>
                    <p className="text-xs text-muted">
                      {po.location_name || 'Site on receipt'}
                      {po.expected_date ? ` · expected ${po.expected_date}` : ''}
                      {po.received_date ? ` · received ${po.received_date}` : ''}
                    </p>
                    <p className="text-xs text-muted mt-1">
                      {po.lines
                        .map((l) => `${l.feed_type_name} ${l.received_kg ?? l.quantity_kg} kg`)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-data text-sm font-semibold">
                      {formatCurrency(po.status === 'received' ? po.received_value : po.ordered_value)}
                    </span>
                    {isAdmin && po.status === 'draft' && (
                      <Button size="sm" disabled={busy} onClick={() => run(() => markOrdered({ id: po.id }), 'Order placed')}>
                        Place order
                      </Button>
                    )}
                    {po.status === 'ordered' && receiving?.id !== po.id && (
                      <Button size="sm" onClick={() => startReceive(po)}>
                        Receive
                      </Button>
                    )}
                    {isAdmin && (po.status === 'draft' || po.status === 'ordered') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          const reason = typeof window !== 'undefined' ? window.prompt('Reason for cancelling (optional)') : ''
                          if (reason === null) return
                          run(() => cancelPo({ id: po.id, ...(reason ? { reason } : {}) }), 'Order cancelled')
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>

                {receiving?.id === po.id && (
                  <div className="mt-4 rounded-lg border border-foam-deep p-4 space-y-3">
                    <Field label="Received on" htmlFor={`rv-date-${po.id}`} className="sm:w-48">
                      <Input
                        id={`rv-date-${po.id}`}
                        type="date"
                        value={receiving.receivedDate}
                        onChange={(e) => setReceiving((r) => ({ ...r, receivedDate: e.target.value }))}
                      />
                    </Field>
                    {po.lines.map((l, i) => (
                      <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
                        <p className="col-span-2 sm:col-span-1 text-sm font-medium self-center">{l.feed_type_name}</p>
                        <Field label="Kg received">
                          <Input type="number" inputMode="decimal" min="0" step="any" value={receiving.lines[i].receivedKg} onChange={setRecv(i, 'receivedKg')} />
                        </Field>
                        <Field label="Price per kg">
                          <Input type="number" inputMode="decimal" min="0" step="any" value={receiving.lines[i].pricePerKg} onChange={setRecv(i, 'pricePerKg')} />
                        </Field>
                        <Field label="Batch">
                          <Input value={receiving.lines[i].batchNumber} onChange={setRecv(i, 'batchNumber')} />
                        </Field>
                        <Field label="Expiry">
                          <Input type="date" value={receiving.lines[i].expiryDate} onChange={setRecv(i, 'expiryDate')} />
                        </Field>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Button disabled={busy} onClick={submitReceive}>
                        Receive into stock
                      </Button>
                      <Button variant="ghost" onClick={() => setReceiving(null)}>
                        Back
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
