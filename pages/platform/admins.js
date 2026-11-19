import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import PlatformLayout, { SimpleTable, StatusPill } from '../../components/platform/PlatformLayout'
import { Button, Card, CardHeader, Field, Input, LoadingState } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'
import { useT } from '../../lib/i18n/context'

function Admins() {
  const data = useQuery(api.platform.admins.list, {})
  const promote = useMutation(api.platform.admins.promote)
  const demote = useMutation(api.platform.admins.demote)
  const { showToast } = useToast()
  const [email, setEmail] = useState('')

  const add = async (e) => {
    e.preventDefault()
    try {
      await promote({ email })
      setEmail('')
      showToast('Platform admin added. They must set up an authenticator app to use the console.', 'success')
    } catch (err) {
      showToast(errorMessage(err, 'Could not add the admin'), 'error')
    }
  }
  const remove = async (a) => {
    if (!window.confirm(`Remove platform admin access from ${a.email || a.name}?`)) return
    try {
      await demote({ userId: a.userId })
      showToast('Access removed', 'success')
    } catch (err) {
      showToast(errorMessage(err, 'Could not remove the admin'), 'error')
    }
  }

  if (data === undefined) return <LoadingState />
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Add a platform admin" subtitle="The person needs an existing account. Platform admins see every tenant." />
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <Field label="Email" htmlFor="admin-email" required>
            <Input id="admin-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-72" />
          </Field>
          <Button type="submit" className="mb-0.5">
            Add admin
          </Button>
        </form>
      </Card>
      <Card>
        <CardHeader title={`Platform admins (${data.admins.length})`} subtitle={data.truncated ? 'List may be incomplete' : undefined} />
        <SimpleTable
          rowKey={(r) => r.userId}
          rows={data.admins}
          columns={[
            { key: 'name', label: 'Name', render: (r) => `${r.name || '—'}${r.isYou ? ' (you)' : ''}` },
            { key: 'email', label: 'Email', render: (r) => r.email || '—' },
            { key: 'active', label: 'Account', render: (r) => <StatusPill status={r.active ? 'active' : 'inactive'} /> },
            { key: 'mfa', label: 'Authenticator app', render: (r) => (r.authenticatorApp ? 'Set up' : <span className="text-signal">Missing</span>) },
            {
              key: 'remove',
              label: '',
              render: (r) =>
                r.isYou ? null : (
                  <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                    Remove
                  </Button>
                ),
            },
          ]}
        />
      </Card>
    </div>
  )
}

export default function PlatformAdminsPage() {
  const t = useT()
  return (
    <PlatformLayout title={t('platform.nav.staff')}>
      <Admins />
    </PlatformLayout>
  )
}
