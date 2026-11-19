import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import PlatformLayout, { SimpleTable } from '../../components/platform/PlatformLayout'
import { Button, Card, Field, Input, LoadingState } from '../../components/ui'
import { formatDateTime } from '../../lib/billingFormat'
import { useT } from '../../lib/i18n/context'

function AuditLog() {
  const router = useRouter()
  const companyId = typeof router.query.companyId === 'string' ? router.query.companyId : undefined
  const [action, setAction] = useState('')
  const [pages, setPages] = useState([undefined])
  const before = pages[pages.length - 1]
  const data = useQuery(api.platform.audit.list, { companyId, action: action || undefined, before })
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Field label="Action starts with" htmlFor="audit-action">
          <Input
            id="audit-action"
            value={action}
            placeholder="tenant., billing., admin."
            onChange={(e) => {
              setAction(e.target.value)
              setPages([undefined])
            }}
          />
        </Field>
        {companyId && (
          <Link className="text-sm text-pearl-cyan hover:underline mb-3" href="/platform/audit">
            Clear tenant filter
          </Link>
        )}
      </div>
      {data === undefined ? (
        <LoadingState />
      ) : (
        <>
          <SimpleTable
            rows={data.rows}
            empty="No platform actions recorded"
            columns={[
              { key: 'at', label: 'When', render: (r) => formatDateTime(r.at) },
              { key: 'action', label: 'Action', render: (r) => <code className="text-xs">{r.action}</code> },
              { key: 'actor', label: 'By', render: (r) => r.actor || r.actorEmail || 'System' },
              {
                key: 'company',
                label: 'Tenant',
                render: (r) =>
                  r.companyId ? (
                    <Link className="text-pearl-cyan hover:underline" href={`/platform/tenants/${r.companyId}`}>
                      {r.companyName || 'Tenant'}
                    </Link>
                  ) : (
                    '—'
                  ),
              },
              { key: 'details', label: 'Details', render: (r) => <code className="text-xs break-all">{r.details ? JSON.stringify(r.details) : ''}</code> },
            ]}
          />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" size="sm" disabled={pages.length === 1} onClick={() => setPages((p) => p.slice(0, -1))}>
              Newer
            </Button>
            <Button variant="secondary" size="sm" disabled={data.nextBefore === null} onClick={() => setPages((p) => [...p, data.nextBefore])}>
              Older
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}

export default function PlatformAuditPage() {
  const t = useT()
  return (
    <PlatformLayout title={t('platform.nav.audit')}>
      <AuditLog />
    </PlatformLayout>
  )
}
