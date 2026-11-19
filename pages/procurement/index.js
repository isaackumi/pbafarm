import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Plus, UserRound } from 'lucide-react'
import {
  Field,
  GhostButton,
  GradientButton,
  Input,
  KpiStrip,
  Pill,
  Select,
} from '../../components/ui'
import { Panel, ListRow } from '../../components/ui/Panel'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { useToast } from '../../components/Toast'
import { useCurrency } from '../../hooks/useCurrency'
import { formatDate, localToday } from '../../lib/format'
import { formatMass, shortDate } from '../../lib/feedOverview'
import { lineKg, summarizeProcurement, supplierSpend } from '../../lib/procurementSummary'
import { useLocale, useT } from '../../lib/i18n/context'
import { usePermission } from '../../hooks/usePermission'

export default function ProcurementPage() {
  return (
    <ProtectedRoute>
      <PurchaseOrders />
    </ProtectedRoute>
  )
}

const COLUMNS = ['draft', 'ordered', 'received', 'cancelled']
const STATUS_TONE = { draft: 'neutral', ordered: 'cyan', received: 'green', cancelled: 'red' }
// Closed columns show only the latest few cards; the count shows the total.
const CLOSED_LIMIT = 4

const today_ = () => localToday()
const blankLine = () => ({ feedTypeId: '', quantityKg: '', pricePerKg: '' })

function PurchaseOrders() {
  const t = useT()
  const { formatLocale } = useLocale()
  const { user } = useAuth()
  const isAdmin = usePermission('inventory.purchase.correct')
  const canRecord = usePermission('inventory.purchase.record')
  const { activeLocationId } = useLocation()
  const { showToast } = useToast()
  const { formatCurrency } = useCurrency()

  const [selectedId, setSelectedId] = useState(null)
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
      showToast('error', err.message || t('ops.po.failed'))
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
        const ft = (feedTypes || []).find((f) => f.id === value)
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
      t('ops.po.draftSaved'),
    )
    if (ok) {
      setForm({ supplierId: '', expectedDate: '', notes: '', lines: [blankLine()] })
      setShowForm(false)
    }
  }

  const startReceive = (po) =>
    setReceiving({
      id: po.id,
      receivedDate: today_(),
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
      t('ops.po.receivedToast'),
    )
    if (ok) setReceiving(null)
  }

  const today = today_()
  const summary = summarizeProcurement(orders, today)
  const suppliersBySpend = supplierSpend(orders).slice(0, 5)
  const byStatus = Object.fromEntries(COLUMNS.map((c) => [c, (orders || []).filter((po) => po.status === c)]))
  const selected =
    (orders || []).find((po) => po.id === selectedId) ||
    byStatus.ordered[0] ||
    byStatus.draft[0] ||
    (orders || [])[0] ||
    null
  const monthLabel = new Date(`${today}T12:00:00Z`).toLocaleString(formatLocale, { month: 'short', timeZone: 'UTC' })
  const cardLine = (po) => {
    const first = po.lines[0]
    const name = first?.feed_type_name || '—'
    const more = po.lines.length > 1 ? ` +${po.lines.length - 1}` : ''
    return `${name}${more} · ${formatMass(lineKg(po))}`
  }

  return (
    <Layout
      title={t('ops.po.title')}
      eyebrow={t('ops.po.eyebrow')}
      actions={
        <>
          {canRecord && (
            <GradientButton icon={Plus} onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>
              {showForm ? t('ops.po.closeForm') : t('ops.po.newPo')}
            </GradientButton>
          )}
          <GradientButton reverse icon={UserRound} href="/feed-suppliers">
            {t('ops.po.suppliers')}
          </GradientButton>
        </>
      }
    >
      <div className="flex flex-col gap-[28px]">
        <KpiStrip
          items={[
            { label: t('ops.po.open'), value: formatNumberSafe(summary.openCount, orders), suffix: orders ? formatCurrency(summary.openValue) : undefined },
            {
              label: t('ops.po.arriving7d'),
              value: formatNumberSafe(summary.arrivingCount, orders),
              suffix: orders ? t('ops.po.feedMass', { mass: formatMass(summary.arrivingKg) }) : undefined,
            },
            { label: t('ops.po.spendMonth', { month: monthLabel }), value: orders ? formatCurrency(summary.spendMonth) : '—' },
            {
              label: t('ops.po.onTime'),
              value: summary.onTimePct == null ? '—' : `${summary.onTimePct}%`,
              suffix: summary.onTimePct == null ? undefined : t('ops.po.last90d'),
            },
          ]}
        />

        {showForm && canRecord && (
          <Panel title={t('ops.po.newPo')} meta={t('ops.po.deliveredHint')}>
            <form onSubmit={submit} className="flex flex-col gap-4 pt-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={t('ops.col.supplier')} htmlFor="po-sup" required>
                  <Select
                    id="po-sup"
                    value={form.supplierId}
                    onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
                    required
                  >
                    <option value="">{t('ops.common.select')}</option>
                    {(suppliers || []).map((sup) => (
                      <option key={sup.id} value={sup.id}>
                        {sup.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('ops.po.expected')} htmlFor="po-exp">
                  <Input
                    id="po-exp"
                    type="date"
                    value={form.expectedDate}
                    onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))}
                  />
                </Field>
                <Field label={t('ops.po.notes')} htmlFor="po-notes">
                  <Input
                    id="po-notes"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </Field>
              </div>
              <div className="flex flex-col gap-3">
                {form.lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                    <Field label={i === 0 ? t('ops.po.feed') : undefined} className="col-span-2 sm:col-span-1">
                      <Select aria-label={t('ops.po.feed')} value={l.feedTypeId} onChange={setLine(i, 'feedTypeId')} required={i === 0}>
                        <option value="">{t('ops.common.select')}</option>
                        {(feedTypes || []).map((ft) => (
                          <option key={ft.id} value={ft.id}>
                            {ft.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={i === 0 ? t('ops.col.kg') : undefined}>
                      <Input aria-label={t('ops.col.kg')} type="number" inputMode="decimal" min="0" step="any" value={l.quantityKg} onChange={setLine(i, 'quantityKg')} />
                    </Field>
                    <Field label={i === 0 ? t('ops.col.pricePerKg') : undefined}>
                      <Input aria-label={t('ops.col.pricePerKg')} type="number" inputMode="decimal" min="0" step="any" value={l.pricePerKg} onChange={setLine(i, 'pricePerKg')} />
                    </Field>
                    <GhostButton
                      size="sm"
                      className="col-span-2 sm:col-span-1"
                      disabled={form.lines.length === 1}
                      onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}
                    >
                      {t('ops.po.removeLine')}
                    </GhostButton>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-[10px]">
                <GradientButton type="submit" variant="solid" size="sm" disabled={busy}>
                  {t('ops.po.saveDraft')}
                </GradientButton>
                <GhostButton size="sm" icon={Plus} onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}>
                  {t('ops.po.addLine')}
                </GhostButton>
              </div>
            </form>
          </Panel>
        )}

        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const all = byStatus[col]
            const cards = col === 'received' || col === 'cancelled' ? all.slice(0, CLOSED_LIMIT) : all
            return (
              <section
                key={col}
                aria-label={t(`ops.po.status.${col}`)}
                className="flex flex-col gap-[10px] rounded-card border border-line bg-bg p-4"
              >
                <div className="flex items-center justify-between px-1 pb-[6px] pt-[2px]">
                  <Pill tone={STATUS_TONE[col]}>{t(`ops.po.status.${col}`)}</Pill>
                  <span className="text-[13px] leading-4 text-muted">{orders === undefined ? '—' : all.length}</span>
                </div>
                {cards.length === 0 ? (
                  <p className="px-1 py-3 text-[13px] leading-5 text-faint">{orders === undefined ? t('ops.common.loading') : t('ops.po.emptyColumn')}</p>
                ) : (
                  cards.map((po) => {
                    const active = selected?.id === po.id
                    return (
                      <button
                        key={po.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setSelectedId(po.id)
                          if (receiving && receiving.id !== po.id) setReceiving(null)
                        }}
                        className={`flex flex-col gap-[6px] rounded-[14px] border bg-surface px-4 py-[14px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                          active ? 'border-pearl-cyan' : 'border-line hover:border-line-strong'
                        }`}
                      >
                        <span className="text-xs leading-4 text-muted">{po.po_number}</span>
                        <span className="text-[14px] font-medium leading-[18px] text-text">{cardLine(po)}</span>
                        <span className="text-[13px] leading-4 text-muted">
                          {formatCurrency(po.status === 'received' ? po.received_value : po.ordered_value)}
                        </span>
                      </button>
                    )
                  })
                )}
              </section>
            )
          })}
        </div>

        <div className="grid grid-cols-1 items-start gap-[20px] xl:grid-cols-[minmax(0,700px)_minmax(0,1fr)]">
          {selected ? (
            <section
              aria-labelledby="po-detail-title"
              className="flex min-w-0 flex-col gap-1 rounded-card border border-line bg-surface px-5 py-6 shadow-[var(--shadow-card)] sm:px-[26px]"
            >
              <div className="flex items-start justify-between gap-3 pb-[14px]">
                <div className="flex flex-col gap-1">
                  <p className="text-xs leading-4 text-muted">
                    {[
                      selected.po_number,
                      t('ops.po.createdOn', { date: shortDate(selected.created_at) }),
                      selected.expected_date ? t('ops.po.eta', { date: shortDate(selected.expected_date) }) : null,
                      selected.received_date ? t('ops.po.receivedOn', { date: shortDate(selected.received_date) }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <h2 id="po-detail-title" className="text-[20px] font-semibold leading-6 text-text">
                    {selected.supplier_name || '—'}
                  </h2>
                </div>
                <Pill tone={STATUS_TONE[selected.status]}>{t(`ops.po.status.${selected.status}`)}</Pill>
              </div>
              {selected.lines.map((l, i) => (
                <div key={i} className="flex justify-between gap-3 border-t border-line py-[11px] text-[14px] leading-[18px]">
                  <span className="text-muted">
                    {t('ops.po.lineSummary', {
                      name: l.feed_type_name || '—',
                      mass: formatMass(l.received_kg ?? l.quantity_kg),
                      price: formatCurrency(l.received_price_per_kg ?? l.price_per_kg),
                    })}
                  </span>
                  <span className="text-text">
                    {formatCurrency((l.received_kg ?? l.quantity_kg) * (l.received_price_per_kg ?? l.price_per_kg))}
                  </span>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-line py-[11px] text-[14px] leading-[18px]">
                <span className="text-muted">{t('ops.po.deliveryTo')}</span>
                <span className="text-text">{selected.location_name || t('ops.po.siteOnReceipt')}</span>
              </div>
              {selected.notes ? (
                <div className="flex justify-between gap-3 border-t border-line py-[11px] text-[14px] leading-[18px]">
                  <span className="text-muted">{t('ops.po.notes')}</span>
                  <span className="text-right text-text">{selected.notes}</span>
                </div>
              ) : null}

              {receiving?.id === selected.id ? (
                <div className="mt-2 flex flex-col gap-3 border-t border-line pt-4">
                  <Field label={t('ops.po.receivedDate')} htmlFor={`rv-date-${selected.id}`} className="sm:w-48">
                    <Input
                      id={`rv-date-${selected.id}`}
                      type="date"
                      value={receiving.receivedDate}
                      onChange={(e) => setReceiving((r) => ({ ...r, receivedDate: e.target.value }))}
                    />
                  </Field>
                  {selected.lines.map((l, i) => (
                    <div key={i} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-5">
                      <p className="col-span-2 self-center text-[13px] leading-5 font-medium text-text sm:col-span-1">{l.feed_type_name}</p>
                      <Field label={t('ops.po.kgReceived')}>
                        <Input type="number" inputMode="decimal" min="0" step="any" value={receiving.lines[i].receivedKg} onChange={setRecv(i, 'receivedKg')} />
                      </Field>
                      <Field label={t('ops.col.pricePerKg')}>
                        <Input type="number" inputMode="decimal" min="0" step="any" value={receiving.lines[i].pricePerKg} onChange={setRecv(i, 'pricePerKg')} />
                      </Field>
                      <Field label={t('ops.lots.batch')}>
                        <Input value={receiving.lines[i].batchNumber} onChange={setRecv(i, 'batchNumber')} />
                      </Field>
                      <Field label={t('ops.lots.expires')}>
                        <Input type="date" value={receiving.lines[i].expiryDate} onChange={setRecv(i, 'expiryDate')} />
                      </Field>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-[10px] pt-2">
                    <GradientButton variant="solid" size="sm" disabled={busy} onClick={submitReceive}>
                      {t('ops.po.receiveIntoStock')}
                    </GradientButton>
                    <GhostButton size="sm" onClick={() => setReceiving(null)}>
                      {t('ops.po.back')}
                    </GhostButton>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-[10px] pt-4">
                  {canRecord && selected.status === 'ordered' && (
                    <GradientButton variant="solid" size="sm" onClick={() => startReceive(selected)}>
                      {t('ops.po.receiveGoods')}
                    </GradientButton>
                  )}
                  {isAdmin && selected.status === 'draft' && (
                    <GradientButton
                      variant="solid"
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => markOrdered({ id: selected.id }), t('ops.po.orderedToast'))}
                    >
                      {t('ops.po.placeOrder')}
                    </GradientButton>
                  )}
                  {isAdmin && (selected.status === 'draft' || selected.status === 'ordered') && (
                    <GhostButton
                      size="sm"
                      tone="danger"
                      disabled={busy}
                      onClick={() => {
                        const reason = typeof window !== 'undefined' ? window.prompt(t('ops.po.cancelReason')) : ''
                        if (reason === null) return
                        run(() => cancelPo({ id: selected.id, ...(reason ? { reason } : {}) }), t('ops.po.cancelledToast'))
                      }}
                    >
                      {t('ops.po.cancel')}
                    </GhostButton>
                  )}
                </div>
              )}
            </section>
          ) : (
            <Panel title={t('ops.po.detail')}>
              <p className="py-3 text-[13px] leading-5 text-muted">{orders === undefined ? t('ops.common.loading') : t('ops.po.empty')}</p>
            </Panel>
          )}

          <Panel title={t('ops.po.suppliers')} action={{ label: t('ops.po.allSuppliers'), href: '/feed-suppliers' }}>
            {suppliersBySpend.length === 0 ? (
              <p className="py-3 text-[13px] leading-5 text-muted">{t('ops.po.noSpend')}</p>
            ) : (
              suppliersBySpend.map((row) => (
                <ListRow
                  key={row.name}
                  title={row.name}
                  sub={[
                    t('ops.po.orders', { count: row.count }),
                    row.timed ? t('ops.po.onTimeShare', { pct: Math.round((row.onTime / row.timed) * 100) }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  value={formatCurrency(row.spend)}
                />
              ))
            )}
          </Panel>
        </div>
      </div>
    </Layout>
  )
}

function formatNumberSafe(n, ready) {
  return ready === undefined ? '—' : String(n)
}
