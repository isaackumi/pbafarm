// components/LogoutConfirmationModal.js
import React from 'react'
import { Button, Modal } from './ui'

const LogoutConfirmationModal = ({ isOpen, onClose, onConfirm }) => (
  <Modal
    open={isOpen}
    onClose={onClose}
    title="Log out?"
    description="You will need to sign in again to use the app."
    footer={
      <>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Log out
        </Button>
      </>
    }
  />
)

export default LogoutConfirmationModal
