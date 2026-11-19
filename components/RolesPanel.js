import { useMemo, useState } from 'react'
import { ArrowLeftRight, Plus } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { usePermission } from '../hooks/usePermission'
import { useT } from '../lib/i18n/context'
import { Avatar, CheckCell, GhostButton, GradientButton, Pill, Toggle } from './ui'
import { CardNote, DangerRow, FIELD, InlineError, SettingsCard, SettingsField } from './settings'

const roleId = (role) => (role.id ? `c:${role.id}` : `t:${role.key}`)

/**
 * Paper 22 Roles & permissions (57B-0, light 7BH-0): roles list, the selected
 * role's permissions by group, and the read-only matrix across every role.
 * Templates are fixed; custom roles (PERM-002) can be edited by
 * `org.roles.manage`.
 */
export default function RolesPanel({ renderShell }) {
  const t = useT()
  const data = useQuery(api.roles.list, {})
  const members = useQuery(api.memberships.listMembers, {})
  const canManage = usePermission('org.roles.manage')
  const createRole = useMutation(api.roles.create)
  const updateRole = useMutation(api.roles.update)
  const archiveRole = useMutation(api.roles.archive)
  const [selected, setSelected] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const roles = useMemo(
    () => (data ? [...data.templates, ...data.custom] : []),
    [data],
  )
  const templatesByKey = useMemo(
    () => Object.fromEntries((data?.templates || []).map((r) => [r.key, r])),
    [data],
  )
  const membersOf = useMemo(() => {
    const map = new Map()
    for (const m of members || []) {
      const k = m.roleId ? `c:${m.roleId}` : `t:${m.roleKey}`
      map.set(k, [...(map.get(k) || []), m])
    }
    return map
  }, [members])

  const name = (role) => (role.id ? role.name : t.or(`settingsUi.team.role.${role.key}`, role.name))
  const current =
    selected === 'new' ? null : roles.find((r) => roleId(r) === selected) || roles[0] || null
  const editing = selected === 'new' || (current?.id && canManage)
  const form =
    draft ||
    (selected === 'new'
      ? { name: '', basedOn: '', permissions: [] }
      : current
        ? { name: current.name, basedOn: current.basedOn || '', permissions: current.permissions }
        : null)
  const dirty = Boolean(draft)

  const select = (key) => {
    setSelected(key)
    setDraft(null)
    setError('')
  }

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err, t('settingsUi.roles.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      if (selected === 'new') {
        const id = await createRole({
          name: form.name,
          permissions: form.permissions,
          ...(form.basedOn ? { basedOn: form.basedOn } : {}),
        })
        setDraft(null)
        setSelected(typeof id === 'string' ? `c:${id}` : null)
      } else {
        await updateRole({ roleId: current.id, name: form.name, permissions: form.permissions })
        setDraft(null)
      }
    })

  const archive = () => {
    if (!window.confirm(t('settingsUi.roles.archiveConfirm', { name: current.name }))) return
    run(async () => {
      await archiveRole({ roleId: current.id })
      select(null)
    })
  }

  const togglePerm = (key) =>
    setDraft({
      ...form,
      permissions: form.permissions.includes(key)
        ? form.permissions.filter((p) => p !== key)
        : [...form.permissions, key],
    })

  const startFrom = (basedOn) =>
    setDraft({
      ...form,
      basedOn,
      permissions: basedOn ? [...(templatesByKey[basedOn]?.permissions || [])] : form.permissions,
    })

  const actions = (
    <>
      {canManage && (
        <GradientButton icon={Plus} onClick={() => select('new')}>
          {t('settingsUi.roles.new')}
        </GradientButton>
      )}
      <GradientButton reverse icon={ArrowLeftRight} href="#matrix">
        {t('settingsUi.roles.compare')}
      </GradientButton>
    </>
  )

  if (!data) {
    return renderShell({
      meta: null,
      actions,
      children: (
        <SettingsCard>
          <CardNote>{t('common.loading')}</CardNote>
        </SettingsCard>
      ),
    })
  }

  const roleMembers = current && selected !== 'new' ? membersOf.get(roleId(current)) || [] : []
  const basedOnName = form?.basedOn ? t.or(`settingsUi.team.role.${form.basedOn}`, form.basedOn) : null
  const extra =
    form?.basedOn && templatesByKey[form.basedOn]
      ? form.permissions.filter((p) => !templatesByKey[form.basedOn].permissions.includes(p)).length
      : null

  const children = (
    <>
      <InlineError>{error}</InlineError>
      <div className="flex flex-col items-start gap-5 xl:flex-row">
        <nav
          aria-label={t('settingsUi.roles.list')}
          className="flex w-full shrink-0 flex-col gap-1 rounded-card border border-line bg-surface p-5 shadow-[var(--shadow-card)] xl:w-[300px]"
        >
          <h2 className="px-[6px] pb-3 pt-1 text-[15px] font-semibold leading-[18px] text-text">
            {t('settingsUi.roles.list')}
          </h2>
          {roles.map((role) => {
            const on = selected !== 'new' && current && roleId(current) === roleId(role)
            const count = (membersOf.get(roleId(role)) || []).length
            return (
              <button
                key={roleId(role)}
                type="button"
                aria-current={on ? 'true' : undefined}
                onClick={() => select(roleId(role))}
                className={`flex items-center gap-3 rounded-input border p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                  on ? 'border-line-strong bg-surface-2' : 'border-transparent hover:bg-surface-2'
                }`}
              >
                <span className="flex min-w-0 grow basis-0 flex-col gap-[3px]">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium leading-[18px] text-text">{name(role)}</span>
                    {role.id && <Pill tone="pink">{t('settingsUi.roles.custom')}</Pill>}
                  </span>
                  <span className="text-[12px] leading-4 text-muted">
                    {role.id
                      ? role.description ||
                        (role.basedOn
                          ? t('settingsUi.roles.basedOn', { role: t.or(`settingsUi.team.role.${role.basedOn}`, role.basedOn) })
                          : t('settingsUi.roles.permissionCount', { count: role.permissions.length }))
                      : t.or(`settingsUi.team.roleBlurb.${role.key}`, '')}
                  </span>
                </span>
                <span className="text-[13px] leading-4 text-muted tabular-nums" aria-label={t('settingsUi.team.memberCount', { count })}>
                  {count}
                </span>
              </button>
            )
          })}
        </nav>

        {form && (
          <section
            aria-labelledby="role-detail-title"
            className="flex w-full min-w-0 grow basis-0 flex-col gap-[18px] rounded-card border border-line bg-surface px-5 py-6 shadow-[var(--shadow-card)] sm:px-[26px]"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-[6px]">
                <div className="flex flex-wrap items-center gap-[10px]">
                  <h2 id="role-detail-title" className="text-[22px] font-semibold leading-7 tracking-tight text-text">
                    {selected === 'new' ? t('settingsUi.roles.new') : name(current)}
                  </h2>
                  {(selected === 'new' || current?.id) && <Pill tone="pink">{t('settingsUi.roles.custom')}</Pill>}
                  {selected !== 'new' && !current?.id && <Pill>{t('settingsUi.roles.template')}</Pill>}
                </div>
                <p className="text-[13px] leading-4 text-muted">
                  {[
                    basedOnName && t('settingsUi.roles.basedOn', { role: basedOnName }),
                    extra != null
                      ? t('settingsUi.roles.extraCount', { count: extra })
                      : t('settingsUi.roles.permissionCount', { count: form.permissions.length }),
                    selected !== 'new' && t('settingsUi.team.memberCount', { count: roleMembers.length }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {roleMembers.length > 0 && (
                <div className="flex" aria-hidden>
                  {roleMembers.slice(0, 3).map((m) => (
                    <Avatar key={m.userId} name={m.name || m.email} size={32} />
                  ))}
                  {roleMembers.length > 3 && (
                    <span className="flex size-8 items-center justify-center rounded-pill border border-line-strong bg-surface-2 text-[11px] font-semibold text-text">
                      +{roleMembers.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>

            {editing && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SettingsField label={t('settingsUi.roles.name')} htmlFor="role-name" required>
                  <input
                    id="role-name"
                    required
                    className={FIELD}
                    value={form.name}
                    onChange={(e) => setDraft({ ...form, name: e.target.value })}
                  />
                </SettingsField>
                {selected === 'new' && (
                  <SettingsField label={t('settingsUi.roles.startFrom')} htmlFor="role-base" hint={t('settingsUi.roles.startFromHint')}>
                    <select id="role-base" className={FIELD} value={form.basedOn} onChange={(e) => startFrom(e.target.value)}>
                      <option value="">{t('settingsUi.roles.nothing')}</option>
                      {data.templates.map((r) => (
                        <option key={r.key} value={r.key}>
                          {name(r)}
                        </option>
                      ))}
                    </select>
                  </SettingsField>
                )}
              </div>
            )}

            <div className="flex flex-col">
              {data.catalog.map((group) => {
                const granted = group.permissions.filter((p) => form.permissions.includes(p.key)).length
                return (
                  <div key={group.group} role="group" aria-label={group.group} className="flex flex-col">
                    <div className="flex justify-between border-t border-line pb-2 pt-[14px]">
                      <span className="text-[13px] font-semibold uppercase leading-4 tracking-[0.04em] text-muted">
                        {group.group}
                      </span>
                      <span className="text-[12px] leading-4 text-faint">
                        {t('settingsUi.roles.groupGranted', { granted, total: group.permissions.length })}
                      </span>
                    </div>
                    {group.permissions.map((p) => (
                      <div key={p.key} className="flex items-center gap-[14px] py-[10px]">
                        <div className="flex min-w-0 grow basis-0 flex-col gap-[2px]">
                          <span className="text-[14px] leading-[18px] text-text">{p.label}</span>
                          <span className="font-data text-[12px] leading-4 text-faint">{p.key}</span>
                        </div>
                        <Toggle
                          checked={form.permissions.includes(p.key)}
                          disabled={!editing || busy}
                          onChange={() => togglePerm(p.key)}
                          label={p.label}
                        />
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>

            {editing && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
                {(dirty || selected === 'new') && (
                  <GhostButton size="lg" onClick={() => select(selected === 'new' ? null : selected)}>
                    {t('common.cancel')}
                  </GhostButton>
                )}
                <GradientButton
                  variant="solid"
                  disabled={busy || !form.name.trim() || (!dirty && selected !== 'new')}
                  onClick={save}
                >
                  {busy
                    ? t('settingsUi.saving')
                    : selected === 'new'
                      ? t('settingsUi.roles.create')
                      : t('settingsUi.roles.save')}
                </GradientButton>
              </div>
            )}
            {editing && selected !== 'new' && (
              <DangerRow label={t('settingsUi.roles.archive')} helper={t('settingsUi.roles.archiveHelper')}>
                <GhostButton tone="danger" disabled={busy} style={{ borderColor: 'var(--pill-red-border)' }} onClick={archive}>
                  {t('settingsUi.roles.archiveAction')}
                </GhostButton>
              </DangerRow>
            )}
            {!editing && (
              <p className="border-t border-line pt-4 text-[12px] leading-4 text-muted">
                {current?.id ? t('settingsUi.roles.noManage') : t('settingsUi.roles.templateNote')}
              </p>
            )}
          </section>
        )}
      </div>

      <SettingsCard
        id="matrix"
        title={t('settingsUi.roles.matrix')}
        meta={t('settingsUi.roles.matrixLegend')}
        className="scroll-mt-24"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-[10px] text-[12px] font-normal uppercase leading-4 text-faint">
                  {t('settingsUi.roles.permission')}
                </th>
                {roles.map((role) => (
                  <th key={roleId(role)} scope="col" className="w-[76px] px-1 py-[10px] text-center text-[12px] font-normal leading-4 text-muted">
                    {name(role)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.catalog.flatMap((group) => [
                <tr key={`g:${group.group}`}>
                  <th
                    scope="colgroup"
                    colSpan={roles.length + 1}
                    className="pb-1 pt-4 text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-muted"
                  >
                    {group.group}
                  </th>
                </tr>,
                ...group.permissions.map((p) => (
                  <tr key={p.key} className="border-b border-line">
                    <th scope="row" className="py-[9px] pr-3 text-[14px] font-normal leading-[18px] text-text">
                      {p.label}
                    </th>
                    {roles.map((role) => {
                      const on = role.permissions.includes(p.key)
                      return (
                        <td key={roleId(role)} className="px-1 py-[9px] text-center">
                          <CheckCell
                            checked={on}
                            disabled
                            label={t(on ? 'settingsUi.roles.cellOn' : 'settingsUi.roles.cellOff', { role: name(role), permission: p.label })}
                            className="disabled:cursor-default"
                          />
                        </td>
                      )
                    })}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </SettingsCard>
    </>
  )

  return renderShell({
    meta: t('settingsUi.roles.eyebrowCounts', { templates: data.templates.length, custom: data.custom.length }),
    actions,
    children,
  })
}
