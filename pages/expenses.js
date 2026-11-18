import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  PageHeader,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  StatCard,
} from '../components/ui'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useToast } from '../components/Toast'
import { useCurrency } from '../hooks/useCurrency'

export default function ExpensesPage() {
  return (
    <ProtectedRoute>
      <Layout title="Expenses">
        <Expenses />
      </Layout>
    </ProtectedRoute>
  )
}

const today = () => new Date().toISOString().slice(0, 10)
const monthStart = () => `${today().slice(0, 7)}-01`

const emptyForm = () => ({
  amount: '',
  category: 'labour',
  date: today(),
  cageId: '',
  supplierId: '',
  notes: '',
})

function Expenses() {
  const { user, hasRole } = useAuth()
  const isAdmin = hasRole?.('admin')
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
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [newCategory, setNewCategory] = useState('')

  const labelOf = useMemo(() => {
    const map = new Map((categories || []).map((c) => [c.key, c.label]))
    return (key) => map.get(key) || key
  }, [categories])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!(amount > 0)) {
      showToast('error', 'Enter an amount greater than zero')
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await updateExpense({
          id: editingId,
          amount,
          category: form.category,
          date: form.date,
          cageId: form.cageId || null,
          supplierId: form.supplierId || null,
          notes: form.notes,
        })
        showToast('success', 'Expense updated')
      } else {
        await createExpense({
          amount,
          category: form.category,
          date: form.date,
          ...(form.cageId ? { cageId: form.cageId } : activeLocationId ? { locationId: activeLocationId } : {}),
          ...(form.supplierId ? { supplierId: form.supplierId } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        })
        showToast('success', 'Expense saved')
      }
      setForm((f) => ({ ...emptyForm(), category: f.category, date: f.date }))
      setEditingId(null)
    } catch (err) {
      showToast('error', err.message || 'Could not save the expense')
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
    })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remove = async (row) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete this ${formatCurrency(row.amount)} expense?`)) return
    try {
      await removeExpense({ id: row.id })
      showToast('success', 'Expense deleted')
    } catch (err) {
      showToast('error', err.message || 'Could not delete the expense')
    }
  }

  const addCategory = async () => {
    if (!newCategory.trim()) return
    try {
      await createCategory({ label: newCategory.trim() })
      setNewCategory('')
      showToast('success', 'Category added')
    } catch (err) {
      showToast('error', err.message || 'Could not add the category')
    }
  }

  const rows = data?.rows || []
  const topCategories = Object.entries(data?.by_category || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  const exportCsv = () => {
    const header = ['Date', 'Category', 'Amount', 'Currency', 'Site', 'Cage', 'Supplier', 'Notes']
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

  return (
    <div data-tour="page-expenses">
      <PageHeader
        showTitle={false}
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Expenses' }]}
        description="Labour, fingerlings, treatments and other running costs. Tag a cage so its cost per kg in Cage P&L includes it."
        related={[
          { label: 'Cage P&L', href: '/pnl' },
          { label: 'Feed purchases', href: '/feed-purchases' },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-1">
          <CardHeader
            title={editingId ? 'Edit expense' : 'Add expense'}
            action={
              editingId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingId(null)
                    setForm(emptyForm())
                  }}
                >
                  Cancel
                </Button>
              ) : null
            }
          />
          <form onSubmit={submit} className="space-y-4">
            <Field label={`Amount (${symbol})`} htmlFor="exp-amount" required>
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
            <Field label="Category" htmlFor="exp-category" required>
              <Select id="exp-category" value={form.category} onChange={set('category')}>
                {activeCategories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" htmlFor="exp-date" required>
                <Input id="exp-date" type="date" value={form.date} onChange={set('date')} required />
              </Field>
              <Field label="Cage" htmlFor="exp-cage">
                <Select id="exp-cage" value={form.cageId} onChange={set('cageId')}>
                  <option value="">Whole site</option>
                  {(cages || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Supplier" htmlFor="exp-supplier">
              <Select id="exp-supplier" value={form.supplierId} onChange={set('supplierId')}>
                <option value="">None</option>
                {(suppliers || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes" htmlFor="exp-notes">
              <Input id="exp-notes" value={form.notes} onChange={set('notes')} placeholder="What it was for" />
            </Field>
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add expense'}
            </Button>
          </form>
        </Card>

        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total" value={formatCurrency(data?.total || 0)} hint={`${rows.length} expenses`} />
            {topCategories.map(([key, amount]) => (
              <StatCard key={key} label={labelOf(key)} value={formatCurrency(amount)} />
            ))}
          </div>

          <Card padding={false}>
            <div className="p-4 sm:p-5 border-b border-foam-deep grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="From" htmlFor="f-from">
                <Input id="f-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </Field>
              <Field label="To" htmlFor="f-to">
                <Input id="f-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </Field>
              <Field label="Category" htmlFor="f-cat">
                <Select id="f-cat" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                  <option value="">All</option>
                  {(categories || []).map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Cage" htmlFor="f-cage">
                <Select id="f-cage" value={filterCage} onChange={(e) => setFilterCage(e.target.value)}>
                  <option value="">All</option>
                  {(cages || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="flex items-center justify-between px-4 sm:px-5 py-3">
              <p className="text-sm text-muted">
                {data === undefined ? 'Loading…' : `${rows.length} in range`}
                {data?.truncated ? ' (first 2,000; narrow the dates)' : ''}
              </p>
              <Button variant="secondary" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
                Export CSV
              </Button>
            </div>

            {data !== undefined && rows.length === 0 ? (
              <EmptyState
                title="No expenses in this range"
                description="Add one with the form, or widen the dates."
              />
            ) : (
              <ul className="divide-y divide-foam-deep">
                {rows.map((r) => (
                  <li key={r.id} className="px-4 sm:px-5 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-chart-ink">
                        {labelOf(r.category)}
                        <span className="text-muted font-normal">
                          {' · '}
                          {r.cage_name || r.location_name || 'Company'}
                        </span>
                      </p>
                      <p className="text-xs text-muted truncate">
                        {r.date}
                        {r.supplier_name ? ` · ${r.supplier_name}` : ''}
                        {r.notes ? ` · ${r.notes}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-data text-sm font-semibold">{formatCurrency(r.amount)}</span>
                      {isAdmin && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => remove(r)}>
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader
            title="Categories"
            subtitle="Built-in categories cover most costs. Add your own for anything else."
          />
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end mb-4">
            <Field label="New category" htmlFor="new-cat" className="flex-1">
              <Input
                id="new-cat"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="e.g. Boat fuel"
              />
            </Field>
            <Button variant="secondary" onClick={addCategory} disabled={!newCategory.trim()}>
              Add category
            </Button>
          </div>
          {customCategories.length === 0 ? (
            <p className="text-sm text-muted">No custom categories yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {customCategories.map((c) => (
                <li
                  key={c.key}
                  className="inline-flex items-center gap-2 rounded-lg border border-foam-deep px-3 min-h-9 text-sm"
                >
                  <span className={c.active ? '' : 'text-muted line-through'}>{c.label}</span>
                  <button
                    type="button"
                    className="text-xs text-lake hover:underline"
                    onClick={() => updateCategory({ id: c.id, active: !c.active })}
                  >
                    {c.active ? 'Retire' : 'Restore'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
