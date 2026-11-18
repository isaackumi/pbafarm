import React from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import GradingForm from '../components/GradingForm'
import { EmptyState, FormPage, PageHeader } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'

function GradingContent() {
  const router = useRouter()
  const { hasRole } = useAuth()
  const cage = typeof router.query.cage === 'string' ? router.query.cage : ''
  const isAdmin = Boolean(hasRole?.('admin'))

  return (
    <FormPage>
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Cages', href: '/cages' },
          { label: 'Grading' },
        ]}
        description="Sort a cage's fish by size into new batches. The batch they came from is kept as their parent."
        related={[
          { label: 'Fish transfers', href: '/fish-transfers' },
          { label: 'Cages', href: '/cages' },
        ]}
      />
      {!router.isReady ? null : isAdmin ? (
        <GradingForm key={cage} initialCageId={cage} />
      ) : (
        <EmptyState title="Admins only" description="Ask a company admin to record a grading." />
      )}
    </FormPage>
  )
}

export default function GradingPage() {
  return (
    <ProtectedRoute>
      <Layout title="Grading">
        <GradingContent />
      </Layout>
    </ProtectedRoute>
  )
}
