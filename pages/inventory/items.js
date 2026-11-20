import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import {
  Field,
  GhostButton,
  GradientButton,
  Input,
  KpiStrip,
  Pill,
  Select,
  Segmented,
  Table,
} from '../../components/ui'
import NavTabs from '../../components/ui/NavTabs'
import { Panel, ListRow } from '../../components/ui/Panel'
import InventoryActions from '../../components/inventory/InventoryActions'
import { inventoryTabs } from '../../lib/sectionTabs'
import { shortDate } from '../../lib/feedOverview'
import { useT } from '../../lib/i18n/context'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { useToast } from '../../components/Toast'
import { formatNumber, localToday } from '../../lib/format'
import { usePermission } from '../../hooks/usePermission'

export default function InventoryItemsPage() {
  const t = useT()
  return (
    <ProtectedRoute>
      <Layout title={t('ops.inventory.title')} eyebrow={t('ops.items.eyebrow')} actions={<InventoryActions />}>
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
const MOVE_TONE = {
  receipt: 'green',
  issue: 'neutral',
  adjustment: 'amber',
  transfer_out: 'cyan',
  transfer_in: 'cyan',
}

const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US')
const today = () => localToday()

function Items() {
  const t = useT()
  const { user } = useAuth()
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
  const [category, setCategory] = useState('all')

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
    { value: 'issue', label: t('ops.items.mode.issue') },
    { value: 'receive', label: t('ops.items.mode.receive') },
    ...(isAdmin
      ? [
          { value: 'adjust', label: t('ops.items.mode.adjust') },
          { value: 'transfer', label: t('ops.items.mode.transfer') },
        ]
      : []),
  ]

  const categoriesPresent = CATEGORIES.filter(([k]) => (items || []).some((i) => i.category === k))
  const shownItems = (items || []).filter((i) => category === 'all' || i.category === category)
  const lowCount = (items || []).filter((i) => i.low).length
  const qty = (i) => i.site_quantity ?? i.total
  const pickItem = (i) => setMove((m) => ({ ...m, itemId: i.id }))

  return (
    <div className="flex flex-col gap-[28px]">
      <NavTabs tabs={inventoryTabs(t)} label={t('ops.tabs.inventory')} />
      <KpiStrip
        items={[
          { label: t('ops.items.count'), value: items === undefined ? '—' : formatNumber(items.length), suffix: t('ops.items.nonFeed') },
          {
            label: t('ops.items.belowReorder'),
            value: items === undefined ? '—' : formatNumber(lowCount),
            valueTone: lowCount ? 'warn' : undefined,
          },
          { label: t('ops.items.categories'), value: items === undefined ? '—' : formatNumber(categoriesPresent.length) },
        ]}
      />

      <div className="flex flex-col gap-[20px] xl:flex-row xl:items-start">
        <Table
          className="min-w-0 xl:w-[700px] xl:shrink-0"
          title={t('ops.tab.items')}
          tabs={[{ value: 'all', label: t('ops.common.all') }, ...categoriesPresent.map(([k]) => ({ value: k, label: t(`ops.items.cat.${k}`) }))]}
          tab={category}
          onTabChange={setCategory}
          columns={[
            {
              key: 'name',
              header: t('ops.items.colItem'),
              render: (i) => <span className={i.id === move.itemId ? 'font-medium text-pearl-cyan' : ''}>{i.name}</span>,
              sub: (i) =>
                [t(`ops.items.cat.${i.category}`), i.minimum_stock > 0 ? t('ops.items.reorderAt', { qty: fmt(i.minimum_stock), unit: i.unit }) : null, i.supplier_name]
                  .filter(Boolean)
                  .join(' · '),
            },
            {
              key: 'onHand',
              header: t('ops.col.onHand'),
              width: 140,
              align: 'right',
              render: (i) => `${fmt(qty(i))} ${i.unit}`,
              sub: (i) => (i.site_quantity != null ? t('ops.items.allSites', { qty: fmt(i.total) }) : null),
            },
            {
              key: 'status',
              header: t('ops.col.status'),
              width: 110,
              render: (i) => <Pill tone={i.low ? 'red' : 'green'}>{i.low ? t('ops.stock.low') : t('ops.stock.ok')}</Pill>,
            },
          ]}
          rows={shownItems}
          onRowClick={pickItem}
          empty={items === undefined ? t('ops.common.loading') : t('ops.items.empty')}
        />

        <Panel
          className="xl:grow xl:basis-0"
          title={selected ? selected.name : t('ops.items.moveStock')}
          titleId="it-detail"
          meta={selected ? t(`ops.items.cat.${selected.category}`) : t('ops.items.atSite')}
        >
          {selected && (
            <div className="mb-4 flex flex-col">
              {selected.levels.map((l) => (
                <ListRow
                  key={l.location_id || l.location_name}
                  dot={selected.low ? 'warn' : 'good'}
                  dotLabel={selected.low ? t('ops.stock.low') : t('ops.stock.ok')}
                  title={l.location_name}
                  value={`${fmt(l.quantity)} ${selected.unit}`}
                />
              ))}
            </div>
          )}
          <div className="mb-4 overflow-x-auto">
            <Segmented options={modes} value={mode} onChange={setMode} label={t('ops.items.moveStock')} />
          </div>
          <form onSubmit={submitMove} className="space-y-4">
            <Field label={t('ops.col.item')} htmlFor="mv-item" required>
              <Select id="mv-item" value={move.itemId} onChange={setM('itemId')} required>
                <option value="">{t('ops.common.select')}</option>
                {(items || []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({fmt(qty(i))} {i.unit})
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={`${mode === 'adjust' ? t('ops.items.change') : t('ops.items.quantity')}${selected ? ` (${selected.unit})` : ''}`}
              htmlFor="mv-qty"
              required
            >
              <Input id="mv-qty" type="number" inputMode="decimal" step="any" value={move.quantity} onChange={setM('quantity')} required />
            </Field>
            {mode === 'issue' && (
              <Field label={t('ops.items.cage')} htmlFor="mv-cage">
                <Select id="mv-cage" value={move.cageId} onChange={setM('cageId')}>
                  <option value="">{t('ops.items.notForCage')}</option>
                  {(cages || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {mode === 'receive' && (
              <Field label={t('ops.items.unitCost')} htmlFor="mv-cost">
                <Input id="mv-cost" type="number" inputMode="decimal" step="any" min="0" value={move.unitCost} onChange={setM('unitCost')} />
              </Field>
            )}
            {mode === 'adjust' && (
              <Field label={t('ops.items.reason')} htmlFor="mv-reason" required>
                <Input id="mv-reason" value={move.reason} onChange={setM('reason')} placeholder={t('ops.items.reasonHint')} required />
              </Field>
            )}
            {mode === 'transfer' && (
              <Field label={t('ops.items.toSite')} htmlFor="mv-to" required>
                <Select id="mv-to" value={move.toLocationId} onChange={setM('toLocationId')} required>
                  <option value="">{t('ops.common.select')}</option>
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
              <Field label={t('ops.col.date')} htmlFor="mv-date">
                <Input id="mv-date" type="date" value={move.date} onChange={setM('date')} />
              </Field>
            )}
            <GradientButton type="submit" variant="solid" block disabled={busy}>
              {busy ? t('ops.common.saving') : t('ops.common.save')}
            </GradientButton>
          </form>
        </Panel>
      </div>

      <div className="flex flex-col gap-[20px] xl:flex-row xl:items-start">
        <Table
          className="min-w-0 xl:w-[700px] xl:shrink-0"
          title={t('ops.feed.recentMovements')}
          columns={[
            { key: 'date', header: t('ops.col.date'), width: 110, render: (m) => <span className="text-muted">{shortDate(m.date)}</span> },
            {
              key: 'type',
              header: t('ops.col.type'),
              width: 140,
              render: (m) => <Pill tone={MOVE_TONE[m.type] || 'neutral'}>{MOVE_TONE[m.type] ? t(`ops.items.move.${m.type}`) : m.type}</Pill>,
            },
            {
              key: 'item',
              header: t('ops.col.item'),
              render: (m) => m.item_name,
              sub: (m) => [m.location_name, m.cage_name ? `→ ${m.cage_name}` : null, m.notes].filter(Boolean).join(' · '),
            },
            {
              key: 'qty',
              header: t('ops.col.qty'),
              width: 110,
              align: 'right',
              render: (m) => (
                <span className={m.quantity < 0 ? 'text-alert' : 'text-good'}>
                  {m.quantity > 0 ? '+' : ''}
                  {fmt(m.quantity)}
                </span>
              ),
            },
          ]}
          rows={movements || []}
          empty={movements === undefined ? t('ops.common.loading') : t('ops.feed.noMovements')}
        />

        <Panel className="xl:grow xl:basis-0" title={t('ops.items.addItem')} titleId="it-add">
          <form onSubmit={submitItem} className="space-y-4 border-t border-line pt-4">
            <Field label={t('ops.col.name')} htmlFor="it-name" required>
              <Input id="it-name" value={newItem.name} onChange={setN('name')} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('ops.items.category')} htmlFor="it-cat">
                <Select id="it-cat" value={newItem.category} onChange={setN('category')}>
                  {CATEGORIES.map(([k]) => (
                    <option key={k} value={k}>
                      {t(`ops.items.cat.${k}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('ops.items.unit')} htmlFor="it-unit" required>
                <Input id="it-unit" value={newItem.unit} onChange={setN('unit')} placeholder="L, kg, pcs" required />
              </Field>
            </div>
            <Field label={t('ops.items.reorderLevel')} htmlFor="it-min" hint={t('ops.items.reorderHint')}>
              <Input id="it-min" type="number" inputMode="decimal" min="0" step="any" value={newItem.minimumStock} onChange={setN('minimumStock')} />
            </Field>
            <Field label={t('ops.col.supplier')} htmlFor="it-sup">
              <Select id="it-sup" value={newItem.supplierId} onChange={setN('supplierId')}>
                <option value="">{t('ops.common.none')}</option>
                {(suppliers || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <GhostButton type="submit" className="w-full justify-center" disabled={busy}>
              {t('ops.items.addItem')}
            </GhostButton>
          </form>
        </Panel>
      </div>
    </div>
  )
}
