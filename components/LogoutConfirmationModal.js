// components/LogoutConfirmationModal.js
import { LogOut } from 'lucide-react'
import { GhostButton, Modal } from './ui'
import { DangerButton } from './ui/Modal'
import { useT } from '../lib/i18n/context'

const LogoutConfirmationModal = ({ isOpen, onClose, onConfirm }) => {
  const t = useT()
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      tone="neutral"
      icon={<LogOut aria-hidden />}
      title={t('overlay.logout.title')}
      description={t('overlay.logout.body')}
      footer={
        <>
          <GhostButton size="dialog" className="justify-center" onClick={onClose}>
            {t('common.cancel')}
          </GhostButton>
          <DangerButton onClick={onConfirm}>{t('overlay.logout.confirm')}</DangerButton>
        </>
      }
    />
  )
}

export default LogoutConfirmationModal
