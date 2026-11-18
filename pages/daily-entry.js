import React from 'react'
import DailyUploadPage from '../components/DailyUploadPage'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, FormPage } from '../components/ui'
import { useT } from '../lib/i18n/context'

export default function DailyUpload() {
  const t = useT()
  return (
    <ProtectedRoute>
      <Layout title={t('daily.pageTitle')}>
        <FormPage data-tour="page-daily-entry">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: t('entry.dashboard'), href: '/dashboard' },
              { label: t('daily.crumbOperations') },
              { label: t('daily.crumbEntry') },
            ]}
            description={t('daily.pageDescription')}
            related={[
              { label: t('daily.relatedRecords'), href: '/daily-data' },
              { label: t('daily.relatedBulk'), href: '/bulk-upload' },
              { label: t('daily.relatedBiweekly'), href: '/biweekly-entry' },
              { label: t('daily.relatedIssue'), href: '/feed-issue' },
            ]}
          />
          <DailyUploadPage />
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
