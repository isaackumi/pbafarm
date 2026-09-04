import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  PageHeader,
  Button,
  FormCard,
  FormSection,
  FormActions,
  Field,
  Input,
  Select,
  Textarea,
} from '../components/ui'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useToast } from '../components/Toast'
import { useCurrency } from '../hooks/useCurrency'

export default function SalesPage() {
  return (
    <ProtectedRoute>
      <Layout title="Sales">
        <Sales />
      </Layout>
    </ProtectedRoute>
  )
}

function Sales() {
  const { user, hasRole } = useAuth()
  const isAdmin = hasRole?.('admin')
  const { locationArgs, activeLocationId } = useLocation()
  const { showToast } = useToast()
  const { formatCurrency } = useCurrency()

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
    saleDate: new Date().toISOString().split('T')[0],
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

  const selectedHarvest = useMemo(
    () =>
      (harvests || []).find(
        (h) => (h.id || h._id) === form.harvestId,
      ) || null,
    [harvests, form.harvestId],
  )

  const totals = useMemo(() => {
    const rows = sales || []
    return {
      count: rows.length,
      kg: rows.reduce((s, r) => s + (r.weight_kg || 0), 0),
      revenue: rows.reduce((s, r) => s + (r.total_amount || 0), 0),
    }
  }, [sales])

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
      }
      if (!args.customerId && !args.customerName) {
        throw new Error('Select or enter a buyer')
      }

      await createSale(args)
      showToast('success', 'Sale recorded')
      setShowForm(false)
      setForm({
        harvestId: '',
        customerId: '',
        customerName: '',
        saleDate: new Date().toISOString().split('T')[0],
        weightKg: '',
        pricePerKg: '',
        paymentStatus: 'paid',
        notes: '',
      })
    } catch (err) {
      showToast('error', err.message || 'Failed to record sale')
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
    <div data-tour="page-sales">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Sales' },
        ]}
        description="Record harvest sales by buyer, weight, and price per kg. Revenue is scoped to the active farm location."
        related={[
          { label: 'Harvest', href: '/harvest' },
          { label: 'Farm locations', href: '/farm-locations' },
        ]}
        actions={
          <Button type="button" onClick={() => setShowForm(true)}>
            Record sale
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="page-card p-4">
          <p className="text-xs uppercase text-muted font-semibold">Sales</p>
          <p className="mt-1 font-display text-2xl font-bold font-data">
            {totals.count}
          </p>
        </div>
        <div className="page-card p-4">
          <p className="text-xs uppercase text-muted font-semibold">Weight sold</p>
          <p className="mt-1 font-display text-2xl font-bold font-data">
            {totals.kg.toFixed(1)} kg
          </p>
        </div>
        <div className="page-card p-4">
          <p className="text-xs uppercase text-muted font-semibold">Revenue</p>
          <p className="mt-1 font-display text-2xl font-bold font-data">
            {formatCurrency(totals.revenue)}
          </p>
        </div>
      </div>

      {showForm && (
        <FormCard className="mb-6">
          <form onSubmit={submitSale}>
            <FormSection title="New sale">
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
                      className="mt-2 text-sm font-semibold text-lagoon-800 underline-offset-2 hover:underline"
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
                <p className="mt-3 text-sm text-muted">
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

      <div className="page-card overflow-hidden">
        <div className="px-6 py-4 border-b border-foam-deep">
          <h3 className="text-lg font-medium text-chart-ink">Recent sales</h3>
        </div>
        {sales === undefined ? (
          <p className="px-6 py-8 text-sm text-muted">Loading…</p>
        ) : sales.length === 0 ? (
          <p className="px-6 py-8 text-sm text-muted">
            No sales yet. Record a sale after harvest.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-foam-deep">
              <thead className="bg-foam-deep/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                    Buyer
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                    Cage
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                    kg
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                    ₵/kg
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                    Total
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                    Pay
                  </th>
                  {isAdmin && (
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-foam-deep">
                {sales.map((sale) => (
                  <tr key={sale.id || sale._id}>
                    <td className="px-4 py-3 text-sm font-data">
                      {sale.sale_date}
                    </td>
                    <td className="px-4 py-3 text-sm">{sale.customer_name}</td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {sale.cage_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-data">
                      {Number(sale.weight_kg).toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-data">
                      {formatCurrency(sale.price_per_kg)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-data font-semibold">
                      {formatCurrency(sale.total_amount)}
                    </td>
                    <td className="px-4 py-3 text-sm capitalize">
                      {sale.payment_status}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="text-sm text-signal hover:underline"
                          onClick={async () => {
                            try {
                              await removeSale({ id: sale.id || sale._id })
                              showToast('success', 'Sale deleted')
                            } catch (err) {
                              showToast('error', err.message)
                            }
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
