import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Button, Field, Input, Textarea } from '../ui'
import { useToast } from '../Toast'
import { useT } from '../../lib/i18n/context'
import { errorMessage } from '../../lib/errorMessage'

const EMPTY = { name: '', contactName: '', phone: '', email: '', notes: '' }

/** Customer list with edit and deactivate/reactivate (INV-010). */
export default function CustomersPanel({ canEdit }) {
  const t = useT()
  const { showToast } = useToast()
  const [showInactive, setShowInactive] = useState(false)
  const customers = useQuery(api.sales.listCustomers, {
    includeInactive: showInactive,
  })
  const createCustomer = useMutation(api.sales.createCustomer)
  const updateCustomer = useMutation(api.sales.updateCustomer)
  const [editing, setEditing] = useState(null) // 'new' | customer id
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  const open = (c) => {
    setEditing(c ? c.id : 'new')
    setForm(
      c
        ? {
            name: c.name || '',
            contactName: c.contact_name || '',
            phone: c.phone || '',
            email: c.email || '',
            notes: c.notes || '',
          }
        : EMPTY,
    )
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const fields = {
        name: form.name.trim(),
        contactName: form.contactName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        notes: form.notes.trim(),
      }
      if (editing === 'new') {
        await createCustomer({
          name: fields.name,
          contactName: fields.contactName || undefined,
          phone: fields.phone || undefined,
          email: fields.email || undefined,
          notes: fields.notes || undefined,
        })
        showToast('success', t('sales.customerCreated'))
      } else {
        await updateCustomer({ id: editing, patch: fields })
        showToast('success', t('sales.customerUpdated'))
      }
      setEditing(null)
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (c) => {
    try {
      await updateCustomer({ id: c.id, patch: { active: !c.active } })
      showToast('success', c.active ? t('sales.customerDeactivated') : t('sales.customerReactivated'))
    } catch (err) {
      showToast('error', errorMessage(err))
    }
  }

  return (
    <div className="page-card overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-foam-deep flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-medium text-chart-ink">{t('sales.customers')}</h3>
        <div className="flex items-center gap-4">
          <label className="text-sm text-muted inline-flex items-center gap-2">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            {t('sales.showInactive')}
          </label>
          {canEdit && (
            <Button size="sm" onClick={() => open(null)}>
              {t('sales.addCustomer')}
            </Button>
          )}
        </div>
      </div>

      {editing && canEdit && (
        <form onSubmit={save} className="px-6 py-4 border-b border-foam-deep grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t('sales.customerName')} htmlFor="cust-edit-name" required>
            <Input
              id="cust-edit-name"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              required
            />
          </Field>
          <Field label={t('sales.contactName')} htmlFor="cust-edit-contact">
            <Input
              id="cust-edit-contact"
              value={form.contactName}
              onChange={(e) => setForm((p) => ({ ...p, contactName: e.target.value }))}
            />
          </Field>
          <Field label={t('sales.phone')} htmlFor="cust-edit-phone">
            <Input
              id="cust-edit-phone"
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            />
          </Field>
          <Field label={t('sales.email')} htmlFor="cust-edit-email">
            <Input
              id="cust-edit-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            />
          </Field>
          <Field label={t('common.notes')} htmlFor="cust-edit-notes" className="md:col-span-2">
            <Textarea
              id="cust-edit-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </Field>
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      )}

      {customers === undefined ? (
        <p className="px-6 py-6 text-sm text-muted">{t('common.loading')}</p>
      ) : customers.length === 0 ? (
        <p className="px-6 py-6 text-sm text-muted">{t('sales.noCustomers')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-foam-deep text-sm">
            <thead className="bg-foam-deep/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">{t('sales.customerName')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">{t('sales.contactName')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">{t('sales.phone')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">{t('sales.email')}</th>
                {canEdit && (
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted">{t('sales.actions')}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-foam-deep">
              {customers.map((c) => (
                <tr key={c.id} className={c.active ? '' : 'text-muted'}>
                  <td className="px-4 py-3">
                    {c.name}
                    {!c.active && <span className="ml-2 text-xs">({t('sales.inactive')})</span>}
                  </td>
                  <td className="px-4 py-3">{c.contact_name || '—'}</td>
                  <td className="px-4 py-3">{c.phone || '—'}</td>
                  <td className="px-4 py-3">{c.email || '—'}</td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right space-x-3">
                      <button type="button" className="text-lagoon-800 hover:underline" onClick={() => open(c)}>
                        {t('common.edit')}
                      </button>
                      <button type="button" className="text-signal hover:underline" onClick={() => toggleActive(c)}>
                        {c.active ? t('sales.deactivate') : t('sales.reactivate')}
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
  )
}
