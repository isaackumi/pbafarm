import React from 'react'
import DailyUploadPage from '../components/DailyUploadPage'
import DailyEntryMobile from '../components/DailyEntryMobile'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { useT } from '../lib/i18n/context'
import { useIsPhone } from '../hooks/useMediaQuery'

export default function DailyUpload() {
  const t = useT()
  // Below md the phone screen (Paper 55, H45-0 / MGE-0) replaces the desktop batch grid.
  const phone = useIsPhone()
  return (
    <ProtectedRoute>
      {/* The entry screen draws its own Paper header: its submit action needs the live line count. */}
      <Layout title={t('daily.pageTitle')} hideTitle bareOnPhone={phone}>
        <div className="w-full" data-tour="page-daily-entry">
          {phone ? <DailyEntryMobile /> : <DailyUploadPage />}
        </div>
      </Layout>
    </ProtectedRoute>
  )
}
