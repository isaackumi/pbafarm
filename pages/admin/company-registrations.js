// pages/admin/company-registrations.js
import React from 'react'
import AdminCompanyRegistrationsPage from '../../components/AdminCompanyRegistrationsPage'
import Layout from '../../components/Layout'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useAuth } from '../../contexts/AuthContext'

export default function AdminRegistrationsPage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()

  // Check if user is an admin
  React.useEffect(() => {
    // Wait for auth to initialize
    if (loading) return

    // If user is not logged in or not an admin, redirect to login
    if (
      !user ||
      (profile && profile.role !== 'admin' && profile.role !== 'super_admin')
    ) {
      router.push('/login')
    }
  }, [user, profile, loading, router])

  // Show loading while checking auth
  if (
    loading ||
    !user ||
    (profile && profile.role !== 'admin' && profile.role !== 'super_admin')
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>Company Registration Approvals - Admin</title>
        <meta
          name="description"
          content="Approve or reject company registration requests"
        />
      </Head>
      <Layout title="Company Registrations">
        <AdminCompanyRegistrationsPage />
      </Layout>
    </>
  )
}
