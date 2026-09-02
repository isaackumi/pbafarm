import React from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import CreateCageForm from '../components/CreateCageForm'
import { PageHeader, FormPage } from '../components/ui'

export default function CreateCagePage() {
  return (
    <ProtectedRoute>
      <Layout title="Create Cage">
        <FormPage>
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Cages', href: '/cages' },
              { label: 'Create cage' },
            ]}
            description="Register a new physical cage. Stock it with fish in a separate step after creation."
            related={[
              { label: 'All cages', href: '/cages' },
              { label: 'New stocking', href: '/stocking' },
            ]}
          />
          <CreateCageForm />
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
