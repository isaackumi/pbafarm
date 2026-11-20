import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { Field, GhostButton, GradientButton, Input, Modal, Select, Textarea } from './ui'
import { useLocation } from '../contexts/LocationContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { useCurrency } from '../hooks/useCurrency'
import { errorMessage } from '../lib/errorMessage'
import { localToday } from '../lib/format'
import { useT } from '../lib/i18n/context'
import { PROJECT_CATEGORIES, PROJECT_STATUSES } from '../convex/lib/projects'

/**
 * New / edit project (Paper 20 "New project"). The server re-checks every
 * field (convex/projects.ts); a member limited to some sites must pick one.
 */
export default function ProjectForm({ open, onClose, project = null, onSaved }) {
  const t = useT()
  const { user } = useAuth()
  const { locations } = useLocation()
  const { symbol } = useCurrency()
  const { showToast } = useToast()
  const owners = useQuery(api.projects.ownerOptions, open && user ? {} : 'skip')
  const create = useMutation(api.projects.create)
  const update = useMutation(api.projects.update)
  const editing = !!project
  const [form, setForm] = useState(() => ({
    name: project?.name ?? '',
    category: project?.category ?? 'infrastructure',
    status: project?.status ?? 'planned',
    locationId: project?.locationId ?? '',
    ownerUserId: project?.ownerUserId ?? '',
    startDate: project?.startDate ?? localToday(),
    targetEndDate: project?.targetEndDate ?? '',
    budget: project ? String(project.budget) : '',
    notes: project?.notes ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const payload = {
        name: form.name,
        category: form.category,
        status: form.status,
        startDate: form.startDate,
        targetEndDate: form.targetEndDate,
        budget: Number(form.budget || 0),
        notes: form.notes,
        ...(form.ownerUserId ? { ownerUserId: form.ownerUserId } : {}),
      }
      let id
      if (editing) {
        id = await update({ id: project.id, ...payload, locationId: form.locationId || null })
      } else {
        id = await create({ ...payload, ...(form.locationId ? { locationId: form.locationId } : {}) })
      }
      showToast('success', editing ? t('projectsPage.form.updated') : t('projectsPage.form.created'))
      onSaved?.(id)
      onClose()
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      showClose
      size="lg"
      title={editing ? t('projectsPage.form.editTitle') : t('projectsPage.form.newTitle')}
      as="form"
      onSubmit={submit}
      footer={
        <>
          <GhostButton size="lg" onClick={onClose} type="button">
            {t('common.cancel')}
          </GhostButton>
          <GradientButton variant="solid" type="submit" disabled={busy || !form.name.trim() || !form.targetEndDate}>
            {busy ? t('common.saving') : editing ? t('common.save') : t('projectsPage.new')}
          </GradientButton>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('projectsPage.form.name')} htmlFor="pj-name" required className="sm:col-span-2">
          <Input id="pj-name" value={form.name} onChange={set('name')} maxLength={120} required autoFocus />
        </Field>
        <Field label={t('projectsPage.form.category')} htmlFor="pj-cat">
          <Select id="pj-cat" value={form.category} onChange={set('category')}>
            {PROJECT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`projectsPage.category.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('projectsPage.form.status')} htmlFor="pj-status">
          <Select id="pj-status" value={form.status} onChange={set('status')}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`projectsPage.status.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('projectsPage.form.site')} htmlFor="pj-site">
          <Select id="pj-site" value={form.locationId} onChange={set('locationId')}>
            <option value="">{t('projectsPage.companyWide')}</option>
            {locations.map((l) => (
              <option key={l.id || l._id} value={l.id || l._id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('projectsPage.form.owner')} htmlFor="pj-owner">
          <Select id="pj-owner" value={form.ownerUserId} onChange={set('ownerUserId')}>
            <option value="">{t('projectsPage.form.ownerMe')}</option>
            {(owners || []).map((o) => (
              <option key={o.userId} value={o.userId}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('projectsPage.form.start')} htmlFor="pj-start" required>
          <Input id="pj-start" type="date" value={form.startDate} onChange={set('startDate')} required />
        </Field>
        <Field label={t('projectsPage.form.end')} htmlFor="pj-end" required>
          <Input id="pj-end" type="date" value={form.targetEndDate} min={form.startDate} onChange={set('targetEndDate')} required />
        </Field>
        <Field label={t('projectsPage.form.budget', { symbol })} htmlFor="pj-budget">
          <Input id="pj-budget" type="number" inputMode="decimal" min="0" step="any" value={form.budget} onChange={set('budget')} />
        </Field>
        <Field label={t('projectsPage.form.notes')} htmlFor="pj-notes" className="sm:col-span-2">
          <Textarea id="pj-notes" value={form.notes} onChange={set('notes')} maxLength={500} rows={2} />
        </Field>
      </div>
    </Modal>
  )
}
