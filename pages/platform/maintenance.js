import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import PlatformLayout from '../../components/platform/PlatformLayout'
import { MaintenanceCard } from '../../components/states/MaintenanceState'
import { Button, Card, CardHeader, Field, Input, LoadingState, Textarea } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'
import { useLocale, useT } from '../../lib/i18n/context'
import { isMaintenanceActive } from '../../lib/maintenanceMode'

const MESSAGE_MAX = 280

/** ms -> the `datetime-local` value in the admin's own time zone. */
function toLocalInput(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value) {
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Maintenance mode (Paper 62). A console admin sets a window and an optional
 * message; while it is open members see the maintenance screen and platform
 * admins keep working. Set and clear are audited (platform audit log).
 */
function Maintenance() {
  const t = useT()
  const { formatLocale } = useLocale()
  const data = useQuery(api.platform.maintenance.status, {})
  const setWindow = useMutation(api.platform.maintenance.set)
  const clearWindow = useMutation(api.platform.maintenance.clear)
  const { showToast } = useToast()
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const current = data?.window ?? null

  useEffect(() => {
    if (current) {
      setStartsAt(toLocalInput(current.startsAt))
      setEndsAt(toLocalInput(current.endsAt))
      setMessage(current.message || '')
    }
  }, [current])

  if (data === undefined) return <LoadingState />

  const when = (ms) =>
    new Intl.DateTimeFormat(formatLocale || undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
      new Date(ms),
    )
  const active = isMaintenanceActive(current, Date.now())
  const startMs = fromLocalInput(startsAt)
  const endMs = fromLocalInput(endsAt)

  const save = async (e) => {
    e.preventDefault()
    if (startMs === null || endMs === null) return
    setBusy(true)
    try {
      await setWindow({ startsAt: startMs, endsAt: endMs, ...(message.trim() ? { message: message.trim() } : {}) })
      showToast(t('platform.maintenance.saved'), 'success')
    } catch (err) {
      showToast(errorMessage(err, t('platform.maintenance.saveFailed')), 'error')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    if (!window.confirm(t('platform.maintenance.clearConfirm'))) return
    setBusy(true)
    try {
      await clearWindow({})
      setStartsAt('')
      setEndsAt('')
      setMessage('')
      showToast(t('platform.maintenance.cleared'), 'success')
    } catch (err) {
      showToast(errorMessage(err, t('platform.maintenance.saveFailed')), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t('platform.maintenance.formTitle')}
          subtitle={
            current
              ? t(active ? 'platform.maintenance.statusActive' : 'platform.maintenance.statusScheduled', {
                  start: when(current.startsAt),
                  end: when(current.endsAt),
                })
              : t('platform.maintenance.statusNone')
          }
        />
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <Field label={t('platform.maintenance.startsAt')} htmlFor="mm-start" required>
              <Input id="mm-start" type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </Field>
            <Field label={t('platform.maintenance.endsAt')} htmlFor="mm-end" required>
              <Input id="mm-end" type="datetime-local" required value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </Field>
          </div>
          <Field
            label={t('platform.maintenance.message')}
            htmlFor="mm-message"
            hint={t('platform.maintenance.messageHint', { count: message.length, max: MESSAGE_MAX })}
          >
            <Textarea
              id="mm-message"
              maxLength={MESSAGE_MAX}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('systemStates.maintenance.body')}
            />
          </Field>
          <p className="text-xs leading-4 text-muted">
            {data.statusPageUrl
              ? t('platform.maintenance.statusPageSet', { url: data.statusPageUrl })
              : t('platform.maintenance.statusPageUnset')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || startMs === null || endMs === null}>
              {current ? t('platform.maintenance.update') : t('platform.maintenance.schedule')}
            </Button>
            {current && (
              <Button type="button" variant="ghost" disabled={busy} onClick={clear}>
                {t('platform.maintenance.clear')}
              </Button>
            )}
          </div>
        </form>
      </Card>
      {endMs !== null && (
        <Card>
          <CardHeader title={t('platform.maintenance.preview')} subtitle={t('platform.maintenance.previewHint')} />
          <div className="flex justify-center">
            <MaintenanceCard endsAt={endMs} message={message.trim() || null} statusPageUrl={data.statusPageUrl} />
          </div>
        </Card>
      )}
    </div>
  )
}

export default function PlatformMaintenancePage() {
  const t = useT()
  return (
    <PlatformLayout title={t('platform.nav.maintenance')}>
      <Maintenance />
    </PlatformLayout>
  )
}
