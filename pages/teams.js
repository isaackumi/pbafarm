import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { GhostButton, GradientButton, Pill } from '../components/ui'
import { CardNote, FIELD, SettingsCard, SettingsField as Field, SettingsFrame, SettingsRow, useSettingsEyebrow } from '../components/settings'
import { useToast } from '../components/Toast'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { queryDate, queryValue } from '../lib/anowaDraftCard'
import { usePermission } from '../hooks/usePermission'
import { errorMessage } from '../lib/errorMessage'
import { localToday } from '../lib/format'
import { useT } from '../lib/i18n/context'

function useRun() {
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn, ok) => {
    setBusy(true)
    try {
      await fn()
      if (ok) showToast(ok, 'success')
      return true
    } catch (err) {
      showToast(errorMessage(err), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

function NewTeamForm({ teams }) {
  const t = useT()
  const create = useMutation(api.teams.create)
  const { locations } = useLocation()
  const { busy, run } = useRun()
  const [form, setForm] = useState({ name: '', kind: 'team', parentId: '', locationId: '' })
  const departments = teams.filter((x) => x.kind === 'department' && x.active)
  return (
    <SettingsCard title={t('ent.teams.newTitle')}>
      <form
        className="grid grid-cols-1 items-end gap-3 border-t border-line pt-4 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          run(async () => {
            await create({
              name: form.name,
              kind: form.kind,
              parentId: form.parentId || undefined,
              locationId: form.locationId || undefined,
            })
            setForm({ ...form, name: '' })
          }, t('ent.teams.created', { name: form.name.trim() }))
        }}
      >
        <Field label={t('ent.common.name')} htmlFor="team-name" required>
          <input className={FIELD} id="team-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <Field label={t('ent.common.kind')} htmlFor="team-kind">
          <select className={FIELD} id="team-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="team">{t('ent.teams.kindTeam')}</option>
            <option value="department">{t('ent.teams.kindDepartment')}</option>
          </select>
        </Field>
        <Field label={t('ent.teams.department')} htmlFor="team-parent">
          <select className={FIELD} id="team-parent" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
            <option value="">{t('ent.common.none')}</option>
            {departments.map((d) => (
              <option key={d._id} value={d._id}>{d.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('ent.common.site')} htmlFor="team-site">
          <select className={FIELD} id="team-site" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
            <option value="">{t('ent.common.allSites')}</option>
            {(locations || []).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </Field>
        <GradientButton type="submit" disabled={busy || !form.name.trim()}>{t('ent.teams.add')}</GradientButton>
      </form>
    </SettingsCard>
  )
}

function TeamCard({ team, parentName, siteName, people, canManage, canAssign, isLead }) {
  const t = useT()
  const setMember = useMutation(api.teams.setMember)
  const update = useMutation(api.teams.update)
  const remove = useMutation(api.teams.remove)
  const notify = useMutation(api.teams.notify)
  const createTask = useMutation(api.tasks.create)
  const { busy, run } = useRun()
  const [addUser, setAddUser] = useState('')
  const [msg, setMsg] = useState({ title: '', message: '' })
  const [task, setTask] = useState({ title: '', dueDate: localToday() })
  // Ask Anowa's Edit (artboard 48): /teams?taskTitle=…&taskDue=… fills every team's task form.
  const router = useRouter()
  useEffect(() => {
    if (!router.isReady) return
    const title = queryValue(router.query, 'taskTitle')
    if (title) setTask({ title, dueDate: queryDate(router.query, 'taskDue') || localToday() })
  }, [router.isReady, router.query])
  const memberIds = new Set(team.members.map((m) => m.userId))

  return (
    <SettingsCard
        title={team.name}
        meta={[
          team.kind === 'department' ? t('ent.teams.kindDepartment') : t('ent.teams.kindTeam'),
          parentName,
          siteName,
          team.active ? null : t('ent.common.inactive'),
        ]
          .filter(Boolean)
          .join(' · ')}
        action={
          canManage && (
            <>
              <GhostButton size="sm" disabled={busy} onClick={() => run(() => update({ id: team._id, patch: { active: !team.active } }))}>
                {team.active ? t('ent.common.deactivate') : t('ent.common.reactivate')}
              </GhostButton>
              <GhostButton size="sm" tone="danger" disabled={busy} onClick={() => run(() => remove({ id: team._id }), t('ent.common.removed'))}>
                {t('ent.common.remove')}
              </GhostButton>
            </>
          )
        }
      >
      {team.members.length === 0 ? (
        <CardNote>{t('ent.teams.noMembers')}</CardNote>
      ) : (
        <ul className="flex flex-col">
          {team.members.map((m) => (
            <li key={m.userId}>
              <SettingsRow label={m.name}>
                {m.role === 'lead' && <Pill tone="cyan">{t('ent.teams.lead')}</Pill>}
              {canManage && (
                <>
                  <GhostButton
                    size="sm"
                    disabled={busy}
                    onClick={() => run(() => setMember({ teamId: team._id, userId: m.userId, role: m.role === 'lead' ? 'member' : 'lead' }))}
                  >
                    {m.role === 'lead' ? t('ent.teams.makeMember') : t('ent.teams.makeLead')}
                  </GhostButton>
                  <GhostButton size="sm" tone="danger" disabled={busy} onClick={() => run(() => setMember({ teamId: team._id, userId: m.userId, role: null }))}>
                    {t('ent.common.remove')}
                  </GhostButton>
                </>
              )}
              </SettingsRow>
            </li>
          ))}
        </ul>
      )}
      {canManage && people && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
          <Field label={t('ent.teams.addMember')} htmlFor={`add-${team._id}`}>
            <select className={FIELD} id={`add-${team._id}`} value={addUser} onChange={(e) => setAddUser(e.target.value)}>
              <option value="">{t('ent.teams.choosePerson')}</option>
              {people.filter((p) => !memberIds.has(p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <GradientButton
            size="sm"
            disabled={busy || !addUser}
            onClick={() => run(async () => {
              await setMember({ teamId: team._id, userId: addUser, role: 'member' })
              setAddUser('')
            })}
          >
            {t('ent.teams.add')}
          </GradientButton>
        </div>
      )}
      {(canManage || isLead) && team.active && team.members.length > 0 && (
        <form
          className="mt-1 grid grid-cols-1 items-end gap-3 border-t border-line pt-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault()
            run(async () => {
              const r = await notify({ teamId: team._id, ...msg })
              setMsg({ title: '', message: '' })
              return r
            }, t('ent.teams.messageSent'))
          }}
        >
          <Field label={t('ent.teams.messageTitle')} htmlFor={`msg-t-${team._id}`}>
            <input className={FIELD} id={`msg-t-${team._id}`} value={msg.title} onChange={(e) => setMsg({ ...msg, title: e.target.value })} />
          </Field>
          <Field label={t('ent.teams.message')} htmlFor={`msg-m-${team._id}`}>
            <textarea className={FIELD} id={`msg-m-${team._id}`} rows={1} value={msg.message} onChange={(e) => setMsg({ ...msg, message: e.target.value })} />
          </Field>
          <GhostButton type="submit" size="lg" disabled={busy || !msg.title.trim() || !msg.message.trim()}>
            {t('ent.teams.send')}
          </GhostButton>
        </form>
      )}
      {canAssign && team.active && (
        <form
          className="mt-1 grid grid-cols-1 items-end gap-3 border-t border-line pt-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault()
            run(async () => {
              await createTask({ title: task.title, teamId: team._id, dueDate: task.dueDate || undefined })
              setTask({ ...task, title: '' })
            }, t('ent.teams.taskAssigned'))
          }}
        >
          <Field label={t('ent.teams.taskTitle')} htmlFor={`task-t-${team._id}`}>
            <input className={FIELD} id={`task-t-${team._id}`} value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
          </Field>
          <Field label={t('ent.teams.due')} htmlFor={`task-d-${team._id}`}>
            <input className={FIELD} id={`task-d-${team._id}`} type="date" value={task.dueDate} onChange={(e) => setTask({ ...task, dueDate: e.target.value })} />
          </Field>
          <GhostButton type="submit" size="lg" disabled={busy || !task.title.trim()}>
            {t('ent.teams.assignTask')}
          </GhostButton>
        </form>
      )}
    </SettingsCard>
  )
}

function Teams() {
  const t = useT()
  const canManage = usePermission('workforce.manage')
  const canAssign = usePermission('automation.manage')
  const teams = useQuery(api.teams.list, {})
  const mine = useQuery(api.teams.mine, {})
  const people = useQuery(api.users.listDirectory, canManage ? {} : 'skip')
  const { locations } = useLocation()
  const leadOf = useMemo(() => new Set((mine || []).filter((x) => x.role === 'lead').map((x) => x._id)), [mine])
  const nameOf = useMemo(() => new Map((teams || []).map((x) => [x._id, x.name])), [teams])
  const siteOf = (id) => (id ? (locations || []).find((l) => l.id === id)?.name : null)

  return (
    <SettingsFrame active="members">
        <p className="text-[14px] leading-[18px] text-muted">{t('ent.teams.description')}</p>
        {canManage && teams && <NewTeamForm teams={teams} />}
        {!teams ? (
          <SettingsCard><CardNote>{t('common.loading')}</CardNote></SettingsCard>
        ) : teams.length === 0 ? (
          <SettingsCard title={t('ent.teams.empty')}><CardNote>{t('ent.teams.emptyHint')}</CardNote></SettingsCard>
        ) : (
          teams.map((team) => (
            <TeamCard
              key={team._id}
              team={team}
              parentName={team.parentId ? nameOf.get(team.parentId) : null}
              siteName={siteOf(team.locationId)}
              people={people}
              canManage={canManage}
              canAssign={canAssign}
              isLead={leadOf.has(team._id)}
            />
          ))
        )}
    </SettingsFrame>
  )
}

export default function TeamsPage() {
  const t = useT()
  const eyebrow = useSettingsEyebrow(t('settingsUi.nav.members'))
  return (
    <ProtectedRoute permission="workforce.view">
      <Layout title={t('ent.teams.title')} eyebrow={eyebrow}>
        <Teams />
      </Layout>
    </ProtectedRoute>
  )
}
