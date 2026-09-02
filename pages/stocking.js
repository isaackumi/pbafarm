import React from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import StockingForm from '../components/StockingForm'
import { PageHeader, FormPage } from '../components/ui'

export default function StockingPage() {
  return (
    <ProtectedRoute>
      <Layout title="New Stocking">
        <FormPage data-tour="page-stocking">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Cages', href: '/cages' },
              { label: 'New stocking' },
            ]}
            description="Stock an available cage with a new batch. Required fields are marked with an asterisk (*)."
            related={[
              { label: 'Stocking management', href: '/stocking-management' },
              { label: 'Top-up batch', href: '/topup' },
              { label: 'Create cage', href: '/create-cage' },
            ]}
          />
          <StockingForm />
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
