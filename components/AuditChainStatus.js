import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { formatDateTime } from '../lib/format'
import { Button, Card } from './ui'

/** Tamper-evidence status of the organization's audit log (TRACE-007). */
export default function AuditChainStatus() {
  const status = useQuery(api.audit.chainStatus, {})
  const verify = useMutation(api.audit.verifyChain)
  const [error, setError] = useState('')
  if (!status) return null
  const latest = status.latest
  const tone =
    latest?.status === 'broken' ? 'text-signal' : latest?.status === 'ok' ? 'text-kelp' : 'text-muted'
  const summary = !latest
    ? 'Not checked yet'
    : latest.status === 'running'
      ? `Checking… ${latest.checkedCount.toLocaleString()} entries so far`
      : latest.status === 'ok'
        ? `Intact: ${latest.checkedCount.toLocaleString()} entries checked ${formatDateTime(latest.finishedAt)}`
        : `Broken at entry ${latest.brokenAtSeq}: ${latest.reason}`

  return (
    <Card className="mb-6 sm:max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p className="font-medium text-chart-ink">Tamper check</p>
          <p className={tone}>{summary}</p>
          <p className="text-muted">
            {status.chainLength.toLocaleString()} chained entries
            {status.unchainedCount > 0 &&
              ` · ${status.unchainedCount.toLocaleString()}${status.unchainedMore ? '+' : ''} older entries unchained (before the tamper check existed)`}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={latest?.status === 'running'}
          onClick={async () => {
            setError('')
            try {
              await verify({})
            } catch (err) {
              setError(errorMessage(err))
            }
          }}
        >
          Check now
        </Button>
      </div>
      {error && <p className="text-sm text-signal mt-2">{error}</p>}
    </Card>
  )
}
