// components/LogoutConfirmationModal.js
import { LogOut } from 'lucide-react'
import { Button, Modal } from './ui'
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
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t('overlay.logout.confirm')}
          </Button>
        </>
      }
    />
  )
}

export default LogoutConfirmationModal
