import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useToast } from './Toast'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'
import { Skeleton } from './ui'
import { SkyToggle } from './paperTones'
import { SettingsCard, SettingsRow, FIELD } from './settings'

const CHANNELS = [
  { key: 'inApp' },
  { key: 'sms', needs: 'hasPhone' },
  { key: 'whatsapp', needs: 'hasPhone' },
  { key: 'email', needs: 'hasEmail' },
]

/**
 * Per-user notification channels and quiet hours (AUTO-003), Paper 30
 * "Delivery" and "Quiet hours" cards. Automation rules pick the channels;
 * this lets each person opt out of some of them. Each change saves at once.
 */
export default function NotificationPreferencesCard() {
  const t = useT()
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
      <SettingsCard id="delivery" title={t('settingsUi.notif.delivery')}>
        <Skeleton className="h-40" />
      </SettingsCard>
    )
  }

  const save = async (next) => {
    const previous = form
    setForm(next)
    setSaving(true)
    try {
      await update({
        inApp: next.inApp,
        sms: next.sms,
        whatsapp: next.whatsapp,
        email: next.email,
        quietHours: next.quiet ? { start: next.start, end: next.end } : null,
      })
      showToast('success', t('settingsUi.notif.saved'))
    } catch (err) {
      setForm(previous)
      showToast('error', errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const range = `${form.start} – ${form.end}`
  return (
    <>
      <SettingsCard id="delivery" title={t('settingsUi.notif.delivery')} meta={t('settingsUi.notif.perChannel')}>
        <p className="pb-3 text-[12px] leading-4 text-muted">{t('settingsUi.notif.deliveryIntro')}</p>
        {CHANNELS.map((c) => {
          const missing = c.needs && !prefs[c.needs]
          const label = t(`settingsUi.notif.channel.${c.key}`)
          return (
            <SettingsRow
              key={c.key}
              label={label}
              helper={
                missing
                  ? t(c.needs === 'hasPhone' ? 'settingsUi.notif.noPhone' : 'settingsUi.notif.noEmail')
                  : c.key === 'inApp'
                    ? t('settingsUi.notif.inAppHint')
                    : undefined
              }
            >
              <SkyToggle
                label={label}
                checked={form[c.key]}
                disabled={saving}
                onChange={(on) => save({ ...form, [c.key]: on })}
              />
            </SettingsRow>
          )
        })}
      </SettingsCard>
      <SettingsCard title={t('settingsUi.notif.quietHours')}>
        <SettingsRow label={form.quiet ? range : t('settingsUi.off')} helper={t('settingsUi.notif.quietHelper')} className="py-3!">
          <SkyToggle
            label={t('settingsUi.notif.quietHours')}
            checked={form.quiet}
            disabled={saving}
            onChange={(on) => save({ ...form, quiet: on })}
          />
        </SettingsRow>
        {form.quiet && (
          <div className="flex flex-wrap items-end gap-3 border-t border-line py-3">
            {[
              ['start', 'quietFrom'],
              ['end', 'quietUntil'],
            ].map(([key, labelKey]) => (
              <div key={key} className="min-w-[120px] flex-1">
                <label htmlFor={`quiet-${key}`} className="mb-1.5 block text-[12px] leading-4 text-muted">
                  {t(`settingsUi.notif.${labelKey}`)}
                </label>
                <input
                  id={`quiet-${key}`}
                  type="time"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== (prefs.quietHours?.[key] || '')) save({ ...form, [key]: e.target.value })
                  }}
                  className={FIELD}
                />
              </div>
            ))}
          </div>
        )}
      </SettingsCard>
    </>
  )
}
