import React from 'react'
import AdminCompanyRegistrationsPage from '../../components/AdminCompanyRegistrationsPage'
import Layout from '../../components/Layout'
import Head from 'next/head'
import ProtectedRoute from '../../components/ProtectedRoute'

export default function AdminRegistrationsPage() {
  return (
    <ProtectedRoute requiredRole="super_admin">
      <Head>
        <title>Company Registrations | PBA Farm</title>
      </Head>
      <Layout title="Company Registrations">
        <AdminCompanyRegistrationsPage />
      </Layout>
    </ProtectedRoute>
  )
}
