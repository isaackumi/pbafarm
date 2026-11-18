import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { usePermission } from '../hooks/usePermission'
import { Button, Field, FormCard, Input, Select } from './ui'

const EMPTY = { id: null, name: '', basedOn: '', permissions: [] }

/**
 * Roles editor (PERM-002). Templates are fixed and shown for reference; custom
 * roles pick any set of permissions from the catalog.
 */
export default function RolesPanel() {
  const data = useQuery(api.roles.list, {})
  const canManage = usePermission('org.roles.manage')
  const createRole = useMutation(api.roles.create)
  const updateRole = useMutation(api.roles.update)
  const archiveRole = useMutation(api.roles.archive)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)

  const templatesByKey = useMemo(
    () => Object.fromEntries((data?.templates || []).map((t) => [t.key, t])),
    [data],
  )

  if (!data) {
    return (
      <FormCard title="Roles">
        <p className="text-sm text-muted">Loading…</p>
      </FormCard>
    )
  }

  const toggle = (key) =>
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key],
    }))

  const startFrom = (basedOn) =>
    setForm((f) => ({
      ...f,
      basedOn,
      permissions: basedOn ? [...(templatesByKey[basedOn]?.permissions || [])] : f.permissions,
    }))

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (form.id) {
        await updateRole({ roleId: form.id, name: form.name, permissions: form.permissions })
      } else {
        await createRole({
          name: form.name,
          permissions: form.permissions,
          ...(form.basedOn ? { basedOn: form.basedOn } : {}),
        })
      }
      setForm(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not save the role'))
    } finally {
      setBusy(false)
    }
  }

  const archive = async (role) => {
    if (!window.confirm(`Archive the role ${role.name}?`)) return
    setError('')
    try {
      await archiveRole({ roleId: role.id })
    } catch (err) {
      setError(errorMessage(err, 'Could not archive the role'))
    }
  }

  const roleRow = (role, custom) => (
    <li key={role.id || role.key} className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="flex-1 min-w-0 text-left"
          onClick={() => setOpen(open === (role.id || role.key) ? null : role.id || role.key)}
          aria-expanded={open === (role.id || role.key)}
        >
          <span className="font-medium text-chart-ink">{role.name}</span>
          <span className="ml-2 text-sm text-muted">
            {role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'}
            {custom ? '' : ' · template'}
          </span>
        </button>
        {custom && canManage && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setForm({ id: role.id, name: role.name, basedOn: '', permissions: [...role.permissions] })}
            >
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => archive(role)}>
              Archive
            </Button>
          </div>
        )}
      </div>
      {open === (role.id || role.key) && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {role.permissions.map((p) => (
            <li key={p} className="rounded-md bg-foam px-2 py-0.5 font-data text-xs text-chart-ink">
              {p}
            </li>
          ))}
        </ul>
      )}
    </li>
  )

  return (
    <FormCard
      title="Roles"
      subtitle="Templates cover most farms. Make a custom role when someone needs a different mix, then assign it under Members and roles."
    >
      {error && (
        <div role="alert" className="mb-3 rounded-lg bg-signal/10 text-signal border border-signal/20 px-3 py-2 text-sm">
          {error}
        </div>
      )}
      <ul className="divide-y divide-foam-deep">
        {data.templates.map((t) => roleRow(t, false))}
        {data.custom.map((r) => roleRow(r, true))}
      </ul>

      {canManage && !form && (
        <Button className="mt-4" variant="secondary" onClick={() => setForm({ ...EMPTY })}>
          New custom role
        </Button>
      )}

      {form && (
        <form onSubmit={save} className="mt-5 space-y-4 border-t border-foam-deep pt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Role name" htmlFor="role-name" required>
              <Input
                id="role-name"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            {!form.id && (
              <Field label="Start from" htmlFor="role-base" hint="Copies a template's permissions">
                <Select id="role-base" value={form.basedOn} onChange={(e) => startFrom(e.target.value)}>
                  <option value="">Nothing</option>
                  {data.templates.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          {data.catalog.map((group) => (
            <fieldset key={group.group}>
              <legend className="text-sm font-semibold text-chart-ink mb-1">{group.group}</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                {group.permissions.map((p) => (
                  <label key={p.key} className="flex items-start gap-3 min-h-11 py-1 text-sm text-chart-ink cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded accent-lake"
                      checked={form.permissions.includes(p.key)}
                      onChange={() => toggle(p.key)}
                    />
                    <span>{p.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : form.id ? 'Save role' : 'Create role'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </FormCard>
  )
}
