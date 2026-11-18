import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { useToast } from '../components/Toast'
import { Button, Card, EmptyState, FormPage, PageHeader, Skeleton } from '../components/ui'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'

function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function DueLabel({ dueDate }) {
  if (!dueDate) return <span className="text-muted">No due date</span>
  const t = today()
  if (dueDate < t) return <span className="text-signal font-medium">Overdue · {dueDate}</span>
  if (dueDate === t) return <span className="text-chart-ink font-medium">Due today</span>
  return <span className="text-muted">Due {dueDate}</span>
}

function TaskRow({ task, onStatus, busy }) {
  const open = task.status === 'open'
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className={`font-medium ${open ? 'text-chart-ink' : 'text-muted line-through'}`}>{task.title}</p>
        {task.description && <p className="mt-1 text-sm text-muted whitespace-pre-line">{task.description}</p>}
        <p className="mt-1 text-sm">
          {open ? <DueLabel dueDate={task.dueDate} /> : <span className="text-muted">Done</span>}
          {task.cageName && <span className="text-muted"> · Cage {task.cageName}</span>}
          {task.teamName && <span className="text-muted"> · Team {task.teamName}</span>}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {open ? (
          <>
            <Button size="sm" onClick={() => onStatus(task._id, 'done')} disabled={busy}>
              Mark done
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onStatus(task._id, 'cancelled')} disabled={busy}>
              Dismiss
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => onStatus(task._id, 'open')} disabled={busy}>
            Reopen
          </Button>
        )}
      </div>
    </li>
  )
}

export default function TasksPage() {
  const [showDone, setShowDone] = useState(false)
  const data = useQuery(api.tasks.mine, { includeClosed: showDone })
  const setStatus = useMutation(api.tasks.setStatus)
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  const onStatus = async (taskId, status) => {
    setBusy(true)
    try {
      await setStatus({ taskId, status })
      if (status === 'done') showToast('success', 'Task done')
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProtectedRoute>
      <Layout title="My tasks">
        <FormPage width="md">
          <PageHeader
            showTitle={false}
            breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'My tasks' }]}
            description="Work assigned to you by an admin or by an automation rule."
            actions={
              <Button variant="secondary" size="sm" onClick={() => setShowDone((s) => !s)}>
                {showDone ? 'Hide done' : 'Show done'}
              </Button>
            }
          />
          {!data ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="space-y-6">
              <Card>
                {data.open.length ? (
                  <ul className="divide-y divide-foam-deep -my-4">
                    {data.open.map((t) => (
                      <TaskRow key={t._id} task={t} onStatus={onStatus} busy={busy} />
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="Nothing to do" description="Tasks assigned to you show up here." />
                )}
              </Card>
              {showDone && (
                <Card>
                  <h3 className="text-base font-medium text-chart-ink mb-2">Done recently</h3>
                  {data.closed.length ? (
                    <ul className="divide-y divide-foam-deep">
                      {data.closed.map((t) => (
                        <TaskRow key={t._id} task={t} onStatus={onStatus} busy={busy} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">No finished tasks yet.</p>
                  )}
                </Card>
              )}
            </div>
          )}
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
