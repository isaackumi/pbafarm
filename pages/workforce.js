import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Plus } from 'lucide-react'
import { GhostButton, GradientButton, Pill, Table, Toggle } from '../components/ui'
import { FIELD, SettingsCard, SettingsField as Field, SettingsFrame, useSettingsEyebrow } from '../components/settings'
import { useToast } from '../components/Toast'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { usePermission } from '../hooks/usePermission'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'

const EMPTY = {
  fullName: '', jobTitle: '', employeeCode: '', employmentType: '', locationId: '', departmentId: '', userId: '',
  phone: '', email: '', startDate: '',
}

const EMPLOYMENT_KEYS = {
  permanent: 'ent.workforce.permanent',
  contract: 'ent.workforce.contract',
  casual: 'ent.workforce.casual',
  seasonal: 'ent.workforce.seasonal',
}

function StaffForm({ departments, people, onDone }) {
  const t = useT()
  const { showToast } = useToast()
  const create = useMutation(api.workforce.create)
  const { locations } = useLocation()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const opt = (s) => s.trim() || undefined

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await create({
        fullName: form.fullName,
        jobTitle: opt(form.jobTitle),
        employeeCode: opt(form.employeeCode),
        employmentType: form.employmentType || undefined,
        locationId: form.locationId || undefined,
        departmentId: form.departmentId || undefined,
        userId: form.userId || undefined,
        phone: opt(form.phone),
        email: opt(form.email),
        startDate: form.startDate || undefined,
      })
      showToast(t('ent.workforce.added', { name: form.fullName.trim() }), 'success')
      setForm(EMPTY)
      onDone?.()
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard title={t('ent.workforce.addTitle')}>
      <p className="pb-3 text-[12px] leading-4 text-muted">{t('ent.workforce.privacyHint')}</p>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={t('ent.workforce.fullName')} htmlFor="wf-name" required>
          <input className={FIELD} id="wf-name" value={form.fullName} onChange={set('fullName')} required />
        </Field>
        <Field label={t('ent.workforce.jobTitle')} htmlFor="wf-job">
          <input className={FIELD} id="wf-job" value={form.jobTitle} onChange={set('jobTitle')} />
        </Field>
        <Field label={t('ent.workforce.employeeCode')} htmlFor="wf-code">
          <input className={FIELD} id="wf-code" value={form.employeeCode} onChange={set('employeeCode')} />
        </Field>
        <Field label={t('ent.workforce.employmentType')} htmlFor="wf-type">
          <select className={FIELD} id="wf-type" value={form.employmentType} onChange={set('employmentType')}>
            <option value="">{t('ent.common.none')}</option>
            {Object.entries(EMPLOYMENT_KEYS).map(([k, key]) => (
              <option key={k} value={k}>{t(key)}</option>
            ))}
          </select>
        </Field>
        <Field label={t('ent.common.site')} htmlFor="wf-site">
          <select className={FIELD} id="wf-site" value={form.locationId} onChange={set('locationId')}>
            <option value="">{t('ent.common.none')}</option>
            {(locations || []).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('ent.teams.department')} htmlFor="wf-dept">
          <select className={FIELD} id="wf-dept" value={form.departmentId} onChange={set('departmentId')}>
            <option value="">{t('ent.common.none')}</option>
            {departments.map((d) => (
              <option key={d._id} value={d._id}>{d.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('ent.workforce.account')} htmlFor="wf-user" hint={t('ent.workforce.accountHint')}>
          <select className={FIELD} id="wf-user" value={form.userId} onChange={set('userId')}>
            <option value="">{t('ent.common.none')}</option>
            {(people || []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('ent.workforce.startDate')} htmlFor="wf-start">
          <input className={FIELD} id="wf-start" type="date" value={form.startDate} onChange={set('startDate')} />
        </Field>
        <Field label={t('ent.workforce.phone')} htmlFor="wf-phone">
          <input className={FIELD} id="wf-phone" type="tel" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label={t('ent.workforce.email')} htmlFor="wf-email">
          <input className={FIELD} id="wf-email" type="email" value={form.email} onChange={set('email')} />
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2 xl:col-span-4">
          {onDone && <GhostButton size="lg" onClick={onDone}>{t('common.cancel')}</GhostButton>}
          <GradientButton type="submit" disabled={saving || !form.fullName.trim()}>{saving ? t('common.saving') : t('ent.workforce.add')}</GradientButton>
        </div>
      </form>
    </SettingsCard>
  )
}

function Workforce({ adding, setAdding }) {
  const t = useT()
  const { showToast } = useToast()
  const canManage = usePermission('workforce.manage')
  const [showInactive, setShowInactive] = useState(false)
  const data = useQuery(api.workforce.list, { includeInactive: showInactive })
  const teams = useQuery(api.teams.list, {})
  const people = useQuery(api.users.listDirectory, canManage ? {} : 'skip')
  const update = useMutation(api.workforce.update)
  const remove = useMutation(api.workforce.remove)
  const departments = (teams || []).filter((x) => x.kind === 'department' && x.active)

  const run = async (fn) => {
    try {
      await fn()
    } catch (err) {
      showToast(errorMessage(err), 'error')
    }
  }
  const contact = data?.canSeeContact

  const columns = [
    {
      key: 'name',
      header: t('ent.common.name'),
      render: (s) => (
        <span className={s.status === 'inactive' ? 'text-muted' : ''}>
          {s.fullName}
          {s.employeeCode && <span className="font-data text-muted"> ({s.employeeCode})</span>}
        </span>
      ),
      sub: (s) => s.jobTitle || null,
    },
    { key: 'dept', header: t('ent.teams.department'), render: (s) => s.departmentName || '—' },
    { key: 'site', header: t('ent.common.site'), render: (s) => s.siteName || '—' },
    {
      key: 'type',
      header: t('ent.workforce.employmentType'),
      render: (s) => (s.employmentType ? <Pill>{t(EMPLOYMENT_KEYS[s.employmentType])}</Pill> : '—'),
    },
    ...(contact
      ? [{ key: 'contact', header: t('ent.workforce.contact'), render: (s) => [s.phone, s.email].filter(Boolean).join(' · ') || '—' }]
      : []),
    {
      key: 'status',
      header: t('settingsUi.team.col.status'),
      align: 'right',
      render: (s) => (
        <span className="inline-flex items-center justify-end gap-2 whitespace-nowrap">
          {canManage && (
            <>
              <GhostButton
                size="sm"
                onClick={() => run(() => update({ id: s._id, patch: { status: s.status === 'active' ? 'inactive' : 'active' } }))}
              >
                {s.status === 'active' ? t('ent.common.deactivate') : t('ent.common.reactivate')}
              </GhostButton>
              <GhostButton size="sm" tone="danger" onClick={() => run(() => remove({ id: s._id }))}>
                {t('ent.common.remove')}
              </GhostButton>
            </>
          )}
          <Pill tone={s.status === 'active' ? 'green' : 'neutral'}>
            {s.status === 'active' ? t('settingsUi.team.status.active') : t('ent.common.inactive')}
          </Pill>
        </span>
      ),
    },
  ]

  return (
    <SettingsFrame active="members">
      <p className="text-[14px] leading-[18px] text-muted">{t('ent.workforce.description')}</p>
      {canManage && adding && <StaffForm departments={departments} people={people} onDone={() => setAdding(false)} />}
      <Table
        title={t('ent.workforce.title')}
        actions={
          <span className="flex items-center gap-2 text-[13px] leading-4 text-muted">
            <span aria-hidden>{t('ent.workforce.showInactive')}</span>
            <Toggle checked={showInactive} onChange={setShowInactive} label={t('ent.workforce.showInactive')} />
          </span>
        }
        columns={columns}
        rows={data ? data.staff : []}
        empty={!data ? t('common.loading') : `${t('ent.workforce.empty')} ${t('ent.workforce.emptyHint')}`}
      />
    </SettingsFrame>
  )
}

export default function WorkforcePage() {
  const t = useT()
  const canManage = usePermission('workforce.manage')
  const [adding, setAdding] = useState(false)
  const eyebrow = useSettingsEyebrow(t('settingsUi.nav.members'))
  return (
    <ProtectedRoute permission="workforce.view">
      <Layout
        title={t('ent.workforce.title')}
        eyebrow={eyebrow}
        actions={
          canManage && !adding ? (
            <GradientButton icon={Plus} onClick={() => setAdding(true)}>
              {t('ent.workforce.add')}
            </GradientButton>
          ) : null
        }
      >
        <Workforce adding={adding} setAdding={setAdding} />
      </Layout>
    </ProtectedRoute>
  )
}
