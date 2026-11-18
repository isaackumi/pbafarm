// components/LogoutConfirmationModal.js
import React from 'react'
import { Button } from './ui'

const LogoutConfirmationModal = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 modal-backdrop"
        onClick={onClose}
      ></div>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-confirm-title"
        className="relative bg-surface border border-foam-deep rounded-xl shadow-xl max-w-md w-full mx-4 p-6"
      >
        <h3
          id="logout-confirm-title"
          className="text-lg font-semibold text-chart-ink"
        >
          Log out?
        </h3>
        <p className="mt-2 text-sm text-muted">
          You will need to sign in again to use the app.
        </p>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Log out
          </Button>
        </div>
      </div>
    </div>
  )
}

export default LogoutConfirmationModal
