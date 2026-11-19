import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Download, Plus } from 'lucide-react'
import { Field, GhostButton, GradientButton, Input, KpiStrip, Pill, Select, Table } from '../components/ui'
import NavTabs from '../components/ui/NavTabs'
import { ListRow, Panel } from '../components/ui/Panel'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useToast } from '../components/Toast'
import { useCurrency } from '../hooks/useCurrency'
import { localToday } from '../lib/format'
import { usePermission } from '../hooks/usePermission'
import { CustomFieldValues, customCell, customColumns, customPayload, useCustomFieldDefs } from '../components/CustomFields'
import FormLayout, { hiddenCoreKeys, useFormLayout } from '../components/FormLayout'
import { useT } from '../lib/i18n/context'
import { financeTabs } from '../lib/sectionTabs'
import { costBuildUp, splitDirect, summarizePnl } from '../lib/pnlSummary'

export default function ExpensesPage() {
  return (
    <ProtectedRoute>
      <Expenses />
    </ProtectedRoute>
  )
}

const today = () => localToday()
const monthStart = () => `${today().slice(0, 7)}-01`

const emptyForm = () => ({
  amount: '',
  category: 'labour',
  date: today(),
  cageId: '',
  supplierId: '',
  notes: '',
  custom: {},
})

function Expenses() {
  const t = useT()
  const { user } = useAuth()
  const isAdmin = usePermission('finance.expenses.manage')
  const canRecord = usePermission('finance.expenses.record')
  const { locationArgs, activeLocationId } = useLocation()
  const { showToast } = useToast()
  const { formatCurrency, symbol } = useCurrency()

  const [dateFrom, setDateFrom] = useState(monthStart())
  const [dateTo, setDateTo] = useState(today())
  const [filterCategory, setFilterCategory] = useState('')
  const [filterCage, setFilterCage] = useState('')

  const categories = useQuery(api.expenses.listCategories, user ? { includeInactive: true } : 'skip')
  const cages = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const suppliers = useQuery(api.feed.listSuppliers, user ? {} : 'skip')
  const data = useQuery(
    api.expenses.list,
    user
      ? {
          ...locationArgs,
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
          ...(filterCategory ? { category: filterCategory } : {}),
          ...(filterCage ? { cageId: filterCage } : {}),
        }
      : 'skip',
  )

  const createExpense = useMutation(api.expenses.create)
  const updateExpense = useMutation(api.expenses.update)
  const removeExpense = useMutation(api.expenses.remove)
  const createCategory = useMutation(api.expenses.createCategory)
  const updateCategory = useMutation(api.expenses.updateCategory)

  const [form, setForm] = useState(emptyForm)
  const expenseFieldDefs = useCustomFieldDefs('expenses', { includeArchived: true })
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [showForm, setShowForm] = useState(false)

  const pnlArgs = user
    ? { ...locationArgs, ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) }
    : 'skip'
  const pnlRows = useQuery(api.reports.listCagePnL, pnlArgs)
  const overheads = useQuery(api.reports.pnlOverheads, pnlArgs)

  const labelOf = useMemo(() => {
    const map = new Map((categories || []).map((c) => [c.key, c.label]))
    return (key) => map.get(key) || key
  }, [categories])

  const layout = useFormLayout('finance.expense')
  const setCustom = useCallback((custom) => setForm((f) => ({ ...f, custom })), [])
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const coreValues = {
    amount: form.amount,
    category: form.category,
    expenseDate: form.date,
    cageId: form.cageId,
    supplierId: form.supplierId,
    notes: form.notes,
  }

  const submit = async (e) => {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!(amount > 0)) {
      showToast('error', t('ops.expenses.toast.amount'))
      return
    }
    // Optional fields a layout condition hides: not saved on create, left as they are on edit.
    const hidden = hiddenCoreKeys(layout.sections, coreValues, form.custom)
    const shown = (key, value) => (hidden.has(key) ? '' : value)
    setSaving(true)
    try {
      if (editingId) {
        await updateExpense({
          id: editingId,
          amount,
          category: form.category,
          date: form.date,
          ...(hidden.has('cageId') ? {} : { cageId: form.cageId || null }),
          ...(hidden.has('supplierId') ? {} : { supplierId: form.supplierId || null }),
          ...(hidden.has('notes') ? {} : { notes: form.notes }),
          custom: form.custom || {},
        })
        showToast('success', t('ops.expenses.toast.updated'))
      } else {
        await createExpense({
          amount,
          category: form.category,
          date: form.date,
          ...(shown('cageId', form.cageId) ? { cageId: form.cageId } : activeLocationId ? { locationId: activeLocationId } : {}),
          ...(shown('supplierId', form.supplierId) ? { supplierId: form.supplierId } : {}),
          ...(shown('notes', form.notes).trim() ? { notes: form.notes.trim() } : {}),
          custom: customPayload(form.custom),
        })
        showToast('success', t('ops.expenses.toast.saved'))
      }
      setForm((f) => ({ ...emptyForm(), category: f.category, date: f.date }))
      setEditingId(null)
      setShowForm(false)
    } catch (err) {
      showToast('error', err.message || t('ops.expenses.toast.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (row) => {
    setEditingId(row.id)
    setForm({
      amount: String(row.amount),
      category: row.category,
      date: row.date,
      cageId: row.cage_id || '',
      supplierId: row.supplier_id || '',
      notes: row.notes || '',
      custom: row.custom || {},
    })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remove = async (row) => {
    if (typeof window !== 'undefined' && !window.confirm(t('ops.expenses.confirmDelete', { amount: formatCurrency(row.amount) }))) return
    try {
      await removeExpense({ id: row.id })
      showToast('success', t('ops.expenses.toast.deleted'))
    } catch (err) {
      showToast('error', err.message || t('ops.expenses.toast.deleteFailed'))
    }
  }

  const addCategory = async () => {
    if (!newCategory.trim()) return
    try {
      await createCategory({ label: newCategory.trim() })
      setNewCategory('')
      showToast('success', t('ops.expenses.toast.categoryAdded'))
    } catch (err) {
      showToast('error', err.message || t('ops.expenses.toast.categoryFailed'))
    }
  }

  const rows = data?.rows || []
  const exportCsv = () => {
    const extra = customColumns(expenseFieldDefs)
    const header = ['Date', 'Category', 'Amount', 'Currency', 'Site', 'Cage', 'Supplier', 'Notes', ...extra.map((c) => c.header)]
    const esc = (v) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = rows.map((r) => [
      r.date,
      labelOf(r.category),
      r.amount,
      r.currency,
      r.location_name || '',
      r.cage_name || '',
      r.supplier_name || '',
      r.notes || '',
      ...extra.map((c) => customCell(c, r)),
    ])
    const csv = [header, ...lines].map((line) => line.map(esc).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `expenses_${dateFrom || 'start'}_to_${dateTo || today()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const activeCategories = (categories || []).filter((c) => c.active)
  const customCategories = (categories || []).filter((c) => !c.builtIn)

  const split = splitDirect(rows)
  const buildUp = costBuildUp(pnlRows || [], overheads)
  const pnlTotals = summarizePnl(pnlRows || [], overheads)
  const byCategory = Object.entries(data?.by_category || {}).sort((a, b) => b[1] - a[1])
  const formOpen = canRecord && (showForm || Boolean(editingId))
  const closeForm = () => {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(false)
  }
  const barMax = Math.max(buildUp.total || 0, ...buildUp.lines.map((l) => l.perKg))

  return (
    <Layout
      title={t('ops.expenses.title')}
      eyebrow={t('ops.expenses.eyebrow')}
      actions={
        <>
          {canRecord && (
            <GradientButton
              icon={Plus}
              onClick={() => {
                setShowForm(true)
                if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            >
              {t('ops.pnl.addExpense')}
            </GradientButton>
          )}
          <GradientButton reverse icon={Download} onClick={exportCsv} disabled={rows.length === 0}>
            {t('ops.expenses.exportCsv')}
          </GradientButton>
        </>
      }
    >
    <div data-tour="page-expenses" className="flex flex-col gap-[28px]">
      <NavTabs tabs={financeTabs(t)} label={t('ops.tabs.finance')} />

      <KpiStrip
        items={[
          {
            label: t('ops.expenses.costPerKg'),
            value: pnlTotals.costPerKg == null ? '—' : formatCurrency(pnlTotals.costPerKg),
            suffix: pnlTotals.costPerKg == null ? undefined : t('ops.expenses.inclOverheads'),
          },
          {
            label: t('ops.expenses.total'),
            value: data === undefined ? '—' : formatCurrency(data.total),
            suffix: data === undefined ? undefined : t('ops.expenses.entries', { count: rows.length }),
          },
          {
            label: t('ops.expenses.direct'),
            value: data === undefined ? '—' : formatCurrency(split.direct),
            suffix: split.directPct == null ? undefined : `${split.directPct}%`,
          },
          {
            label: t('ops.expenses.siteWide'),
            value: data === undefined ? '—' : formatCurrency(split.overhead),
            suffix: split.overheadPct == null ? undefined : `${split.overheadPct}%`,
          },
        ]}
      />

      {formOpen && (
        <Panel
          title={editingId ? t('ops.expenses.edit') : t('ops.pnl.addExpense')}
          titleId="exp-form-title"
          action={{ label: t('common.cancel'), onClick: closeForm }}
        >
          <form onSubmit={submit} className="flex flex-col gap-4 border-t border-line pt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <FormLayout
              formKey="finance.expense"
              layout={layout}
              fields={{
                amount: (
                  <Field label={t('ops.expenses.amountIn', { symbol })} htmlFor="exp-amount" required>
                    <Input
                      id="exp-amount"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={form.amount}
                      onChange={set('amount')}
                      className="text-lg font-data"
                      required
                    />
                  </Field>
                ),
                category: (
                  <Field label={t('ops.expenses.category')} htmlFor="exp-category" required>
                    <Select id="exp-category" value={form.category} onChange={set('category')}>
                      {activeCategories.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ),
                expenseDate: (
                  <Field label={t('ops.expenses.date')} htmlFor="exp-date" required>
                    <Input id="exp-date" type="date" value={form.date} onChange={set('date')} required />
                  </Field>
                ),
                cageId: (
                  <Field label={t('ops.pnl.cage')} htmlFor="exp-cage">
                    <Select id="exp-cage" value={form.cageId} onChange={set('cageId')}>
                      <option value="">{t('ops.expenses.wholeSite')}</option>
                      {(cages || []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ),
                supplierId: (
                  <Field label={t('ops.expenses.supplier')} htmlFor="exp-supplier">
                    <Select id="exp-supplier" value={form.supplierId} onChange={set('supplierId')}>
                      <option value="">{t('ops.common.none')}</option>
                      {(suppliers || []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ),
                notes: (
                  <Field label={t('ops.expenses.notes')} htmlFor="exp-notes">
                    <Input id="exp-notes" value={form.notes} onChange={set('notes')} placeholder={t('ops.expenses.notesPlaceholder')} />
                  </Field>
                ),
              }}
              coreValues={coreValues}
              custom={form.custom}
              onCustomChange={setCustom}
              locationId={activeLocationId}
              core={{ category: form.category, amount: Number(form.amount) || 0 }}
            />
            </div>
            <div className="flex justify-end gap-2">
              <GhostButton onClick={closeForm}>{t('common.cancel')}</GhostButton>
              <GradientButton type="submit" variant="solid" disabled={saving}>
                {saving ? t('ops.common.saving') : editingId ? t('ops.expenses.saveChanges') : t('ops.pnl.addExpense')}
              </GradientButton>
            </div>
          </form>
        </Panel>
      )}

      <div className="flex flex-col gap-[20px] lg:flex-row">
        <section
          aria-labelledby="exp-buildup"
          className="flex min-w-0 grow-[1.4] basis-0 flex-col gap-4 rounded-card border border-line bg-surface px-5 py-6 shadow-[var(--shadow-card)] sm:px-[26px]"
        >
          <div className="flex justify-between gap-3">
            <h2 id="exp-buildup" className="text-[15px] font-semibold leading-[18px] text-text">
              {t('ops.expenses.buildUp')}
            </h2>
            <span className="text-xs leading-4 text-muted">{t('ops.expenses.perKgUnit', { symbol })}</span>
          </div>
          {buildUp.lines.length === 0 ? (
            <p className="text-[13px] text-muted">{pnlRows === undefined ? t('common.loading') : t('ops.expenses.noHarvest')}</p>
          ) : (
            <ul className="flex items-end gap-[14px] overflow-x-auto">
              {[...buildUp.lines.map((l) => ({ ...l, label: labelOf(l.key) })), { key: '__total', label: t('ops.expenses.totalBar'), perKg: buildUp.total }].map(
                (l) => (
                  <li key={l.key} className="flex min-w-[48px] grow basis-0 flex-col items-center gap-2">
                    <span className="text-xs leading-4 text-text tabular-nums">{l.perKg.toFixed(2)}</span>
                    <div className="flex h-[190px] w-full shrink-0 flex-col justify-end" aria-hidden>
                      <div
                        className={`shrink-0 rounded-[6px] ${l.key === '__total' ? 'bg-button' : ''}`}
                        style={{
                          height: `${Math.max((l.perKg / barMax) * 100, 2)}%`,
                          ...(l.key === '__total' ? {} : { backgroundImage: 'linear-gradient(in oklab 180deg, var(--cyan-fill) 0%, var(--pink-fill) 100%)' }),
                        }}
                      />
                    </div>
                    <span className="max-w-full truncate text-xs leading-4 text-muted">{l.label}</span>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>

        <Panel title={t('ops.expenses.byCategory')} titleId="exp-by-cat" meta={t('ops.expenses.inRange')} className="grow basis-0">
          {byCategory.length === 0 ? (
            <p className="border-t border-line py-[11px] text-[13px] text-muted">{data === undefined ? t('common.loading') : t('ops.expenses.empty')}</p>
          ) : (
            byCategory.map(([key, amount], i) => (
              <ListRow
                key={key}
                dot={i === 0 ? 'cyan' : i === 1 ? 'pink' : 'neutral'}
                title={labelOf(key)}
                sub={data.total > 0 ? `${Math.round((amount / data.total) * 100)}%` : undefined}
                value={formatCurrency(amount)}
              />
            ))
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label={t('ops.ledger.from')} htmlFor="f-from">
          <Input id="f-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </Field>
        <Field label={t('ops.ledger.to')} htmlFor="f-to">
          <Input id="f-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </Field>
        <Field label={t('ops.expenses.category')} htmlFor="f-cat">
          <Select id="f-cat" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="">{t('ops.pnl.all')}</option>
            {(categories || []).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('ops.pnl.cage')} htmlFor="f-cage">
          <Select id="f-cage" value={filterCage} onChange={(e) => setFilterCage(e.target.value)}>
            <option value="">{t('ops.pnl.all')}</option>
            {(cages || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Table
        title={t('ops.expenses.tableTitle')}
        actions={
          <span className="text-[13px] leading-5 text-muted">
            {data === undefined ? t('common.loading') : t('ops.expenses.inRangeCount', { count: rows.length })}
            {data?.truncated ? ` ${t('ops.expenses.truncated')}` : ''}
          </span>
        }
        rows={rows}
        rowKey={(r) => r.id}
        empty={data === undefined ? t('common.loading') : t('ops.expenses.emptyHint')}
        columns={[
          {
            key: 'category',
            header: t('ops.expenses.categoryCentre'),
            render: (r) => (
              <span>
                {labelOf(r.category)}
                <span className="text-muted"> · {r.cage_name || r.location_name || t('ops.expenses.company')}</span>
              </span>
            ),
            sub: (r) =>
              r.notes || Object.keys(r.custom || {}).length ? (
                <>
                  {r.notes}
                  <CustomFieldValues entity="expenses" values={r.custom} className="mt-1" />
                </>
              ) : null,
          },
          {
            key: 'type',
            header: t('ops.expenses.type'),
            render: (r) => (
              <Pill tone={r.cage_id ? 'cyan' : 'neutral'}>{r.cage_id ? t('ops.expenses.directPill') : t('ops.expenses.sitePill')}</Pill>
            ),
          },
          { key: 'date', header: t('ops.expenses.date'), render: (r) => <span className="tabular-nums">{r.date}</span> },
          { key: 'supplier', header: t('ops.expenses.supplier'), render: (r) => r.supplier_name || '—' },
          { key: 'amount', header: t('ops.sales.amount'), align: 'right', render: (r) => <span className="font-medium">{formatCurrency(r.amount)}</span> },
          ...(isAdmin
            ? [
                {
                  key: 'actions',
                  header: <span className="sr-only">{t('ops.expenses.actions')}</span>,
                  align: 'right',
                  render: (r) => (
                    <span className="inline-flex gap-2">
                      <GhostButton size="sm" onClick={() => startEdit(r)}>
                        {t('common.edit')}
                      </GhostButton>
                      <GhostButton size="sm" tone="danger" onClick={() => remove(r)}>
                        {t('ops.common.delete')}
                      </GhostButton>
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />

      {isAdmin && (
        <Panel title={t('ops.expenses.categories')} titleId="exp-cats" meta={t('ops.expenses.categoriesSub')}>
          <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end">
            <Field label={t('ops.expenses.newCategory')} htmlFor="new-cat" className="flex-1">
              <Input
                id="new-cat"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder={t('ops.expenses.newCategoryPlaceholder')}
              />
            </Field>
            <GhostButton icon={Plus} onClick={addCategory} disabled={!newCategory.trim()}>
              {t('ops.expenses.addCategory')}
            </GhostButton>
          </div>
          {customCategories.length === 0 ? (
            <p className="pt-4 text-[13px] leading-5 text-muted">{t('ops.expenses.noCustom')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2 pt-4">
              {customCategories.map((c) => (
                <li key={c.key} className="inline-flex min-h-9 items-center gap-2 rounded-pill border border-line px-3 text-[13px] leading-5">
                  <span className={c.active ? 'text-text' : 'text-muted line-through'}>{c.label}</span>
                  <button
                    type="button"
                    className="rounded-sm text-xs text-pearl-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                    onClick={() => updateCategory({ id: c.id, active: !c.active })}
                  >
                    {c.active ? t('ops.expenses.retire') : t('ops.expenses.restore')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
    </Layout>
  )
}
