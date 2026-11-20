import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { GhostButton, Modal, Toggle } from '../ui'
import LimeButton from './LimeButton'
import { useT } from '../../lib/i18n/context'
import { errorMessage } from '../../lib/errorMessage'

const FIELD = 'h-10 w-full rounded-md border border-line-strong bg-bg px-3 text-sm text-text'

/** Keeper rules of the organization: capacity, deadline, escalation and "own cages only". */
export default function KeeperSettings({ open, onClose }) {
  const t = useT()
  const current = useQuery(api.keepers.views.settings, open ? {} : 'skip')
  const save = useMutation(api.keepers.views.updateSettings)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && current && !form) setForm({ ...current })
    if (!open) {
      setForm(null)
      setError('')
    }
  }, [open, current, form])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await save({
        capacity: Number(form.capacity),
        deadline: form.deadline,
        backupAfterMin: Number(form.backupAfterMin),
        managerAfterMin: Number(form.managerAfterMin),
        escalate: !!form.escalate,
        ownCagesOnly: !!form.ownCagesOnly,
      })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      as="form"
      onSubmit={submit}
      size="lg"
      showClose
      title={t('keepers.settings.title')}
      description={t('keepers.settings.description')}
      footer={
        <>
          <GhostButton size="lg" onClick={onClose}>
            {t('common.cancel')}
          </GhostButton>
          <LimeButton size="sm" type="submit" disabled={!form || busy}>
            {t('common.save')}
          </LimeButton>
        </>
      }
    >
      {!form ? (
        <p className="text-sm text-muted">{t('keepers.loading')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              {t('keepers.settings.capacity')}
              <input type="number" min={1} max={1000} step={1} value={form.capacity} onChange={set('capacity')} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              {t('keepers.settings.deadline')}
              <input type="time" value={form.deadline} onChange={set('deadline')} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              {t('keepers.settings.backupAfter')}
              <input type="number" min={0} max={720} step={5} value={form.backupAfterMin} onChange={set('backupAfterMin')} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              {t('keepers.settings.managerAfter')}
              <input type="number" min={0} max={1440} step={5} value={form.managerAfterMin} onChange={set('managerAfterMin')} className={FIELD} />
            </label>
          </div>
          {[
            ['escalate', t('keepers.settings.escalate'), t('keepers.settings.escalateHint')],
            ['ownCagesOnly', t('keepers.settings.ownCagesOnly'), t('keepers.settings.ownCagesOnlyHint')],
          ].map(([k, label, hint]) => (
            <div key={k} className="flex items-start justify-between gap-4">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-text">{label}</span>
                <span className="text-xs leading-4 text-muted">{hint}</span>
              </span>
              <Toggle checked={!!form[k]} onChange={(v) => setForm((f) => ({ ...f, [k]: v }))} label={label} />
            </div>
          ))}
          {error && <p className="text-sm text-alert" role="alert">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
