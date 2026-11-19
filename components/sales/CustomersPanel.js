import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Plus } from 'lucide-react'
import { Field, GhostButton, GradientButton, Input, Table, Textarea } from '../ui'
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
    <div className="flex flex-col gap-[20px]">
      {editing && canEdit && (
        <form onSubmit={save} className="grid grid-cols-1 gap-4 rounded-card border border-line bg-surface px-5 py-6 shadow-[var(--shadow-card)] sm:px-[26px] md:grid-cols-2">
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
            <GhostButton size="sm" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </GhostButton>
            <GradientButton type="submit" variant="solid" size="sm" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </GradientButton>
          </div>
        </form>
      )}

      <Table
        title={t('sales.customers')}
        actions={
          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="accent-[var(--cyan)]"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              {t('sales.showInactive')}
            </label>
            {canEdit && (
              <GhostButton size="sm" icon={Plus} onClick={() => open(null)}>
                {t('sales.addCustomer')}
              </GhostButton>
            )}
          </div>
        }
        columns={[
          {
            key: 'name',
            header: t('sales.customerName'),
            render: (c) => (
              <span className={c.active ? '' : 'text-muted'}>
                {c.name}
                {!c.active && <span className="ml-2 text-xs">({t('sales.inactive')})</span>}
              </span>
            ),
          },
          { key: 'contact', header: t('sales.contactName'), render: (c) => c.contact_name || '—' },
          { key: 'phone', header: t('sales.phone'), render: (c) => c.phone || '—' },
          { key: 'email', header: t('sales.email'), render: (c) => c.email || '—' },
          ...(canEdit
            ? [
                {
                  key: 'actions',
                  header: t('sales.actions'),
                  align: 'right',
                  render: (c) => (
                    <span className="inline-flex gap-2">
                      <GhostButton size="sm" onClick={() => open(c)}>
                        {t('common.edit')}
                      </GhostButton>
                      <GhostButton size="sm" tone={c.active ? 'danger' : 'default'} onClick={() => toggleActive(c)}>
                        {c.active ? t('sales.deactivate') : t('sales.reactivate')}
                      </GhostButton>
                    </span>
                  ),
                },
              ]
            : []),
        ]}
        rows={customers || []}
        empty={customers === undefined ? t('common.loading') : t('sales.noCustomers')}
      />
    </div>
  )
}
