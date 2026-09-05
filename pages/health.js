import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { FirstAidKit } from '@phosphor-icons/react'
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
import LocationMetaField from '../components/LocationMetaField'
import { DIAGNOSIS_SUGGESTIONS } from '../lib/farmHealth'

export default function HealthPage() {
  return (
    <ProtectedRoute>
      <Layout title="Health & Treatments">
        <HealthTreatments />
      </Layout>
    </ProtectedRoute>
  )
}

function HealthTreatments() {
  const { user, hasRole } = useAuth()
  const isAdmin = hasRole?.('admin')
  const { locationArgs } = useLocation()
  const { showToast } = useToast()

  const cages = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const treatments = useQuery(api.health.list, user ? locationArgs : 'skip')
  const withdrawals = useQuery(
    api.health.activeWithdrawals,
    user ? locationArgs : 'skip',
  )
  const createTreatment = useMutation(api.health.create)
  const removeTreatment = useMutation(api.health.remove)

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    cageId: '',
    date: new Date().toISOString().split('T')[0],
    diagnosis: '',
    treatment: '',
    productName: '',
    dosage: '',
    fishAffected: '',
    withdrawalDays: '',
    administeredBy: '',
    notes: '',
  })

  const activeCages = useMemo(
    () => (cages || []).filter((c) => c.status === 'active' || c.status === 'harvesting'),
    [cages],
  )

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (!form.cageId) throw new Error('Select a cage')
      if (!form.treatment.trim()) throw new Error('Treatment is required')
      await createTreatment({
        cageId: form.cageId,
        date: form.date,
        diagnosis: form.diagnosis.trim() || undefined,
        treatment: form.treatment.trim(),
        productName: form.productName.trim() || undefined,
        dosage: form.dosage.trim() || undefined,
        fishAffected:
          form.fishAffected !== '' ? Number(form.fishAffected) : undefined,
        withdrawalDays:
          form.withdrawalDays !== '' ? Number(form.withdrawalDays) : undefined,
        administeredBy: form.administeredBy.trim() || undefined,
        notes: form.notes.trim() || undefined,
      })
      showToast('success', 'Treatment recorded')
      setShowForm(false)
      setForm({
        cageId: '',
        date: new Date().toISOString().split('T')[0],
        diagnosis: '',
        treatment: '',
        productName: '',
        dosage: '',
        fishAffected: '',
        withdrawalDays: '',
        administeredBy: '',
        notes: '',
      })
    } catch (err) {
      showToast('error', err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-tour="page-health">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Health & Treatments' },
        ]}
        description="Record diagnoses, treatments, and harvest withdrawal periods for cages at this location."
        related={[
          { label: 'Daily entry', href: '/daily-entry' },
          { label: 'Harvest', href: '/harvest' },
        ]}
        actions={
          <Button type="button" onClick={() => setShowForm(true)}>
            Record treatment
          </Button>
        }
      />

      {(withdrawals || []).length > 0 && (
        <div className="page-card p-4 mb-6 border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2 mb-2">
            <FirstAidKit size={18} className="text-amber-800" />
            <h3 className="font-semibold text-amber-900">
              Active withdrawal windows
            </h3>
          </div>
          <ul className="space-y-1 text-sm text-amber-900">
            {withdrawals.map((w) => (
              <li key={w.id || w._id}>
                <span className="font-medium">{w.cage_name}</span> —{' '}
                {w.treatment} until <span className="font-data">{w.withdrawal_until}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showForm && (
        <FormCard className="mb-6">
          <form onSubmit={submit}>
            <FormSection title="New treatment">
              <div className="mb-4">
                <LocationMetaField />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Cage" htmlFor="ht-cage" required>
                  <Select
                    id="ht-cage"
                    value={form.cageId}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, cageId: e.target.value }))
                    }
                    required
                  >
                    <option value="">Select cage…</option>
                    {activeCages.map((c) => (
                      <option key={c.id || c._id} value={c.id || c._id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Date" htmlFor="ht-date" required>
                  <Input
                    id="ht-date"
                    type="date"
                    value={form.date}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, date: e.target.value }))
                    }
                    required
                  />
                </Field>
                <Field label="Diagnosis" htmlFor="ht-dx">
                  <Input
                    id="ht-dx"
                    list="dx-suggestions"
                    value={form.diagnosis}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, diagnosis: e.target.value }))
                    }
                    placeholder="Optional"
                  />
                  <datalist id="dx-suggestions">
                    {DIAGNOSIS_SUGGESTIONS.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Treatment" htmlFor="ht-tx" required>
                  <Input
                    id="ht-tx"
                    value={form.treatment}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, treatment: e.target.value }))
                    }
                    required
                    placeholder="e.g. Salt bath, antibiotic course"
                  />
                </Field>
                <Field label="Product" htmlFor="ht-product">
                  <Input
                    id="ht-product"
                    value={form.productName}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, productName: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Dosage" htmlFor="ht-dose">
                  <Input
                    id="ht-dose"
                    value={form.dosage}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, dosage: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Fish affected" htmlFor="ht-fish">
                  <Input
                    id="ht-fish"
                    type="number"
                    min="0"
                    className="font-data"
                    value={form.fishAffected}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, fishAffected: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Withdrawal days" htmlFor="ht-wd">
                  <Input
                    id="ht-wd"
                    type="number"
                    min="0"
                    className="font-data"
                    value={form.withdrawalDays}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        withdrawalDays: e.target.value,
                      }))
                    }
                    placeholder="Days before harvest OK"
                  />
                </Field>
                <Field label="Administered by" htmlFor="ht-by">
                  <Input
                    id="ht-by"
                    value={form.administeredBy}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        administeredBy: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Notes" htmlFor="ht-notes" className="md:col-span-2">
                  <Textarea
                    id="ht-notes"
                    rows={2}
                    value={form.notes}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, notes: e.target.value }))
                    }
                  />
                </Field>
              </div>
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
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </FormActions>
          </form>
        </FormCard>
      )}

      <div className="page-card overflow-hidden">
        <div className="px-6 py-4 border-b border-foam-deep">
          <h3 className="text-lg font-medium text-chart-ink">Treatments</h3>
        </div>
        {treatments === undefined ? (
          <p className="px-6 py-8 text-sm text-muted">Loading…</p>
        ) : treatments.length === 0 ? (
          <p className="px-6 py-8 text-sm text-muted">No treatments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-foam-deep">
              <thead className="bg-foam-deep/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                    Cage
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                    Diagnosis
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                    Treatment
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                    Withdrawal
                  </th>
                  {isAdmin && (
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-foam-deep">
                {treatments.map((t) => (
                  <tr key={t.id || t._id}>
                    <td className="px-4 py-3 text-sm font-data">{t.date}</td>
                    <td className="px-4 py-3 text-sm">{t.cage_name}</td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {t.diagnosis || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {t.treatment}
                      {t.product_name ? (
                        <span className="block text-xs text-muted">
                          {t.product_name}
                          {t.dosage ? ` · ${t.dosage}` : ''}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-sm font-data">
                      {t.withdrawal_until || '—'}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="text-sm text-signal hover:underline"
                          onClick={async () => {
                            try {
                              await removeTreatment({ id: t.id || t._id })
                              showToast('success', 'Deleted')
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
