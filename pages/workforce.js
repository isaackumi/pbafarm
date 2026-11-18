import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, EmptyState, Field, FormPage, Input, PageHeader, Select } from '../components/ui'
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
    <Card>
      <CardHeader title={t('ent.workforce.addTitle')} subtitle={t('ent.workforce.privacyHint')} />
      <form onSubmit={submit} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label={t('ent.workforce.fullName')} htmlFor="wf-name" required>
          <Input id="wf-name" value={form.fullName} onChange={set('fullName')} required />
        </Field>
        <Field label={t('ent.workforce.jobTitle')} htmlFor="wf-job">
          <Input id="wf-job" value={form.jobTitle} onChange={set('jobTitle')} />
        </Field>
        <Field label={t('ent.workforce.employeeCode')} htmlFor="wf-code">
          <Input id="wf-code" value={form.employeeCode} onChange={set('employeeCode')} />
        </Field>
        <Field label={t('ent.workforce.employmentType')} htmlFor="wf-type">
          <Select id="wf-type" value={form.employmentType} onChange={set('employmentType')}>
            <option value="">{t('ent.common.none')}</option>
            {Object.entries(EMPLOYMENT_KEYS).map(([k, key]) => (
              <option key={k} value={k}>{t(key)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('ent.common.site')} htmlFor="wf-site">
          <Select id="wf-site" value={form.locationId} onChange={set('locationId')}>
            <option value="">{t('ent.common.none')}</option>
            {(locations || []).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('ent.teams.department')} htmlFor="wf-dept">
          <Select id="wf-dept" value={form.departmentId} onChange={set('departmentId')}>
            <option value="">{t('ent.common.none')}</option>
            {departments.map((d) => (
              <option key={d._id} value={d._id}>{d.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('ent.workforce.account')} htmlFor="wf-user" hint={t('ent.workforce.accountHint')}>
          <Select id="wf-user" value={form.userId} onChange={set('userId')}>
            <option value="">{t('ent.common.none')}</option>
            {(people || []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('ent.workforce.startDate')} htmlFor="wf-start">
          <Input id="wf-start" type="date" value={form.startDate} onChange={set('startDate')} />
        </Field>
        <Field label={t('ent.workforce.phone')} htmlFor="wf-phone">
          <Input id="wf-phone" type="tel" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label={t('ent.workforce.email')} htmlFor="wf-email">
          <Input id="wf-email" type="email" value={form.email} onChange={set('email')} />
        </Field>
        <div className="col-span-2 sm:col-span-4 flex justify-end gap-2">
          {onDone && <Button variant="secondary" onClick={onDone}>{t('common.cancel')}</Button>}
          <Button type="submit" disabled={saving || !form.fullName.trim()}>{saving ? t('common.saving') : t('ent.workforce.add')}</Button>
        </div>
      </form>
    </Card>
  )
}

function Workforce() {
  const t = useT()
  const { showToast } = useToast()
  const canManage = usePermission('workforce.manage')
  const [showInactive, setShowInactive] = useState(false)
  const [adding, setAdding] = useState(false)
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

  return (
    <FormPage width="full">
      <PageHeader
        title={t('ent.workforce.title')}
        breadcrumbs={[{ label: t('nav.item.dashboard'), href: '/dashboard' }, { label: t('ent.workforce.title') }]}
        description={t('ent.workforce.description')}
        actions={canManage && !adding && <Button size="sm" onClick={() => setAdding(true)}>{t('ent.workforce.add')}</Button>}
        related={[{ label: t('nav.item.teams'), href: '/teams' }, { label: t('nav.item.users'), href: '/users' }]}
      />
      <div className="space-y-6">
        {canManage && adding && <StaffForm departments={departments} people={people} onDone={() => setAdding(false)} />}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          {t('ent.workforce.showInactive')}
        </label>
        <Card padding={false}>
          {!data ? (
            <p className="p-5 text-sm text-muted">{t('common.loading')}</p>
          ) : data.staff.length === 0 ? (
            <EmptyState title={t('ent.workforce.empty')} description={t('ent.workforce.emptyHint')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-foam-deep">
                    <th className="px-4 py-2 font-medium">{t('ent.common.name')}</th>
                    <th className="px-4 py-2 font-medium">{t('ent.workforce.jobTitle')}</th>
                    <th className="px-4 py-2 font-medium">{t('ent.teams.department')}</th>
                    <th className="px-4 py-2 font-medium">{t('ent.common.site')}</th>
                    <th className="px-4 py-2 font-medium">{t('ent.workforce.employmentType')}</th>
                    {contact && <th className="px-4 py-2 font-medium">{t('ent.workforce.contact')}</th>}
                    {canManage && <th className="px-4 py-2" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-foam-deep">
                  {data.staff.map((s) => (
                    <tr key={s._id} className={s.status === 'inactive' ? 'text-muted' : ''}>
                      <td className="px-4 py-2 font-medium">
                        {s.fullName}
                        {s.employeeCode && <span className="text-muted"> ({s.employeeCode})</span>}
                      </td>
                      <td className="px-4 py-2">{s.jobTitle || '—'}</td>
                      <td className="px-4 py-2">{s.departmentName || '—'}</td>
                      <td className="px-4 py-2">{s.siteName || '—'}</td>
                      <td className="px-4 py-2">{s.employmentType ? t(EMPLOYMENT_KEYS[s.employmentType]) : '—'}</td>
                      {contact && <td className="px-4 py-2">{[s.phone, s.email].filter(Boolean).join(' · ') || '—'}</td>}
                      {canManage && (
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => run(() => update({ id: s._id, patch: { status: s.status === 'active' ? 'inactive' : 'active' } }))}
                          >
                            {s.status === 'active' ? t('ent.common.deactivate') : t('ent.common.reactivate')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => run(() => remove({ id: s._id }))}>
                            {t('ent.common.remove')}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </FormPage>
  )
}

export default function WorkforcePage() {
  return (
    <ProtectedRoute permission="workforce.view">
      <Layout title="Workforce">
        <Workforce />
      </Layout>
    </ProtectedRoute>
  )
}
