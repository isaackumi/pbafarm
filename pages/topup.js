import React from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import TopUpForm from '../components/TopUpForm'
import { PageHeader, FormPage } from '../components/ui'

export default function TopUpPage() {
  return (
    <ProtectedRoute>
      <Layout title="Top-up">
        <FormPage>
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Stocking', href: '/stocking-management' },
              { label: 'Top-up' },
            ]}
            description="Add fish to an existing stocked cage. Top-ups are recorded separately but tracked with the original batch."
            related={[
              { label: 'New stocking', href: '/stocking' },
              { label: 'Stocking management', href: '/stocking-management' },
            ]}
          />
          <TopUpForm />
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
