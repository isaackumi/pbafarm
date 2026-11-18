import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useToast } from './Toast'
import { errorMessage } from '../lib/errorMessage'
import { Button, Field, FormActions, FormCard, Input, Skeleton } from './ui'

const CHANNELS = [
  { key: 'inApp', label: 'In the app', hint: 'The bell at the top of the screen.' },
  { key: 'sms', label: 'SMS', needs: 'hasPhone' },
  { key: 'whatsapp', label: 'WhatsApp', needs: 'hasPhone' },
  { key: 'email', label: 'Email', needs: 'hasEmail' },
]

/**
 * Per-user notification channels and quiet hours (AUTO-003). Automation rules
 * pick the channels; this lets each person opt out of some of them.
 */
export default function NotificationPreferencesCard() {
  const prefs = useQuery(api.notificationPreferences.mine)
  const update = useMutation(api.notificationPreferences.update)
  const { showToast } = useToast()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!prefs || form) return
    setForm({
      inApp: prefs.inApp,
      sms: prefs.sms,
      whatsapp: prefs.whatsapp,
      email: prefs.email,
      quiet: !!prefs.quietHours,
      start: prefs.quietHours?.start || '21:00',
      end: prefs.quietHours?.end || '06:00',
    })
  }, [prefs, form])

  if (!prefs || !form) {
    return (
      <FormCard title="Notifications">
        <Skeleton className="h-40" />
      </FormCard>
    )
  }

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await update({
        inApp: form.inApp,
        sms: form.sms,
        whatsapp: form.whatsapp,
        email: form.email,
        quietHours: form.quiet ? { start: form.start, end: form.end } : null,
      })
      showToast('success', 'Notification settings saved')
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormCard
      title="Notifications"
      subtitle="Where alerts and reminders reach you. Your admin decides which alerts exist; you choose the channels."
    >
      <form onSubmit={save} className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-chart-ink mb-2">Channels</legend>
          {CHANNELS.map((c) => {
            const missing = c.needs && !prefs[c.needs]
            return (
              <label key={c.key} className="flex items-start gap-3 text-sm text-chart-ink min-h-11">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5"
                  checked={form[c.key]}
                  onChange={(e) => setForm({ ...form, [c.key]: e.target.checked })}
                />
                <span>
                  {c.label}
                  {c.hint && <span className="block text-muted">{c.hint}</span>}
                  {missing && (
                    <span className="block text-muted">
                      No {c.needs === 'hasPhone' ? 'phone number' : 'email address'} on your account yet.
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-chart-ink mb-2">Quiet hours</legend>
          <label className="flex items-start gap-3 text-sm text-chart-ink min-h-11">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={form.quiet}
              onChange={(e) => setForm({ ...form, quiet: e.target.checked })}
            />
            <span>
              Pause SMS, WhatsApp and email at night
              <span className="block text-muted">In-app notifications still arrive. Times are in farm time.</span>
            </span>
          </label>
          {form.quiet && (
            <div className="grid grid-cols-2 gap-4 max-w-sm">
              <Field label="From" htmlFor="quiet-start">
                <Input
                  id="quiet-start"
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </Field>
              <Field label="Until" htmlFor="quiet-end">
                <Input
                  id="quiet-end"
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </Field>
            </div>
          )}
        </fieldset>

        <FormActions>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save notification settings'}
          </Button>
        </FormActions>
      </form>
    </FormCard>
  )
}
