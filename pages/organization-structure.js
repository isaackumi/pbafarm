import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ChevronDown, ChevronRight, MapPin, Plus } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { GhostButton, GradientButton, Pill } from '../components/ui'
import { initials } from '../components/ui/Avatar'
import {
  CardNote,
  DetailList,
  FIELD,
  SettingsCard,
  SettingsField as Field,
  SettingsFrame,
  RouteGate,
  SettingsRow,
  useSettingsEyebrow,
} from '../components/settings'
import { useToast } from '../components/Toast'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'

const GROUP = 'border-t border-line pb-2 pt-[14px] text-[13px] font-semibold uppercase leading-4 tracking-[0.04em] text-muted'

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

function useRun() {
  const { showToast } = useToast()
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
  return { busy, run }
}

function TreeButton({ selected, onSelect, depth = 0, open, onToggle, icon, title, helper, count, muted }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-input px-3 py-[10px] ${selected ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
      style={{ marginLeft: depth ? `${depth * 1.5}rem` : undefined }}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={title}
          className="rounded text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        </button>
      ) : (
        <span className="w-4 shrink-0" aria-hidden />
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 grow basis-0 items-center gap-3 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      >
        {icon}
        <span className="flex min-w-0 grow basis-0 flex-col gap-[2px]">
          <span className={`truncate text-[15px] font-medium leading-[18px] ${muted ? 'text-muted line-through' : 'text-text'}`}>{title}</span>
          {helper && <span className="truncate text-[13px] leading-4 text-muted">{helper}</span>}
        </span>
        <span className="shrink-0 text-[14px] leading-[18px] text-muted">{count}</span>
      </button>
    </div>
  )
}

/**
 * Paper 50 Organization structure (H9N-0): business units with their sites
 * as a tree, and the selected unit or site on the right.
 */
function StructurePanel({ units, sites }) {
  const t = useT()
  const create = useMutation(api.businessUnits.create)
  const update = useMutation(api.businessUnits.update)
  const remove = useMutation(api.businessUnits.remove)
  const assign = useMutation(api.businessUnits.assignSites)
  const { busy, run } = useRun()
  const [form, setForm] = useState(null)
  const [closed, setClosed] = useState({})
  const [selected, setSelected] = useState(null)
  const ordered = useMemo(() => treeOrder(units || []), [units])
  const unitById = useMemo(() => new Map(ordered.map((u) => [u._id, u])), [ordered])
  const kindLabel = { region: t('ent.structure.kindRegion'), business_unit: t('ent.structure.kindUnit') }
  const siteType = (s) => (s.siteType ? t.or(`settingsUi.org.siteType.${s.siteType}`, s.siteType) : null)
  const sitesOf = (unitId) => (sites || []).filter((s) => (s.businessUnitId || null) === unitId)
  const unassigned = sitesOf(null)

  // Hide units under a collapsed ancestor.
  const visible = ordered.filter((u) => {
    let p = u.parentId
    while (p) {
      if (closed[p]) return false
      p = unitById.get(p)?.parentId
    }
    return true
  })

  const submit = (e) => {
    e.preventDefault()
    run(async () => {
      await create({
        name: form.name,
        code: form.code.trim() || undefined,
        kind: form.kind,
        parentId: form.parentId || undefined,
      })
      setForm(null)
    }, t('ent.structure.unitAdded', { name: form.name.trim() }))
  }

  const pickedUnit = selected?.type === 'unit' ? unitById.get(selected.id) : null
  const pickedSite = selected?.type === 'site' ? (sites || []).find((s) => s.id === selected.id) : null

  const siteRow = (s, depth) => (
    <TreeButton
      key={s.id}
      depth={depth}
      selected={pickedSite?.id === s.id}
      onSelect={() => setSelected({ type: 'site', id: s.id })}
      icon={<MapPin size={18} aria-hidden className="shrink-0 text-pearl-cyan" />}
      title={s.name}
      helper={[s.waterBody, siteType(s)].filter(Boolean).join(' · ')}
      muted={!s.active}
    />
  )

  const counts = t('settingsUi.org.counts', {
    units: ordered.length,
    sites: (sites || []).length,
  })

  return (
    <div className="flex flex-col items-start gap-5 xl:flex-row">
      <SettingsCard
        title={t('settingsUi.org.structure')}
        className="w-full min-w-0 grow basis-0"
        action={
          !form && (
            <GhostButton size="lg" onClick={() => setForm({ name: '', code: '', kind: 'business_unit', parentId: '' })}>
              {t('settingsUi.org.addUnit')}
            </GhostButton>
          )
        }
      >
        <p className="-mt-2 pb-3 text-[13px] leading-4 text-muted">{counts}</p>
        {form && (
          <form onSubmit={submit} className="grid grid-cols-1 items-end gap-3 border-t border-line py-4 sm:grid-cols-2">
            <Field label={t('ent.common.name')} htmlFor="bu-name" required>
              <input className={FIELD} id="bu-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            </Field>
            <Field label={t('common.code')} htmlFor="bu-code">
              <input className={FIELD} id="bu-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label={t('ent.common.kind')} htmlFor="bu-kind" hint={t('ent.structure.unitsHint')}>
              <select className={FIELD} id="bu-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="region">{kindLabel.region}</option>
                <option value="business_unit">{kindLabel.business_unit}</option>
              </select>
            </Field>
            <Field label={t('ent.common.parent')} htmlFor="bu-parent">
              <select className={FIELD} id="bu-parent" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
                <option value="">{t('ent.common.none')}</option>
                {ordered.filter((u) => u.active).map((u) => (
                  <option key={u._id} value={u._id}>{'— '.repeat(u.depth)}{u.name}</option>
                ))}
              </select>
            </Field>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <GhostButton size="lg" onClick={() => setForm(null)}>{t('common.cancel')}</GhostButton>
              <GradientButton type="submit" disabled={busy || !form.name.trim()}>{t('settingsUi.org.addUnit')}</GradientButton>
            </div>
          </form>
        )}
        {ordered.length === 0 && (sites || []).length === 0 ? (
          <CardNote>{t('ent.structure.noUnits')}</CardNote>
        ) : (
          <div className="flex flex-col gap-1 border-t border-line pt-3">
            {visible.map((u) => {
              const own = sitesOf(u._id)
              const hasKids = own.length > 0 || ordered.some((x) => x.parentId === u._id)
              return (
                <div key={u._id} className="flex flex-col gap-1">
                  <TreeButton
                    depth={u.depth}
                    selected={pickedUnit?._id === u._id}
                    onSelect={() => setSelected({ type: 'unit', id: u._id })}
                    open={!closed[u._id]}
                    onToggle={hasKids ? () => setClosed((c) => ({ ...c, [u._id]: !c[u._id] })) : undefined}
                    icon={
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-line-strong bg-surface-2 text-[11px] font-semibold text-pearl-pink" aria-hidden>
                        {initials(u.name)}
                      </span>
                    }
                    title={u.name}
                    helper={[kindLabel[u.kind], u.code].filter(Boolean).join(' · ')}
                    count={t('ent.structure.siteCount', { count: u.siteCount })}
                    muted={!u.active}
                  />
                  {!closed[u._id] && own.map((s) => siteRow(s, u.depth + 1))}
                </div>
              )
            })}
            {unassigned.length > 0 && (
              <>
                {ordered.length > 0 && <h3 className={`${GROUP} mt-2`}>{t('settingsUi.org.unassigned')}</h3>}
                {unassigned.map((s) => siteRow(s, 0))}
              </>
            )}
          </div>
        )}
      </SettingsCard>

      <SettingsCard className="w-full shrink-0 xl:w-[380px]" aria-live="polite">
        {pickedSite ? (
          <>
            <div className="flex items-start justify-between gap-3 pb-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[12px] leading-4 text-muted">
                  {[unitById.get(pickedSite.businessUnitId)?.name, t('ent.common.site')].filter(Boolean).join(' · ')}
                </span>
                <h2 className="truncate text-[22px] font-semibold leading-7 tracking-tight text-text">{pickedSite.name}</h2>
              </div>
              <RouteGate href="/farm-locations"><GhostButton size="lg" href="/farm-locations">{t('settingsUi.org.edit')}</GhostButton></RouteGate>
            </div>
            <DetailList
              className="border-t border-line"
              items={[
                { label: t('settingsUi.org.location'), value: pickedSite.address || pickedSite.waterBody },
                {
                  label: t('settingsUi.org.gps'),
                  value: pickedSite.latitude != null && pickedSite.longitude != null ? `${pickedSite.latitude}, ${pickedSite.longitude}` : null,
                  mono: true,
                },
                { label: t('settingsUi.org.type'), value: siteType(pickedSite) },
                { label: t('common.code'), value: pickedSite.code },
                { label: t('settingsUi.org.timezone'), value: pickedSite.timezone },
              ]}
            />
            <SettingsRow label={t('ent.structure.sitesHint')} htmlFor={`site-unit-${pickedSite.id}`}>
              <select
                id={`site-unit-${pickedSite.id}`}
                className={`${FIELD} w-48 py-2`}
                value={pickedSite.businessUnitId || ''}
                disabled={busy}
                onChange={(e) =>
                  run(() => assign({ businessUnitId: e.target.value || null, siteIds: [pickedSite.id] }), t('ent.structure.siteMoved'))
                }
              >
                <option value="">{t('ent.common.none')}</option>
                {ordered.filter((u) => u.active || u._id === pickedSite.businessUnitId).map((u) => (
                  <option key={u._id} value={u._id}>{'— '.repeat(u.depth)}{u.name}</option>
                ))}
              </select>
            </SettingsRow>
          </>
        ) : pickedUnit ? (
          <>
            <div className="flex flex-col gap-1 pb-3">
              <span className="text-[12px] leading-4 text-muted">{kindLabel[pickedUnit.kind]}</span>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="truncate text-[22px] font-semibold leading-7 tracking-tight text-text">{pickedUnit.name}</h2>
                {!pickedUnit.active && <Pill>{t('ent.common.inactive')}</Pill>}
              </div>
            </div>
            <DetailList
              className="border-t border-line"
              items={[
                { label: t('common.code'), value: pickedUnit.code, mono: true },
                { label: t('ent.common.parent'), value: unitById.get(pickedUnit.parentId)?.name },
                { label: t('settingsUi.org.sites'), value: t('ent.structure.siteCount', { count: pickedUnit.siteCount }) },
              ]}
            />
            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
              <GhostButton disabled={busy} onClick={() => run(() => update({ id: pickedUnit._id, patch: { active: !pickedUnit.active } }))}>
                {pickedUnit.active ? t('ent.common.deactivate') : t('ent.common.reactivate')}
              </GhostButton>
              <GhostButton
                tone="danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await remove({ id: pickedUnit._id })
                    setSelected(null)
                  }, t('ent.common.removed'))
                }
              >
                {t('ent.common.remove')}
              </GhostButton>
            </div>
          </>
        ) : (
          <p className="text-[13px] leading-4 text-muted">{t('settingsUi.org.pick')}</p>
        )}
      </SettingsCard>
    </div>
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

  const helper = (l) =>
    [l.code, l.status === 'active' ? (l.shareReports ? t('ent.structure.sharing') : t('ent.structure.notSharing')) : null]
      .filter(Boolean)
      .join(' · ')
  const status = (l) => (
    <Pill tone={l.status === 'active' ? 'green' : 'amber'}>{t(STATUS_KEYS[l.status])}</Pill>
  )

  return (
    <SettingsCard title={t('ent.structure.linksTitle')}>
      <p className="pb-3 text-[12px] leading-4 text-muted">{t('ent.structure.linksHint')}</p>
      <form
        className="grid grid-cols-1 items-end gap-3 border-t border-line pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
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
          <input className={FIELD} id="link-code" value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
        <Field label={t('common.notes')} htmlFor="link-note">
          <input className={FIELD} id="link-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <GradientButton type="submit" disabled={busy || !code.trim()}>{t('ent.structure.request')}</GradientButton>
      </form>

      <h3 className={GROUP}>{t('ent.structure.subsidiaries')}</h3>
      {!data ? (
        <CardNote>{t('common.loading')}</CardNote>
      ) : data.subsidiaries.length === 0 ? (
        <CardNote>{t('ent.structure.noSubsidiaries')}</CardNote>
      ) : (
        data.subsidiaries.map((l) => (
          <SettingsRow key={l._id} label={l.name} helper={helper(l)}>
            {status(l)}
            <GhostButton size="sm" disabled={busy} onClick={() => run(() => end({ linkId: l._id }), t('ent.structure.ended'))}>
              {l.status === 'pending' ? t('ent.structure.withdraw') : t('ent.structure.endLink')}
            </GhostButton>
          </SettingsRow>
        ))
      )}

      <h3 className={GROUP}>{t('ent.structure.parents')}</h3>
      {data && data.parents.length === 0 ? (
        <CardNote>{t('ent.structure.noParents')}</CardNote>
      ) : (
          (data?.parents || []).map((l) => (
            <SettingsRow key={l._id} label={l.name} helper={helper(l)}>
              {status(l)}
                {l.status === 'pending' ? (
                  <>
                    <GradientButton size="sm" variant="solid" disabled={busy} onClick={() => run(() => respond({ linkId: l._id, accept: true, shareReports: true }), t('ent.structure.accepted'))}>
                      {t('ent.structure.acceptShare')}
                    </GradientButton>
                    <GhostButton size="sm" disabled={busy} onClick={() => run(() => respond({ linkId: l._id, accept: true, shareReports: false }), t('ent.structure.accepted'))}>
                      {t('ent.structure.acceptOnly')}
                    </GhostButton>
                    <GhostButton size="sm" disabled={busy} onClick={() => run(() => respond({ linkId: l._id, accept: false }))}>
                      {t('ent.structure.decline')}
                    </GhostButton>
                  </>
                ) : (
                  <>
                    <GhostButton size="sm" disabled={busy} onClick={() => run(() => setShare({ linkId: l._id, shareReports: !l.shareReports }))}>
                      {l.shareReports ? t('ent.structure.stopSharing') : t('ent.structure.startSharing')}
                    </GhostButton>
                    <GhostButton size="sm" disabled={busy} onClick={() => run(() => end({ linkId: l._id }), t('ent.structure.ended'))}>
                      {t('ent.structure.endLink')}
                    </GhostButton>
                  </>
                )}
            </SettingsRow>
          ))
      )}
    </SettingsCard>
  )
}

export default function OrganizationStructurePage() {
  const t = useT()
  const units = useQuery(api.businessUnits.list, { includeInactive: true })
  const { locations } = useLocation()
  const eyebrow = useSettingsEyebrow(t('settingsUi.org.eyebrow'))
  return (
    <ProtectedRoute permission="org.structure.manage">
      <Layout
        title={t('settingsUi.org.title')}
        eyebrow={eyebrow}
        actions={
          <RouteGate href="/farm-locations"><GradientButton icon={Plus} href="/farm-locations?new=1">
            {t('settingsUi.org.addSite')}
          </GradientButton></RouteGate>
        }
      >
        <SettingsFrame active="sites">
          <p className="text-[14px] leading-[18px] text-muted">{t('ent.structure.description')}</p>
          {units === undefined ? (
            <SettingsCard><CardNote>{t('common.loading')}</CardNote></SettingsCard>
          ) : (
            <StructurePanel units={units} sites={locations} />
          )}
          <LinksPanel />
        </SettingsFrame>
      </Layout>
    </ProtectedRoute>
  )
}
