import React from 'react'
import DailyUploadPage from '../components/DailyUploadPage'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { useT } from '../lib/i18n/context'

export default function DailyUpload() {
  const t = useT()
  return (
    <ProtectedRoute>
      {/* The entry screen draws its own Paper header: its submit action needs the live line count. */}
      <Layout title={t('daily.pageTitle')} hideTitle>
        <div className="w-full" data-tour="page-daily-entry">
          <DailyUploadPage />
        </div>
      </Layout>
    </ProtectedRoute>
  )
}
