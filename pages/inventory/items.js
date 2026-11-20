import { useEffect, useMemo, useRef, useState } from 'react'
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
import { Panel } from '../../components/ui/Panel'
import InventoryActions from '../../components/inventory/InventoryActions'
import { inventoryTabs } from '../../lib/sectionTabs'
import { shortDate } from '../../lib/feedOverview'
import { useT } from '../../lib/i18n/context'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { useToast } from '../../components/Toast'
import { addDays, formatNumber, localToday } from '../../lib/format'
import { useCurrency } from '../../hooks/useCurrency'
import { usePermission } from '../../hooks/usePermission'

export default function InventoryItemsPage() {
  const t = useT()
  const { activeLocation } = useLocation()
  // Paper 51: "Feed & inventory · Akosombo store" (the header site).
  const eyebrow = activeLocation?.name ? t('ops.feed.eyebrowAt', { site: activeLocation.name }) : t('ops.items.eyebrow')
  return (
    <ProtectedRoute>
      <Layout title={t('ops.inventory.title')} eyebrow={eyebrow} actions={<InventoryActions />}>
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

/**
 * Paper 51 light theme draws two things in other roles than dark: the KPI
 * suffix in the body text colour, and the highlighted row in text on a
 * #B9D3F5 ring (dark: sky #6AA8F5 text on #1F3E6E).
 */
const LIGHT = '[html[data-theme=light]_&]'

/** Paper 51 KPI value: 26/32 figure with a 13/16 regular suffix. */
function KpiValue({ value, suffix }) {
  return (
    <>
      {value}
      {suffix != null && (
        <span className={`text-[13px] font-normal leading-4 text-muted ${LIGHT}:text-text`}> {suffix}</span>
      )}
    </>
  )
}

/** "−0.8%": signed percentage with a true minus. */
const signedPct = (n) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(n).toFixed(1)}%`

/** Stock status pill (Paper 51 "Cover · status"): red when low, green when OK, with days of cover when known. */
function StatusPill({ low, days, t }) {
  const label = low ? t('ops.stock.low') : t('ops.stock.ok')
  return (
    <Pill tone={low ? 'red' : 'green'}>
      {days != null ? t('ops.items.statusDays', { status: label, count: days }) : label}
    </Pill>
  )
}

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
  const lots = useQuery(api.inventory.listLots, user ? locationArgs : 'skip')
  const counts = useQuery(api.stockCounts.listCounts, user ? locationArgs : 'skip')
  const { symbol } = useCurrency()
  const money = (n) => `${symbol} ${formatNumber(Math.round(n))}`
  const formRef = useRef(null)

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
  const [search, setSearch] = useState('')

  const selected = useMemo(
    () => (items || []).find((i) => i.id === move.itemId) || null,
    [items, move.itemId],
  )
  // Paper 51 always shows one item's detail: open the first item once loaded.
  const firstId = items?.[0]?.id
  useEffect(() => {
    if (firstId) setMove((m) => (m.itemId ? m : { ...m, itemId: firstId }))
  }, [firstId])

  // The selected item's issues over the last 14 days: average daily use and days of cover.
  const itemMoves = useQuery(api.inventoryItems.listMovements, user && selected ? { itemId: selected.id, limit: 500 } : 'skip')
  const avgUse = useMemo(() => {
    if (!itemMoves) return null
    const from = addDays(localToday(), -14)
    const used = itemMoves
      .filter((m) => m.type === 'issue' && m.date > from)
      .reduce((sum, m) => sum + Math.abs(m.quantity), 0)
    return used / 14
  }, [itemMoves])
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
  const needle = search.trim().toLowerCase()
  const shownItems = (items || []).filter(
    (i) => (category === 'all' || i.category === category) && (!needle || i.name.toLowerCase().includes(needle)),
  )
  const lowCount = (items || []).filter((i) => i.low).length
  const qty = (i) => i.site_quantity ?? i.total
  const value = (i) => (i.unit_cost != null ? qty(i) * i.unit_cost : null)
  const pickItem = (i) => setMove((m) => ({ ...m, itemId: i.id }))

  // KPIs (Paper 51): stock value, below reorder, lots expiring in 30 days, last posted count.
  const costed = (items || []).filter((i) => i.unit_cost != null)
  const stockValue = costed.reduce((sum, i) => sum + value(i), 0)
  const now = localToday()
  const soonLots = (lots || []).filter((l) => l.expiry_date && l.expiry_date >= now && l.expiry_date <= addDays(now, 30))
  const soonKg = soonLots.reduce((sum, l) => sum + Number(l.quantity_kg || 0), 0)
  const lastCount = (counts || [])
    .filter((c) => c.status === 'posted')
    .reduce((best, c) => (!best || c.count_date > best.count_date ? c : best), null)
  const countLines = (lastCount?.lines || []).filter((l) => l.difference != null)
  const expected = countLines.reduce((sum, l) => sum + l.expected, 0)
  const variance = expected ? (countLines.reduce((sum, l) => sum + l.difference, 0) / expected) * 100 : null

  const coverDays = selected && avgUse ? Math.floor(qty(selected) / avgUse) : null
  const startMove = (next) => {
    setMode(next)
    formRef.current?.querySelector('#mv-qty')?.focus()
  }

  return (
    <div className="flex flex-col gap-[28px]">
      <NavTabs tabs={inventoryTabs(t)} label={t('ops.tabs.inventory')} />
      <KpiStrip
        items={[
          {
            label: t('ops.stock.value'),
            value:
              items === undefined ? '—' : (
                <KpiValue value={costed.length ? money(stockValue) : '—'} suffix={t('ops.feed.items', { count: items.length })} />
              ),
          },
          { label: t('ops.items.belowReorder'), value: items === undefined ? '—' : formatNumber(lowCount) },
          {
            label: t('ops.lots.expiring30'),
            value:
              lots === undefined ? '—' : (
                <KpiValue value={t('ops.items.lotCount', { count: soonLots.length })} suffix={soonLots.length ? `${formatNumber(soonKg)} kg` : null} />
              ),
          },
          {
            label: t('ops.items.lastCount'),
            value:
              counts === undefined || !lastCount ? '—' : (
                <KpiValue
                  value={shortDate(lastCount.count_date)}
                  suffix={variance != null ? t('ops.items.variance', { pct: signedPct(variance) }) : null}
                />
              ),
          },
        ]}
      />

      <div className="flex flex-col gap-[20px] xl:flex-row xl:items-start">
        <Table
          className="min-w-0 xl:w-[700px] xl:shrink-0"
          title={t('ops.tab.items')}
          tabs={[{ value: 'all', label: t('ops.common.all') }, ...categoriesPresent.map(([k]) => ({ value: k, label: t(`ops.items.cat.${k}`) }))]}
          tab={category}
          onTabChange={setCategory}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('ops.items.search')}
          columns={[
            {
              key: 'name',
              header: t('ops.items.colItem'),
              render: (i) => <span className={i.id === move.itemId ? 'font-medium' : ''}>{i.name}</span>,
              sub: (i) =>
                [i.minimum_stock > 0 ? t('ops.items.reorderAt', { qty: fmt(i.minimum_stock), unit: i.unit }) : null, t(`ops.items.cat.${i.category}`), i.supplier_name]
                  .filter(Boolean)
                  .join(' · '),
            },
            {
              key: 'onHand',
              header: t('ops.col.onHand'),
              width: 104,
              align: 'right',
              render: (i) => <span className="whitespace-nowrap">{`${fmt(qty(i))} ${i.unit}`}</span>,
              sub: (i) => (i.site_quantity != null ? t('ops.items.allSites', { qty: fmt(i.total) }) : null),
            },
            {
              key: 'value',
              header: t('ops.items.colValue'),
              width: 134,
              align: 'right',
              render: (i) => <span className="whitespace-nowrap">{value(i) == null ? '—' : money(value(i))}</span>,
            },
            {
              key: 'status',
              header: t('ops.items.colStatus'),
              width: 166,
              render: (i) => <StatusPill low={i.low} t={t} days={i.id === selected?.id ? coverDays : null} />,
            },
          ]}
          rows={shownItems}
          onRowClick={pickItem}
          empty={items === undefined ? t('ops.common.loading') : t('ops.items.empty')}
        />

        <Panel className="xl:grow xl:basis-0" bodyClassName="gap-1">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-3 pb-[14px]">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="text-xs leading-4 text-muted">
                    {t(`ops.items.cat.${selected.category}`)} · {t('ops.items.siteCount', { count: selected.levels.length })}
                  </div>
                  <h2 id="it-detail" className="text-[20px] font-semibold leading-6 text-text">
                    {selected.name}
                  </h2>
                </div>
                <span className="shrink-0">
                  <StatusPill low={selected.low} days={coverDays} t={t} />
                </span>
              </div>
              <div className="flex justify-between pb-[10px] pt-1 text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">
                <span>{t('ops.items.bySite')}</span>
                <span>{t('ops.col.onHand')}</span>
              </div>
              {selected.levels.map((l, idx) => {
                const here = Boolean(activeLocationId) && l.location_id === activeLocationId
                const last = idx === selected.levels.length - 1
                return (
                  <div
                    key={l.location_id || l.location_name}
                    className={`flex items-center gap-3 px-[14px] py-3 ${
                      here
                        ? `rounded-[14px] border border-[#1F3E6E] bg-[#9FE3E60D] ${LIGHT}:border-[#B9D3F5]`
                        : last
                          ? ''
                          : 'border-b border-line'
                    }`}
                  >
                    <div className={`min-w-0 grow basis-0 text-[14px] leading-[18px] ${here ? `text-sky-ink ${LIGHT}:text-text` : 'text-text'}`}>
                      {l.location_name}
                      {here && <span className="text-xs"> · {t('ops.items.thisSite')}</span>}
                    </div>
                    <div className="min-w-[76px] shrink-0 whitespace-nowrap text-right text-[13px] leading-4 text-text">
                      {fmt(l.quantity)} {selected.unit}
                    </div>
                  </div>
                )
              })}
              <div className="flex flex-col gap-2 border-t border-line pt-3 text-[13px] leading-4">
                <div className="flex justify-between gap-3">
                  <span className="text-muted">{t('ops.items.avgUse')}</span>
                  <span className="text-text">
                    {avgUse == null ? '—' : t('ops.items.perDay', { qty: fmt(avgUse), unit: selected.unit })}
                  </span>
                </div>
                {selected.minimum_stock > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">{t('ops.items.reorderLevel')}</span>
                    <span className="text-text">
                      {fmt(selected.minimum_stock)} {selected.unit}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex gap-[10px] pt-[14px]">
                <button
                  type="button"
                  onClick={() => startMove('issue')}
                  className="whitespace-pre rounded-pill bg-button px-[18px] py-[10px] text-[13px] font-medium leading-4 text-button-text hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                >
                  {t('ops.items.issueToCages')}
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => startMove('adjust')}
                    className="whitespace-pre rounded-pill border border-line-strong px-[18px] py-[10px] text-[13px] leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                  >
                    {t('ops.items.mode.adjust')}
                  </button>
                )}
              </div>
            </>
          ) : (
            <h2 id="it-detail" className="pb-[14px] text-[20px] font-semibold leading-6 text-text">
              {t('ops.items.moveStock')}
            </h2>
          )}
          <div className="mt-[14px] border-t border-line pt-[14px]">
            <div className="mb-4 overflow-x-auto">
              <Segmented options={modes} value={mode} onChange={setMode} label={t('ops.items.moveStock')} />
            </div>
            <form ref={formRef} onSubmit={submitMove} className="space-y-4">
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
          </div>
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
