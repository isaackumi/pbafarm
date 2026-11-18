import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, EmptyState, Field, FormPage, Input, PageHeader, Select } from '../components/ui'
import { useToast } from '../components/Toast'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'

/** Units in tree order with their depth (parents before children). */
function treeOrder(units) {
  const byParent = new Map()
  for (const u of units) {
    const key = u.parentId || ''
    byParent.set(key, [...(byParent.get(key) || []), u])
  }
  const out = []
  const walk = (parent, depth) => {
    for (const u of byParent.get(parent) || []) {
      out.push({ ...u, depth })
      if (depth < 5) walk(u._id, depth + 1)
    }
  }
  walk('', 0)
  return out
}

function UnitsPanel({ units, sites }) {
  const t = useT()
  const { showToast } = useToast()
  const create = useMutation(api.businessUnits.create)
  const update = useMutation(api.businessUnits.update)
  const remove = useMutation(api.businessUnits.remove)
  const assign = useMutation(api.businessUnits.assignSites)
  const [form, setForm] = useState({ name: '', code: '', kind: 'region', parentId: '' })
  const [busy, setBusy] = useState(false)
  const ordered = useMemo(() => treeOrder(units || []), [units])
  const kindLabel = { region: t('ent.structure.kindRegion'), business_unit: t('ent.structure.kindUnit') }

  const run = async (fn, ok) => {
    setBusy(true)
    try {
      await fn()
      if (ok) showToast(ok, 'success')
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    run(async () => {
      await create({
        name: form.name,
        code: form.code.trim() || undefined,
        kind: form.kind,
        parentId: form.parentId || undefined,
      })
      setForm({ name: '', code: '', kind: form.kind, parentId: form.parentId })
    }, t('ent.structure.unitAdded', { name: form.name.trim() }))
  }

  return (
    <>
      <Card>
        <CardHeader title={t('ent.structure.unitsTitle')} subtitle={t('ent.structure.unitsHint')} />
        <form onSubmit={submit} className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
          <Field label={t('ent.common.name')} htmlFor="bu-name" required>
            <Input id="bu-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label={t('common.code')} htmlFor="bu-code">
            <Input id="bu-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label={t('ent.common.kind')} htmlFor="bu-kind">
            <Select id="bu-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="region">{kindLabel.region}</option>
              <option value="business_unit">{kindLabel.business_unit}</option>
            </Select>
          </Field>
          <Field label={t('ent.common.parent')} htmlFor="bu-parent">
            <Select id="bu-parent" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">{t('ent.common.none')}</option>
              {ordered.filter((u) => u.active).map((u) => (
                <option key={u._id} value={u._id}>{'— '.repeat(u.depth)}{u.name}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={busy || !form.name.trim()}>{t('ent.structure.addUnit')}</Button>
        </form>
        {units && units.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t('ent.structure.noUnits')}</p>
        ) : (
          <ul className="mt-4 divide-y divide-foam-deep text-sm">
            {ordered.map((u) => (
              <li key={u._id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <span style={{ paddingLeft: `${u.depth * 1.25}rem` }} className={u.active ? '' : 'text-muted line-through'}>
                  <span className="font-medium">{u.name}</span>
                  {u.code && <span className="text-muted"> ({u.code})</span>}
                  <span className="text-muted"> · {kindLabel[u.kind]} · {t('ent.structure.siteCount', { count: u.siteCount })}</span>
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run(() => update({ id: u._id, patch: { active: !u.active } }))}
                  >
                    {u.active ? t('ent.common.deactivate') : t('ent.common.reactivate')}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => remove({ id: u._id }), t('ent.common.removed'))}>
                    {t('ent.common.remove')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={t('ent.structure.sitesTitle')} subtitle={t('ent.structure.sitesHint')} />
        {!sites || sites.length === 0 ? (
          <p className="text-sm text-muted">{t('ent.structure.noSites')}</p>
        ) : (
          <ul className="divide-y divide-foam-deep text-sm">
            {sites.map((s) => (
              <li key={s.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={`site-unit-${s.id}`} className="font-medium">{s.name}</label>
                <Select
                  id={`site-unit-${s.id}`}
                  className="max-w-xs"
                  value={s.businessUnitId || ''}
                  disabled={busy}
                  onChange={(e) =>
                    run(() => assign({ businessUnitId: e.target.value || null, siteIds: [s.id] }), t('ent.structure.siteMoved'))
                  }
                >
                  <option value="">{t('ent.common.none')}</option>
                  {ordered.filter((u) => u.active || u._id === s.businessUnitId).map((u) => (
                    <option key={u._id} value={u._id}>{'— '.repeat(u.depth)}{u.name}</option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

const STATUS_KEYS = { pending: 'ent.structure.statusPending', active: 'ent.structure.statusActive' }

function LinksPanel() {
  const t = useT()
  const { showToast } = useToast()
  const data = useQuery(api.companyLinks.overview, {})
  const request = useMutation(api.companyLinks.request)
  const respond = useMutation(api.companyLinks.respond)
  const setShare = useMutation(api.companyLinks.setShareReports)
  const end = useMutation(api.companyLinks.end)
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn, ok) => {
    setBusy(true)
    try {
      await fn()
      if (ok) showToast(ok, 'success')
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const label = (l) => (
    <span>
      <span className="font-medium">{l.name}</span>
      {l.code && <span className="text-muted"> ({l.code})</span>}
      <span className="text-muted"> · {t(STATUS_KEYS[l.status])}</span>
      {l.status === 'active' && (
        <span className="text-muted"> · {l.shareReports ? t('ent.structure.sharing') : t('ent.structure.notSharing')}</span>
      )}
    </span>
  )

  return (
    <Card>
      <CardHeader title={t('ent.structure.linksTitle')} subtitle={t('ent.structure.linksHint')} />
      <form
        className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
        onSubmit={(e) => {
          e.preventDefault()
          run(async () => {
            await request({ childCode: code, note: note.trim() || undefined })
            setCode('')
            setNote('')
          }, t('ent.structure.requestSent'))
        }}
      >
        <Field label={t('ent.structure.childCode')} htmlFor="link-code" required>
          <Input id="link-code" value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
        <Field label={t('common.notes')} htmlFor="link-note">
          <Input id="link-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy || !code.trim()}>{t('ent.structure.request')}</Button>
      </form>

      <h3 className="mt-6 font-medium">{t('ent.structure.subsidiaries')}</h3>
      {!data ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : data.subsidiaries.length === 0 ? (
        <p className="text-sm text-muted">{t('ent.structure.noSubsidiaries')}</p>
      ) : (
        <ul className="divide-y divide-foam-deep text-sm">
          {data.subsidiaries.map((l) => (
            <li key={l._id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              {label(l)}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => end({ linkId: l._id }), t('ent.structure.ended'))}>
                {l.status === 'pending' ? t('ent.structure.withdraw') : t('ent.structure.endLink')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 font-medium">{t('ent.structure.parents')}</h3>
      {data && data.parents.length === 0 ? (
        <p className="text-sm text-muted">{t('ent.structure.noParents')}</p>
      ) : (
        <ul className="divide-y divide-foam-deep text-sm">
          {(data?.parents || []).map((l) => (
            <li key={l._id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              {label(l)}
              <span className="flex flex-wrap gap-2">
                {l.status === 'pending' ? (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => run(() => respond({ linkId: l._id, accept: true, shareReports: true }), t('ent.structure.accepted'))}>
                      {t('ent.structure.acceptShare')}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => respond({ linkId: l._id, accept: true, shareReports: false }), t('ent.structure.accepted'))}>
                      {t('ent.structure.acceptOnly')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => respond({ linkId: l._id, accept: false }))}>
                      {t('ent.structure.decline')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => setShare({ linkId: l._id, shareReports: !l.shareReports }))}>
                      {l.shareReports ? t('ent.structure.stopSharing') : t('ent.structure.startSharing')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => end({ linkId: l._id }), t('ent.structure.ended'))}>
                      {t('ent.structure.endLink')}
                    </Button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function OrganizationStructure() {
  const t = useT()
  const units = useQuery(api.businessUnits.list, { includeInactive: true })
  const { locations } = useLocation()
  return (
    <FormPage width="full">
      <PageHeader
        title={t('ent.structure.title')}
        breadcrumbs={[{ label: t('nav.item.dashboard'), href: '/dashboard' }, { label: t('ent.structure.title') }]}
        description={t('ent.structure.description')}
        related={[
          { label: t('nav.item.farmLocations'), href: '/farm-locations' },
          { label: t('nav.item.reportsRegions'), href: '/reports/regions' },
          { label: t('nav.item.groupReports'), href: '/group-reports' },
        ]}
      />
      <div className="space-y-6">
        {units === undefined ? <EmptyState title={t('common.loading')} /> : <UnitsPanel units={units} sites={locations} />}
        <LinksPanel />
      </div>
    </FormPage>
  )
}

export default function OrganizationStructurePage() {
  return (
    <ProtectedRoute permission="org.structure.manage">
      <Layout title="Organization structure">
        <OrganizationStructure />
      </Layout>
    </ProtectedRoute>
  )
}
