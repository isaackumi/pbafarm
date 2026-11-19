import { CloudOff } from 'lucide-react'
import { Button, Modal } from './ui'
import { useT } from '../lib/i18n/context'

/**
 * Asked before sign-out when this user still has field entries saved on the
 * device. Sign-out clears the device, so the entries must be sent or
 * deliberately discarded first.
 */
export default function SignOutOutboxDialog({
  count,
  note,
  sending,
  onSend,
  onDiscard,
  onCancel,
}) {
  const t = useT()
  const online = typeof navigator === 'undefined' || navigator.onLine !== false

  return (
    <Modal
      onClose={onCancel}
      dismissible={!sending}
      role="alertdialog"
      tone="warn"
      icon={<CloudOff aria-hidden />}
      layerClassName="z-[110]"
      closeOnBackdrop={false}
      title={t('overlay.outbox.title', { count })}
      description={t('overlay.outbox.body')}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={sending}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onDiscard} disabled={sending}>
            {t('overlay.outbox.discard')}
          </Button>
          <Button onClick={onSend} disabled={sending || !online}>
            {sending ? t('common.sending') : t('overlay.outbox.send')}
          </Button>
        </>
      }
    >
      {(!online || note) && (
        <div className="space-y-2 text-sm leading-5 text-alert">
          {!online && <p>{t('overlay.outbox.offline')}</p>}
          {note && <p>{note}</p>}
        </div>
      )}
    </Modal>
  )
}
