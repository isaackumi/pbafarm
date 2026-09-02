import React from 'react'
import DailyUploadPage from '../components/DailyUploadPage'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, FormPage } from '../components/ui'

export default function DailyUpload() {
  return (
    <ProtectedRoute>
      <Layout title="Daily Entry">
        <FormPage>
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Operations' },
              { label: 'Daily entry' },
            ]}
            description="Log mortality and feed for a cage. Feed amounts deduct stock through the inventory ledger."
            related={[
              { label: 'Bulk upload', href: '/bulk-upload' },
              { label: 'Bi-weekly entry', href: '/biweekly-entry' },
              { label: 'Issue feed', href: '/feed-issue' },
            ]}
          />
          <DailyUploadPage />
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
