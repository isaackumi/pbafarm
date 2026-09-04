import { useEffect, useState } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import DependencyEmpty from '../components/DependencyEmpty'
import FeedTypeField from '../components/FeedTypeField'
import {
  PageHeader,
  Button,
  FormPage,
  FormCard,
  FormActions,
  FormSection,
  Field,
  Input,
  Select,
  Textarea,
} from '../components/ui'

export default function FeedIssuePage() {
  return (
    <ProtectedRoute>
      <Layout title="Issue Feed">
        <FeedIssue />
      </Layout>
    </ProtectedRoute>
  )
}

function FeedIssue() {
  const { showToast } = useToast()
  const { hasRole } = useAuth()
  const [feedTypes, setFeedTypes] = useState([])
  const [cages, setCages] = useState([])
  const [lookupsReady, setLookupsReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    feedTypeId: '',
    cageId: '',
    quantityKg: '',
    bags: '',
    usageDate: new Date().toISOString().split('T')[0],
    notes: '',
    allowNegative: false,
    overrideReason: '',
  })

  const loadLookups = async () => {
    const client = getConvexHttpClient()
    const [types, cageList] = await Promise.all([
      client.query(api.feed.listFeedTypes, {}),
      client.query(api.cages.getActive, {}),
    ])
    setFeedTypes(types || [])
    setCages(cageList || [])
    setLookupsReady(true)
  }

  useEffect(() => {
    loadLookups().catch((e) => {
      showToast('error', e.message)
      setLookupsReady(true)
    })
  }, [showToast])

  const selected = feedTypes.find((f) => (f.id || f._id) === form.feedTypeId)
  const bagSize = selected?.bag_size_kg || 25

  const onChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm((p) => {
      const next = { ...p, [name]: type === 'checkbox' ? checked : value }
      if (name === 'bags' && value !== '') {
        next.quantityKg = String(
          Math.round(parseFloat(value) * bagSize * 1000) / 1000,
        )
      }
      if (name === 'quantityKg' && value !== '') {
        next.bags = String(
          Math.round((parseFloat(value) / bagSize) * 1000) / 1000,
        )
      }
      return next
    })
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (!form.feedTypeId) throw new Error('Select a feed type')
      const client = getConvexHttpClient()
      await client.mutation(api.feed.createIssue, {
        feedTypeId: form.feedTypeId,
        cageId: form.cageId || undefined,
        quantity: form.quantityKg ? Number(form.quantityKg) : undefined,
        bags: form.bags ? Number(form.bags) : undefined,
        usageDate: form.usageDate,
        notes: form.notes || undefined,
        allowNegative: form.allowNegative || undefined,
        overrideReason: form.overrideReason || undefined,
      })
      showToast('success', 'Feed issued — stock deducted on ledger')
      setForm((p) => ({
        ...p,
        quantityKg: '',
        bags: '',
        notes: '',
        allowNegative: false,
        overrideReason: '',
      }))
    } catch (err) {
      showToast('error', err.message || 'Failed to issue feed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormPage data-tour="page-feed-issue">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Inventory', href: '/stock-levels' },
          { label: 'Issue feed' },
        ]}
        description="Record when feed leaves the store. Deducts stock via the inventory ledger (bags or kg)."
        related={[
          { label: 'Stock levels', href: '/stock-levels' },
          { label: 'Feed purchases', href: '/feed-purchases' },
          { label: 'Daily entry', href: '/daily-entry' },
        ]}
      />

      <FormCard
        title="Issue details"
        subtitle="Enter bags or kilograms — the other field updates from bag size."
      >
        <form onSubmit={submit} className="space-y-8">
          <FormSection title="What & where">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FeedTypeField
                id="feedTypeId"
                name="feedTypeId"
                value={form.feedTypeId}
                onChange={onChange}
                feedTypes={feedTypes}
                ready={lookupsReady}
                required
                fieldClassName="md:col-span-2"
                emptyMessage="Issue feed needs at least one feed type on the catalog."
                onFeedTypesChanged={loadLookups}
                onCreated={(result) => {
                  loadLookups()
                  if (result?.id) {
                    setForm((p) => ({ ...p, feedTypeId: result.id }))
                  }
                }}
              />
              <Field label="Cage (optional)" htmlFor="cageId">
                <Select
                  id="cageId"
                  name="cageId"
                  value={form.cageId}
                  onChange={onChange}
                >
                  <option value="">None</option>
                  {cages.map((c) => (
                    <option key={c.id || c._id} value={c.id || c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                {lookupsReady && cages.length === 0 && (
                  <DependencyEmpty
                    message="No active cages yet — you can still issue without a cage, or stock one first."
                    createKind="stocking"
                    createLabel="Create stocking"
                    secondaryCreateKind="cage"
                    secondaryCreateLabel="Create a cage"
                    onCreated={() => loadLookups()}
                  />
                )}
              </Field>
              <Field label="Date" htmlFor="usageDate" required>
                <Input
                  id="usageDate"
                  name="usageDate"
                  type="date"
                  value={form.usageDate}
                  onChange={onChange}
                  required
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Quantity">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Bags" htmlFor="bags">
                <Input
                  id="bags"
                  name="bags"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.bags}
                  onChange={onChange}
                  className="font-data"
                />
              </Field>
              <Field
                label="Kilograms"
                htmlFor="quantityKg"
                hint={`Bag size: ${bagSize} kg`}
              >
                <Input
                  id="quantityKg"
                  name="quantityKg"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.quantityKg}
                  onChange={onChange}
                  className="font-data"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Notes">
            <Field label="Optional notes" htmlFor="notes">
              <Textarea
                id="notes"
                name="notes"
                value={form.notes}
                onChange={onChange}
                rows={2}
              />
            </Field>
          </FormSection>

          {hasRole('admin') && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-chart-ink">
                <input
                  type="checkbox"
                  name="allowNegative"
                  checked={form.allowNegative}
                  onChange={onChange}
                  className="rounded border-zinc-300"
                />
                Admin override (allow insufficient stock)
              </label>
              {form.allowNegative && (
                <Field label="Override reason" htmlFor="overrideReason" required>
                  <Input
                    id="overrideReason"
                    name="overrideReason"
                    value={form.overrideReason}
                    onChange={onChange}
                    required
                    placeholder="Why is this override needed?"
                  />
                </Field>
              )}
            </div>
          )}

          <FormActions>
            <Button type="submit" disabled={saving || feedTypes.length === 0} size="lg">
              {saving ? 'Saving…' : 'Issue feed'}
            </Button>
            <Button href="/stock-levels" variant="secondary">
              Cancel
            </Button>
          </FormActions>
        </form>
      </FormCard>
    </FormPage>
  )
}
