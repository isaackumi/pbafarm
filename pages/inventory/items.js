import { useMemo, useState } from 'react'
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
import { localToday } from '../../lib/format'
import { usePermission } from '../../hooks/usePermission'

export default function InventoryItemsPage() {
  return (
    <ProtectedRoute>
      <Layout title="Stock items">
        <Items />
      </Layout>
    </ProtectedRoute>
  )
}

const CATEGORIES = [
  ['chemical', 'Chemical'],
  ['drug', 'Drug'],
  ['net', 'Net'],
  ['equipment', 'Equipment'],
  ['fuel', 'Fuel'],
  ['spare', 'Spare part'],
  ['other', 'Other'],
]
const categoryLabel = (k) => (CATEGORIES.find(([key]) => key === k) || [k, k])[1]

const MOVE_LABEL = {
  receipt: 'Received',
  issue: 'Issued',
  adjustment: 'Adjusted',
  transfer_out: 'Transferred out',
  transfer_in: 'Transferred in',
}

const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US')
const today = () => localToday()

function Items() {
  const { user, hasRole } = useAuth()
  const isAdmin = usePermission('inventory.adjust')
  const { locationArgs, activeLocationId, locations } = useLocation()
  const { showToast } = useToast()

  const items = useQuery(api.inventoryItems.listItems, user ? locationArgs : 'skip')
  const movements = useQuery(api.inventoryItems.listMovements, user ? { limit: 50 } : 'skip')
  const cages = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const suppliers = useQuery(api.feed.listSuppliers, user ? {} : 'skip')

  const createItem = useMutation(api.inventoryItems.createItem)
  const receive = useMutation(api.inventoryItems.receive)
  const issue = useMutation(api.inventoryItems.issue)
  const adjust = useMutation(api.inventoryItems.adjust)
  const transfer = useMutation(api.inventoryItems.transfer)

  const [mode, setMode] = useState('issue')
  const [move, setMove] = useState({
    itemId: '',
    quantity: '',
    cageId: '',
    unitCost: '',
    toLocationId: '',
    reason: '',
    date: today(),
  })
  const [newItem, setNewItem] = useState({ name: '', category: 'chemical', unit: 'L', minimumStock: '', supplierId: '' })
  const [busy, setBusy] = useState(false)

  const selected = useMemo(
    () => (items || []).find((i) => i.id === move.itemId) || null,
    [items, move.itemId],
  )
  const setM = (k) => (e) => setMove((m) => ({ ...m, [k]: e.target.value }))
  const setN = (k) => (e) => setNewItem((n) => ({ ...n, [k]: e.target.value }))

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

  const submitMove = async (e) => {
    e.preventDefault()
    const quantity = Number(move.quantity)
    if (!move.itemId || !quantity) {
      showToast('error', 'Pick an item and a quantity')
      return
    }
    const site = activeLocationId ? { locationId: activeLocationId } : {}
    const done = await run(async () => {
      if (mode === 'receive') {
        await receive({
          itemId: move.itemId,
          quantity,
          date: move.date,
          ...site,
          ...(move.unitCost ? { unitCost: Number(move.unitCost) } : {}),
        })
      } else if (mode === 'issue') {
        await issue({
          itemId: move.itemId,
          quantity,
          date: move.date,
          ...(move.cageId ? { cageId: move.cageId } : site),
        })
      } else if (mode === 'adjust') {
        await adjust({ itemId: move.itemId, delta: quantity, reason: move.reason, ...site })
      } else {
        if (!activeLocationId) throw new Error('Pick the source site in the header first')
        await transfer({
          itemId: move.itemId,
          quantity,
          fromLocationId: activeLocationId,
          toLocationId: move.toLocationId,
          date: move.date,
        })
      }
    }, 'Stock updated')
    if (done) setMove((m) => ({ ...m, quantity: '', unitCost: '', reason: '' }))
  }

  const submitItem = async (e) => {
    e.preventDefault()
    const done = await run(
      () =>
        createItem({
          name: newItem.name,
          category: newItem.category,
          unit: newItem.unit,
          ...(newItem.minimumStock ? { minimumStock: Number(newItem.minimumStock) } : {}),
          ...(newItem.supplierId ? { supplierId: newItem.supplierId } : {}),
        }),
      'Item added',
    )
    if (done) setNewItem((n) => ({ ...n, name: '', minimumStock: '' }))
  }

  const modes = [
    { id: 'issue', label: 'Issue' },
    { id: 'receive', label: 'Receive' },
    ...(isAdmin
      ? [
          { id: 'adjust', label: 'Adjust' },
          { id: 'transfer', label: 'Transfer' },
        ]
      : []),
  ]

  return (
    <div>
      <PageHeader
        showTitle={false}
        breadcrumbs={[{ label: 'Inventory', href: '/inventory/overview' }, { label: 'Stock items' }]}
        description="Chemicals, drugs, nets, equipment and other non-feed stock, held per site. Feed is managed under Feed."
        related={[
          { label: 'Purchase orders', href: '/procurement' },
          { label: 'Feed stock levels', href: '/stock-levels' },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-1">
          <CardHeader title="Move stock" subtitle="At the site selected in the header." />
          <div className="mb-4 overflow-x-auto">
            <TabBar tabs={modes} active={mode} onChange={setMode} />
          </div>
          <form onSubmit={submitMove} className="space-y-4">
            <Field label="Item" htmlFor="mv-item" required>
              <Select id="mv-item" value={move.itemId} onChange={setM('itemId')} required>
                <option value="">Select…</option>
                {(items || []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({fmt(i.site_quantity ?? i.total)} {i.unit})
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={`${mode === 'adjust' ? 'Change (+/−)' : 'Quantity'}${selected ? ` (${selected.unit})` : ''}`}
              htmlFor="mv-qty"
              required
            >
              <Input id="mv-qty" type="number" inputMode="decimal" step="any" value={move.quantity} onChange={setM('quantity')} required />
            </Field>
            {mode === 'issue' && (
              <Field label="Cage" htmlFor="mv-cage">
                <Select id="mv-cage" value={move.cageId} onChange={setM('cageId')}>
                  <option value="">Not for a cage</option>
                  {(cages || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {mode === 'receive' && (
              <Field label="Unit cost" htmlFor="mv-cost">
                <Input id="mv-cost" type="number" inputMode="decimal" step="any" min="0" value={move.unitCost} onChange={setM('unitCost')} />
              </Field>
            )}
            {mode === 'adjust' && (
              <Field label="Reason" htmlFor="mv-reason" required>
                <Input id="mv-reason" value={move.reason} onChange={setM('reason')} placeholder="Stock count, damage…" required />
              </Field>
            )}
            {mode === 'transfer' && (
              <Field label="To site" htmlFor="mv-to" required>
                <Select id="mv-to" value={move.toLocationId} onChange={setM('toLocationId')} required>
                  <option value="">Select…</option>
                  {(locations || [])
                    .filter((l) => (l.id || l._id) !== activeLocationId)
                    .map((l) => (
                      <option key={l.id || l._id} value={l.id || l._id}>
                        {l.name}
                      </option>
                    ))}
                </Select>
              </Field>
            )}
            {mode !== 'adjust' && (
              <Field label="Date" htmlFor="mv-date">
                <Input id="mv-date" type="date" value={move.date} onChange={setM('date')} />
              </Field>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </form>
        </Card>

        <Card padding={false} className="lg:col-span-2">
          <div className="px-5 py-4 border-b border-foam-deep">
            <h2 className="font-display text-lg font-medium text-chart-ink">Items</h2>
          </div>
          {items === undefined ? (
            <p className="px-5 py-8 text-sm text-muted">Loading…</p>
          ) : items.length === 0 ? (
            <EmptyState title="No stock items yet" description="Add chemicals, nets or equipment below." />
          ) : (
            <ul className="divide-y divide-foam-deep">
              {items.map((i) => (
                <li key={i.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-chart-ink">
                        {i.name}
                        {i.low && (
                          <span className="ml-2 inline-flex items-center rounded-md bg-signal/10 text-signal px-1.5 text-xs font-medium">
                            Low
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {categoryLabel(i.category)}
                        {i.minimum_stock > 0 ? ` · reorder at ${fmt(i.minimum_stock)} ${i.unit}` : ''}
                        {i.supplier_name ? ` · ${i.supplier_name}` : ''}
                      </p>
                      {i.levels.length > 1 && (
                        <p className="text-xs text-muted mt-0.5">
                          {i.levels.map((l) => `${l.location_name} ${fmt(l.quantity)}`).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-data text-sm font-semibold">
                        {fmt(i.site_quantity ?? i.total)} {i.unit}
                      </p>
                      {i.site_quantity != null && (
                        <p className="text-xs text-muted">{fmt(i.total)} all sites</p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader title="Add item" />
          <form onSubmit={submitItem} className="space-y-4">
            <Field label="Name" htmlFor="it-name" required>
              <Input id="it-name" value={newItem.name} onChange={setN('name')} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category" htmlFor="it-cat">
                <Select id="it-cat" value={newItem.category} onChange={setN('category')}>
                  {CATEGORIES.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Unit" htmlFor="it-unit" required>
                <Input id="it-unit" value={newItem.unit} onChange={setN('unit')} placeholder="L, kg, pcs" required />
              </Field>
            </div>
            <Field label="Reorder level" htmlFor="it-min" hint="Admins get a low-stock reminder at or below this.">
              <Input id="it-min" type="number" inputMode="decimal" min="0" step="any" value={newItem.minimumStock} onChange={setN('minimumStock')} />
            </Field>
            <Field label="Supplier" htmlFor="it-sup">
              <Select id="it-sup" value={newItem.supplierId} onChange={setN('supplierId')}>
                <option value="">None</option>
                {(suppliers || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary" className="w-full" disabled={busy}>
              Add item
            </Button>
          </form>
        </Card>

        <Card padding={false} className="lg:col-span-2">
          <div className="px-5 py-4 border-b border-foam-deep">
            <h2 className="font-display text-lg font-medium text-chart-ink">Recent movements</h2>
          </div>
          {movements === undefined ? (
            <p className="px-5 py-8 text-sm text-muted">Loading…</p>
          ) : movements.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted">No movements yet.</p>
          ) : (
            <ul className="divide-y divide-foam-deep">
              {movements.map((m) => (
                <li key={m.id} className="px-5 py-2.5 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-chart-ink">
                      {MOVE_LABEL[m.type] || m.type} · {m.item_name}
                    </p>
                    <p className="text-xs text-muted truncate">
                      {m.date} · {m.location_name}
                      {m.cage_name ? ` → ${m.cage_name}` : ''}
                      {m.notes ? ` · ${m.notes}` : ''}
                    </p>
                  </div>
                  <span className={`font-data shrink-0 ${m.quantity < 0 ? 'text-signal' : 'text-kelp'}`}>
                    {m.quantity > 0 ? '+' : ''}
                    {fmt(m.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
