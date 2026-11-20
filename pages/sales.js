import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { ArrowLeft, Plus, UserPlus } from 'lucide-react'
import {
  Button,
  FormCard,
  FormSection,
  FormActions,
  Field,
  GhostButton,
  GradientButton,
  Input,
  KpiStrip,
  Pill,
  Select,
  Table,
  Textarea,
} from '../components/ui'
import NavTabs from '../components/ui/NavTabs'
import { Panel, ListRow } from '../components/ui/Panel'
import { financeTabs } from '../lib/sectionTabs'
import { shortDate } from '../lib/feedOverview'
import { paperMoney } from '../lib/financeFormat'
import { prevMonth, salePill, summarizeSales, topCustomers } from '../lib/salesSummary'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useToast } from '../components/Toast'
import { useCurrency } from '../hooks/useCurrency'
import LocationMetaField from '../components/LocationMetaField'
import { formatDate, formatNumber, localToday } from '../lib/format'
import { usePermission } from '../hooks/usePermission'
import { errorCode, errorMessage } from '../lib/errorMessage'
import { useLocale, useT } from '../lib/i18n/context'
import SaleDetailPanel from '../components/sales/SaleDetailPanel'
import ReceivablesCard from '../components/sales/ReceivablesCard'
import CustomersPanel from '../components/sales/CustomersPanel'

export default function SalesPage() {
  return (
    <ProtectedRoute>
      <Sales />
    </ProtectedRoute>
  )
}

const SALE_TABS = ['all', 'unpaid', 'overdue', 'walkin']

/** Paper 24 numbers: whole amounts without decimals, cents only when there are any. */
const places = (n) => (Number.isInteger(Number(n)) ? 0 : 2)
/** Paper 24 weight: "2,400 kg" (kilograms with thousands separators). */
const kg = (n) => `${formatNumber(Number(n) || 0, { decimals: 0 })} kg`

/** Paper 24 payment pill; "sky" (Invoiced) is border #1F3E6E with #6AA8F5 text. */
function SalePill({ pill, label }) {
  if (pill.tone === 'sky') {
    return (
      <Pill tone="neutral" className="!border-[#1F3E6E] !text-sky-ink">
        {label}
      </Pill>
    )
  }
  return <Pill tone={pill.tone}>{label}</Pill>
}

function Sales() {
  const { user } = useAuth()
  const isAdmin = usePermission('finance.sales.correct')
  const canRecord = usePermission('finance.sales.record')
  const { formatLocale } = useLocale()
  const { locationArgs, activeLocationId } = useLocation()
  const { showToast } = useToast()
  const { formatCurrency, currency } = useCurrency()
  const money = (n, opts) => paperMoney(n, currency, { decimals: places(n), ...opts })
  const num = (n) => formatNumber(Number(n) || 0, { decimals: places(n) })
  const t = useT()
  const [tab, setTab] = useState('sales')
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const harvests = useQuery(
    api.harvest.list,
    user ? locationArgs : 'skip',
  )
  const customers = useQuery(api.sales.listCustomers, user ? {} : 'skip')
  const sales = useQuery(
    api.sales.listSales,
    user ? locationArgs : 'skip',
  )
  const createSale = useMutation(api.sales.createSale)
  const createCustomer = useMutation(api.sales.createCustomer)
  const removeSale = useMutation(api.sales.removeSale)

  const [showForm, setShowForm] = useState(false)
  const [showCustomer, setShowCustomer] = useState(false)
  const [form, setForm] = useState({
    harvestId: '',
    customerId: '',
    customerName: '',
    saleDate: localToday(),
    weightKg: '',
    pricePerKg: '',
    paymentStatus: 'paid',
    notes: '',
  })
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    contactName: '',
  })
  const [saving, setSaving] = useState(false)
  const selectedSale = useMemo(
    () => (sales || []).find((s) => (s.id || s._id) === selectedId) || null,
    [sales, selectedId],
  )
  // Set when the server refuses a sale inside a withdrawal period (PROD-012).
  const [withdrawalBlock, setWithdrawalBlock] = useState(null)
  const [overrideReason, setOverrideReason] = useState('')

  const selectedHarvest = useMemo(
    () =>
      (harvests || []).find(
        (h) => (h.id || h._id) === form.harvestId,
      ) || null,
    [harvests, form.harvestId],
  )

  const today = localToday()
  const receivables = useQuery(
    api.invoices.listReceivables,
    user ? { asOf: today, locationId: activeLocationId || undefined } : 'skip',
  )
  const summary = summarizeSales(sales, receivables, today)
  const top = topCustomers(sales, today)
  const monthName = (month) => new Date(`${month}-15T12:00:00Z`).toLocaleString(formatLocale, { month: 'short', timeZone: 'UTC' })
  const monthLabel = monthName(summary.month)
  const prevMonthLabel = monthName(prevMonth(summary.month))
  const overdueDays = useMemo(
    () => new Map((receivables?.sales || []).filter((r) => r.days_overdue > 0).map((r) => [r.sale_id, r.days_overdue])),
    [receivables],
  )
  const dueDates = useMemo(() => new Map((receivables?.sales || []).map((r) => [r.sale_id, r.due_date])), [receivables])
  const visibleSales = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (sales || []).filter((sale) => {
      const id = sale.id || sale._id
      if (filter === 'unpaid' && !(Number(sale.balance) > 0)) return false
      if (filter === 'overdue' && !overdueDays.has(id)) return false
      if (filter === 'walkin' && sale.customer_id) return false
      if (!q) return true
      return [sale.customer_name, sale.cage_name, sale.invoice_number].some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [sales, filter, search, overdueDays])
  const focusSale = selectedSale || visibleSales[0] || null
  const focusDue = focusSale ? dueDates.get(focusSale.id || focusSale._id) : null

  const submitSale = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const weightKg = Number(form.weightKg)
      const pricePerKg = Number(form.pricePerKg)
      if (!(weightKg > 0)) throw new Error('Enter weight sold (kg)')
      if (!(pricePerKg >= 0)) throw new Error('Enter price per kg')

      const args = {
        saleDate: form.saleDate,
        weightKg,
        pricePerKg,
        paymentStatus: form.paymentStatus,
        notes: form.notes.trim() || undefined,
        locationId: activeLocationId || undefined,
        harvestId: form.harvestId || undefined,
        customerId: form.customerId || undefined,
        customerName: !form.customerId
          ? form.customerName.trim() || undefined
          : undefined,
        cageId: selectedHarvest?.cage_id || undefined,
        withdrawalOverrideReason:
          withdrawalBlock && overrideReason.trim() ? overrideReason.trim() : undefined,
      }
      if (!args.customerId && !args.customerName) {
        throw new Error('Select or enter a buyer')
      }

      await createSale(args)
      showToast('success', 'Sale recorded')
      setWithdrawalBlock(null)
      setOverrideReason('')
      setShowForm(false)
      setForm({
        harvestId: '',
        customerId: '',
        customerName: '',
        saleDate: localToday(),
        weightKg: '',
        pricePerKg: '',
        paymentStatus: 'paid',
        notes: '',
      })
    } catch (err) {
      if (errorCode(err) === 'WITHDRAWAL_ACTIVE') setWithdrawalBlock(errorMessage(err))
      showToast('error', errorMessage(err, 'Failed to record sale'))
    } finally {
      setSaving(false)
    }
  }

  const submitCustomer = async (e) => {
    e.preventDefault()
    if (!isAdmin) return
    setSaving(true)
    try {
      const id = await createCustomer({
        name: customerForm.name.trim(),
        phone: customerForm.phone.trim() || undefined,
        contactName: customerForm.contactName.trim() || undefined,
      })
      showToast('success', 'Customer created')
      setForm((p) => ({ ...p, customerId: id, customerName: '' }))
      setCustomerForm({ name: '', phone: '', contactName: '' })
      setShowCustomer(false)
    } catch (err) {
      showToast('error', err.message || 'Failed to create customer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout
      title={t('ops.sales.title')}
      eyebrow={t('ops.sales.eyebrow')}
      actions={
        <>
          {canRecord && (
            <GradientButton variant="lime" icon={Plus} onClick={() => setShowForm(true)}>
              {t('ops.sales.recordSale')}
            </GradientButton>
          )}
          {isAdmin && (
            <GradientButton ring="sky" icon={UserPlus} onClick={() => setShowCustomer(true)}>
              {t('ops.sales.newCustomer')}
            </GradientButton>
          )}
        </>
      }
    >
    <div data-tour="page-sales" className="flex flex-col gap-[28px]">
      <NavTabs tabs={financeTabs(t)} label={t('ops.tabs.finance')} />
      {tab === 'customers' ? (
        <>
          <div>
            <GhostButton size="sm" icon={ArrowLeft} onClick={() => setTab('sales')}>
              {t('ops.sales.backToSales')}
            </GhostButton>
          </div>
          <CustomersPanel canEdit={isAdmin} />
        </>
      ) : (
        <>
      <KpiStrip
        items={[
          {
            label: t('ops.sales.salesMonth', { month: monthLabel }),
            value: sales === undefined ? '—' : money(summary.total, { decimals: 0 }),
            suffix: summary.changePct == null ? undefined : t('ops.sales.vsPrev', { pct: `${summary.changePct > 0 ? '+' : summary.changePct < 0 ? '−' : ''}${Math.abs(summary.changePct)}`, month: prevMonthLabel }),
          },
          {
            label: t('ops.sales.collected'),
            value: sales === undefined ? '—' : money(summary.collected, { decimals: 0 }),
            suffix: summary.collectedPct == null ? undefined : `${summary.collectedPct}%`,
          },
          {
            label: t('ops.sales.outstanding'),
            value: summary.outstanding == null ? '—' : money(summary.outstanding, { decimals: 0 }),
            suffix: summary.outstanding == null ? undefined : t('ops.sales.openSales', { count: summary.outstandingCount }),
          },
          {
            label: t('ops.sales.overdue'),
            value: summary.outstanding == null ? '—' : money(summary.overdue, { decimals: 0 }),
            suffix: summary.overdue30Count ? t('ops.sales.over30', { count: summary.overdue30Count }) : undefined,
          },
        ]}
      />
      {showForm && (
        <FormCard className="mb-6">
          <form onSubmit={submitSale}>
            <FormSection title="New sale">
              <div className="mb-4">
                <LocationMetaField />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Harvest (optional)" htmlFor="sale-harvest">
                  <Select
                    id="sale-harvest"
                    value={form.harvestId}
                    onChange={(e) => {
                      const id = e.target.value
                      const h = (harvests || []).find(
                        (x) => (x.id || x._id) === id,
                      )
                      setForm((p) => ({
                        ...p,
                        harvestId: id,
                        weightKg:
                          p.weightKg ||
                          (h?.total_weight != null
                            ? String(h.total_weight)
                            : p.weightKg),
                      }))
                    }}
                  >
                    <option value="">No harvest link</option>
                    {(harvests || []).map((h) => (
                      <option key={h.id || h._id} value={h.id || h._id}>
                        {h.harvest_date} — {h.total_weight} kg
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Sale date" htmlFor="sale-date" required>
                  <Input
                    id="sale-date"
                    type="date"
                    value={form.saleDate}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, saleDate: e.target.value }))
                    }
                    required
                  />
                </Field>
                <Field label="Buyer" htmlFor="sale-customer">
                  <Select
                    id="sale-customer"
                    value={form.customerId}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        customerId: e.target.value,
                        customerName: '',
                      }))
                    }
                  >
                    <option value="">Select customer…</option>
                    {(customers || []).map((c) => (
                      <option key={c.id || c._id} value={c.id || c._id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  {isAdmin && (
                    <button
                      type="button"
                      className="mt-2 text-[13px] leading-5 font-semibold text-lagoon-800 underline-offset-2 hover:underline"
                      onClick={() => setShowCustomer(true)}
                    >
                      Add customer
                    </button>
                  )}
                </Field>
                {!form.customerId && (
                  <Field label="Or buyer name" htmlFor="sale-buyer-name">
                    <Input
                      id="sale-buyer-name"
                      value={form.customerName}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          customerName: e.target.value,
                        }))
                      }
                      placeholder="Walk-in / market"
                    />
                  </Field>
                )}
                <Field label="Weight (kg)" htmlFor="sale-kg" required>
                  <Input
                    id="sale-kg"
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="font-data"
                    value={form.weightKg}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, weightKg: e.target.value }))
                    }
                    required
                  />
                </Field>
                <Field label="Price per kg" htmlFor="sale-price" required>
                  <Input
                    id="sale-price"
                    type="number"
                    step="0.01"
                    min="0"
                    className="font-data"
                    value={form.pricePerKg}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, pricePerKg: e.target.value }))
                    }
                    required
                  />
                </Field>
                <Field label="Payment" htmlFor="sale-pay">
                  <Select
                    id="sale-pay"
                    value={form.paymentStatus}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        paymentStatus: e.target.value,
                      }))
                    }
                  >
                    <option value="paid">Paid</option>
                    <option value="partial">Partial</option>
                    <option value="pending">Pending</option>
                  </Select>
                </Field>
                {withdrawalBlock && (
                  <div
                    role="alert"
                    className="md:col-span-2 rounded-lg border border-signal/40 bg-signal/10 px-4 py-3 text-[13px] leading-5 text-chart-ink space-y-3"
                  >
                    <p>{withdrawalBlock}</p>
                    {isAdmin ? (
                      <Field label="Override reason" htmlFor="sale-withdrawal-reason" required>
                        <Textarea
                          id="sale-withdrawal-reason"
                          rows={2}
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          placeholder="Kept in the audit log"
                        />
                      </Field>
                    ) : (
                      <p className="text-muted">Ask an admin to record this sale.</p>
                    )}
                  </div>
                )}
                <Field label="Notes" htmlFor="sale-notes" className="md:col-span-2">
                  <Textarea
                    id="sale-notes"
                    rows={2}
                    value={form.notes}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, notes: e.target.value }))
                    }
                  />
                </Field>
              </div>
              {form.weightKg && form.pricePerKg && (
                <p className="mt-3 text-[13px] leading-5 text-muted">
                  Total:{' '}
                  <span className="font-data font-semibold text-chart-ink">
                    {formatCurrency(
                      Number(form.weightKg) * Number(form.pricePerKg),
                    )}
                  </span>
                </p>
              )}
            </FormSection>
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save sale'}
              </Button>
            </FormActions>
          </form>
        </FormCard>
      )}

      {showCustomer && isAdmin && (
        <FormCard className="mb-6">
          <form onSubmit={submitCustomer}>
            <FormSection title="New customer">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Name" htmlFor="cust-name" required>
                  <Input
                    id="cust-name"
                    value={customerForm.name}
                    onChange={(e) =>
                      setCustomerForm((p) => ({ ...p, name: e.target.value }))
                    }
                    required
                  />
                </Field>
                <Field label="Contact" htmlFor="cust-contact">
                  <Input
                    id="cust-contact"
                    value={customerForm.contactName}
                    onChange={(e) =>
                      setCustomerForm((p) => ({
                        ...p,
                        contactName: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Phone" htmlFor="cust-phone">
                  <Input
                    id="cust-phone"
                    value={customerForm.phone}
                    onChange={(e) =>
                      setCustomerForm((p) => ({ ...p, phone: e.target.value }))
                    }
                  />
                </Field>
              </div>
            </FormSection>
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowCustomer(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                Create customer
              </Button>
            </FormActions>
          </form>
        </FormCard>
      )}

      <div className="grid grid-cols-1 items-start gap-[20px] xl:grid-cols-[700px_minmax(0,1fr)]">
        <Table
          title={t('ops.sales.tableTitle')}
          tabs={SALE_TABS.map((k) => ({ value: k, label: t(`ops.sales.tab.${k}`) }))}
          tab={filter}
          onTabChange={setFilter}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('ops.sales.search')}
          onRowClick={(sale) => setSelectedId(sale.id || sale._id)}
          columns={[
            // Paper 24 lanes: date 60, weight 80, amount 110, paid 130 (+ the 24px gaps as cell padding).
            { key: 'date', header: t('ops.col.date'), width: 96, render: (sale) => shortDate(sale.sale_date) },
            {
              key: 'customer',
              header: t('ops.sales.customerLot'),
              render: (sale) => (
                <button
                  type="button"
                  aria-pressed={(sale.id || sale._id) === selectedId}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedId(sale.id || sale._id)
                  }}
                  className={`rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                    (sale.id || sale._id) === selectedId ? 'text-pearl-cyan' : 'text-text'
                  }`}
                >
                  {sale.customer_name || '—'}
                </button>
              ),
              sub: (sale) => [sale.invoice_number, sale.cage_name].filter(Boolean).join(' · ') || undefined,
            },
            {
              key: 'weight',
              header: t('ops.sales.weight'),
              width: 104,
              align: 'right',
              render: (sale) => (sale.unit_count != null ? t('ops.sales.units', { count: sale.unit_count }) : kg(sale.weight_kg)),
            },
            { key: 'amount', header: t('ops.sales.amount'), width: 134, align: 'right', render: (sale) => money(sale.total_amount) },
            {
              key: 'paid',
              header: t('ops.sales.paid'),
              width: 166,
              render: (sale) => {
                const pill = salePill(sale, overdueDays.get(sale.id || sale._id) || 0)
                return <SalePill pill={pill} label={t(`ops.sales.pill.${pill.key}`, { pct: pill.pct, days: pill.days })} />
              },
            },
          ]}
          rows={visibleSales}
          empty={sales === undefined ? t('ops.common.loading') : t('ops.sales.empty')}
        />

        <div className="flex min-w-0 flex-col gap-[20px]">
          {focusSale ? (
            <section
              aria-labelledby="sale-card-title"
              className="flex flex-col gap-1 rounded-card border border-line bg-surface px-5 py-6 shadow-[var(--shadow-card)] sm:px-[26px]"
            >
              <div className="flex items-start justify-between gap-3 pb-[14px]">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-xs leading-4 text-muted">{focusSale.invoice_number || formatDate(focusSale.sale_date)}</p>
                  <h2 id="sale-card-title" className="truncate text-[20px] font-semibold leading-6 text-text">
                    {focusSale.customer_name || '—'}
                  </h2>
                </div>
                {(() => {
                  // Paper 24: the card's pill drops the share ("Part paid"); the table shows it.
                  const pill = salePill(focusSale, overdueDays.get(focusSale.id || focusSale._id) || 0)
                  const key = pill.key === 'partial' ? 'partialShort' : pill.key
                  return <SalePill pill={pill} label={t(`ops.sales.pill.${key}`, { pct: pill.pct, days: pill.days })} />
                })()}
              </div>
              <div className="flex flex-col gap-[10px] rounded-[14px] border border-line bg-bg p-4 text-[13px] leading-4">
                <div className="flex justify-between gap-3">
                  <span className="text-muted">
                    {[
                      focusSale.cage_name,
                      focusSale.unit_count != null
                        ? t('ops.sales.units', { count: focusSale.unit_count })
                        : `${kg(focusSale.weight_kg)} × ${num(focusSale.price_per_kg)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="whitespace-pre text-text tabular-nums">{num(focusSale.total_amount)}</span>
                </div>
                {Number(focusSale.amount_paid) > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">{t('ops.sales.paidSoFar')}</span>
                    <span className="whitespace-pre text-good tabular-nums">− {num(focusSale.amount_paid)}</span>
                  </div>
                )}
                <div aria-hidden className="h-px shrink-0 bg-line" />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[14px] leading-[18px] text-text">
                    {focusDue ? t('ops.sales.balanceDueOn', { date: shortDate(focusDue) }) : t('ops.sales.balanceDue')}
                  </span>
                  <span className="text-[22px] font-semibold leading-[28px] tabular-nums text-text">
                    {money(Math.max(0, Number(focusSale.balance || 0)))}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-[10px] pt-[14px]">
                <GradientButton variant="solid" ring="sky" size="sm" onClick={() => setSelectedId(focusSale.id || focusSale._id)} aria-expanded={Boolean(selectedSale)}>
                  {Number(focusSale.balance) > 0 ? t('ops.sales.recordPayment') : t('ops.sales.openSale')}
                </GradientButton>
                {focusSale.invoice_id && (
                  <GhostButton href={`/invoices/${focusSale.invoice_id}`}>
                    {t('ops.sales.viewInvoice')}
                  </GhostButton>
                )}
                {isAdmin && (
                  <GhostButton
                    tone="danger"
                    onClick={async () => {
                      try {
                        await removeSale({ id: focusSale.id || focusSale._id })
                        setSelectedId(null)
                        showToast('success', t('ops.sales.deleted'))
                      } catch (err) {
                        showToast('error', errorMessage(err))
                      }
                    }}
                  >
                    {t('ops.sales.delete')}
                  </GhostButton>
                )}
              </div>
            </section>
          ) : null}

          <Panel
            title={t('ops.sales.topCustomers')}
            action={{ label: t('ops.sales.allCustomers'), onClick: () => setTab('customers') }}
          >
            {top.length === 0 ? (
              <p className="py-3 text-[13px] leading-5 text-muted">{t('ops.sales.noCustomers')}</p>
            ) : (
              top.map((c) => (
                <ListRow
                  key={c.key}
                  title={c.name}
                  sub={[t('ops.sales.saleCount', { count: c.count }), c.open ? t('ops.sales.openCount', { count: c.open }) : null]
                    .filter(Boolean)
                    .join(' · ')}
                  value={money(c.total, { compact: true })}
                />
              ))
            )}
          </Panel>
        </div>
      </div>

      {selectedSale && (
        <SaleDetailPanel
          key={`${selectedSale.id}-${selectedSale.updated_at}`}
          sale={selectedSale}
          customers={customers}
          canCorrect={isAdmin}
          onClose={() => setSelectedId(null)}
        />
      )}

      <ReceivablesCard locationId={activeLocationId} onOpenSale={setSelectedId} />
        </>
      )}
    </div>
    </Layout>
  )
}
