import { useState } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import BulkDailyUploadForm from '../components/BulkDailyUploadForm'
import BulkBiweeklyUploadForm from '../components/BulkBiweeklyUploadForm'
import { ToastProvider } from '../components/Toast'
import { PageHeader, TabBar, FormPage, FormCard } from '../components/ui'

export default function BulkUploadPage() {
  const [activeTab, setActiveTab] = useState('daily')

  return (
    <ProtectedRoute requiredRole="admin">
      <ToastProvider>
        <Layout title="Bulk Upload">
          <FormPage>
            <PageHeader
              showTitle={false}
              breadcrumbs={[
                { label: 'Dashboard', href: '/dashboard' },
                { label: 'Operations' },
                { label: 'Bulk upload' },
              ]}
              description="Upload multiple daily or bi-weekly records at once using CSV files."
              related={[
                { label: 'Daily entry', href: '/daily-entry' },
                { label: 'Bi-weekly entry', href: '/biweekly-entry' },
              ]}
            />

            <div className="mb-5">
              <TabBar
                tabs={[
                  { id: 'daily', label: 'Daily records' },
                  { id: 'biweekly', label: 'Bi-weekly ABW' },
                ]}
                active={activeTab}
                onChange={setActiveTab}
              />
            </div>

            <FormCard>
              {activeTab === 'daily' && <BulkDailyUploadForm />}
              {activeTab === 'biweekly' && <BulkBiweeklyUploadForm />}
            </FormCard>
          </FormPage>
        </Layout>
      </ToastProvider>
    </ProtectedRoute>
  )
}
