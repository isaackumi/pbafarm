// pages/daily-upload.js
import React from 'react'
import DailyUploadPage from '../components/DailyUploadPage'
import ProtectedRoute from '../components/ProtectedRoute'

export default function DailyUpload() {
  return (
    <ProtectedRoute>
      <DailyUploadPage />
    </ProtectedRoute>
  )
}
